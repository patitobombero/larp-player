import { ctx, readyAudio as sound, studioInput } from "../audio.js";
import { media } from "../client.js";
import { navigation, session } from "../state.js";
import { addLibraryFile, refreshLibrary } from "../library.js";
import { downloadFile, encodeWav } from "../wav.js";
import { $, btn, clamp, esc, fmt, isOpen, names, openPreview, out, palette, sources, toast, uid } from "./host.js";
import { WInstruments } from "./instruments.js";
import { WModel } from "./model.js";
import { WMidi } from "./midi.js";
import { WTempo } from "./tempo.js";
import { renderStudioMix, studioRates, WDSP } from "./dsp.js";
import { WRecord } from "./recording.js";
import { prepareTakes } from "./takes.js";
const StudioWorkbench=(()=>{
 let owner="",project=WModel.empty(),trackId="",clipId="",mixerId="master",noteId="",mode="Piano roll",tool="Dibujar",arrTool="Mover",oct=4,snap=.5;
 let extent=32,rollExtent=32,arrScale=34,rollScale=38,arrLeft=0,rollLeft=0,rollTop=23*20;
 let channelLane="velocity",record=false,head=0,transport=null,generation=0,enabled=true;
 let undo=[],redo=[],meters=0,audition=null,rackBar=0,selectedPad=0,drumTake=null,drumSnap=false,rackRoot=60;
 let takeClock=null,micTake=null;
 let projectUpload=null, openingProject=null, exportRate=studioRates[0];
 let editTarget="",clipboard=null,notePasteBeat=null,arrangePasteBeat=null;
 const keys=new Map(),fxPads=new Map(),sessions=new Map();
 const compact=(n,prec=2)=>Number(n.toFixed(prec));
 const pitchName=n=>names[(n+1200)%12]+(Math.floor(n/12)-1);
 const pTrack=()=>project.tracks.find(t=>t.id===trackId);
 const pClip=()=>pTrack()?.clips.find(c=>c.id===clipId);
 const pNote=()=>pClip()?.notes.find(n=>n.id===noteId);
 const aMixer=()=>WModel.mixId(project,mixerId)||project.master;
 const inst=()=>project.tracks.find(t=>t.id===mixerId);
 const overall=()=>project.tracks.reduce((max,t)=>t.clips.reduce((end,c)=>Math.max(end,c.start+c.length),max),0);
 const tint=t=>palette[Math.max(0,project.tracks.indexOf(t))%palette.length];
 const labelT=id=>id==="master"?"Master":project.tracks.find(t=>t.id===id)?.name||"Canal";
 const minBeat=.03125;
 const chapters=x=>Math.max(32,Math.ceil((x+4)/32)*32);
 const snapAt=x=>Math.max(0,Math.round(x/snap)*snap);
 const formatPos=x=>Math.floor(x/4)+1+"."+Math.floor(x%4+1);
 const toolbar=(list,active,attr)=>list.map(label=>btn(label,'data-'+attr+'="'+esc(label)+'" aria-pressed="'+(active===label)+'"')).join("");
 const options=(list,selected)=>list.map(([value,label])=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>').join("");
 const float=(label,id,n,min,max,step=1)=>'<label class="w-field"><span>'+label+'</span><input type="number" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+compact(n,4)+'"></label>';
 const slider=(label,n,min,max,props,step=1)=>'<label class="w-slider"><span>'+label+' <output>'+compact(n,3)+'</output></span><input type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+n+'" '+props+'></label>';
 const fileInput=(id,label,accept)=>'<label class="file-button" tabindex="0">'+label+'<input type="file" id="'+id+'" accept="'+accept+'"></label>';
 const meter=(id)=>'<div class="w-meter" data-meter="'+id+'"><i></i></div>';
 const insertSuggestions={
  electric:["amp","drive","sustain","tape"],guitar:["channelEQ","dynamics","space"],piano:["channelEQ","space"],
  rhodes:["dynamics","space","tape"],synth:["channelEQ","tape","space"],bass:["channelEQ","dynamics","amp"],
  bass808:["channelEQ","dynamics"],flute:["channelEQ","space"],cello:["channelEQ","dynamics","space"],
  drums:["padvault","channelEQ","drumcircuit","dynamics"],fx:["channelEQ","tape","space"],
  audio:["bpm","channelEQ","dynamics"],bus:["channelEQ","dynamics"]
 };
 const insertNames={amp:"Amplificador",drive:"Overdrive",sustain:"Sustain",space:"Reverb / Chorus",padvault:"Pad Vault",
  drumcircuit:"Drum Circuit",bpm:"Calibrar BPM",channelEQ:"EQ",dynamics:"Dinámica",tape:"Tape Echo"};
 function syncGraph(){if(ctx&&enabled)WDSP.apply(ctx,project,studioInput);}
 async function audio(){await sound();if(enabled)syncGraph();}
 function pick(t,c=null){
  const next=c?.id||t?.clips[0]?.id||"";
  if(clipId!==next){rackBar=0;endInstrumentTake();if(trackId)WDSP.releaseLatches(trackId);}
  trackId=t?.id||"";clipId=next;mixerId=t?.id||"master";noteId="";notePasteBeat=null;
 }
 function copyProject(){
  const {assets,...score}=project;
  return {...structuredClone(score),assets:{...assets}};
 }
 function checkpoint(){
  undo.push(copyProject());if(undo.length>24)undo.shift();redo=[];
 }
 function cleanSelection(){
  if(!pTrack())pick(project.tracks[0]);
  else if(!pClip())clipId=pTrack().clips[0]?.id||"";
  if(!pNote())noteId="";
  if(!inst()&&mixerId!=="master")mixerId="master";
 }
 function restore(from,to){
  if(!from.length)return;
  cancelMic();stop();releaseKeys();to.push(copyProject());project=from.pop();cleanSelection();syncGraph();render();
 }
 function mutate(fn){checkpoint();fn();syncGraph();render();}
 function addTrack(kind,initial=null){
  if(!WModel.types[kind])return;
  if(project.tracks.length>=20){toast("Límite de 20 pistas, incluidos los buses.");return;}
  mutate(()=>{
   const t=WModel.track(kind,initial?.name);project.tracks.push(t);
   if(initial){t.clips.push(WModel.clip(initial.beat,initial.length,initial.id));}
   else if(kind!=="bus"&&kind!=="audio")t.clips.push(WModel.clip(0,16));
   pick(t);
   if(kind==="bus"||kind==="audio")mode=kind==="bus"?"Mixer":"Clips de audio";
   else{mode=WInstruments.has(kind)?WInstruments.defs[kind].title:kind==="drums"?"Channel rack":"Piano roll";if(kind==="bass808"){oct=2;rollTop=23*20;}}
  });
 }
 function addPattern(){
  const t=pTrack();if(!t||t.kind==="bus"||t.kind==="audio")return;
  mutate(()=>{const c=WModel.clip(Math.floor(head/4)*4,16);t.clips.push(c);pick(t,c);if(!["Channel rack","Larp Drums"].includes(mode))mode="Piano roll";});
 }
 function trackColor(t){return 'style="--track:'+tint(t)+'"';}
 function arrangement(){
  extent=Math.min(96,Math.max(extent,chapters(Math.max(0,Math.min(overall(),arrOrigin+380)-arrOrigin)/4)));
  const timelineWidth=extent*4*arrScale;
  return '<div class="w-arr-head"><div><h2>Arreglo</h2><small>'+project.tracks.length+' / 20 pistas</small></div><div class="w-row">'+
    toolbar(["Mover","Deslizar","Dividir","Volumen"],arrTool,"arrtool")+btn("＋ Patrón","id=w-add-pattern "+(!pTrack()||["audio","bus"].includes(pTrack().kind)?"disabled":""))+
    '<label class="w-jump">Compás <input id="w-jump-where" type="number" min="1" step="1" value="'+(Math.floor(head/4)+1)+'"></label>'+btn("Ir","id=w-jump")+
    '<label class="w-jump">Zoom <select id="w-zoom">'+options([[16,"Lejos"],[34,"Medio"],[60,"Cerca"]],arrScale)+'</select></label></div></div>'+
    '<div class="w-arr-grid"><div class="w-track-list"><div class="w-list-head"><span>Pista</span><span>Salida</span></div>'+
    (project.tracks.map((t,i)=>'<button class="w-track '+(t.id===trackId?'selected':'')+'" '+trackColor(t)+' data-track="'+t.id+'"><span><i>'+String(i+1).padStart(2,"0")+'</i><b>'+esc(t.name)+'</b></span><small>'+esc(labelT(t.mix.route))+'</small></button>').join("")||'<div class="w-list-empty">Sin pistas</div>')+
    '</div><div id="w-arr-scroll" class="w-scroll w-arr-scroll"><div class="w-time" style="--beat:'+arrScale+'px;width:'+timelineWidth+'px"><div class="w-ruler" data-ruler="arr"></div>'+
    (project.tracks.map(t=>'<div class="w-arr-row" '+trackColor(t)+' data-arrrow="'+t.id+'">'+t.clips.filter(c=>c.start+c.length>arrOrigin&&c.start<arrOrigin+extent*4).map(c=>arrClip(t,c)).join("")+'</div>').join("")||'<div class="w-arr-empty">Añade un instrumento o importa un audio para empezar.</div>')+
    '<i class="w-head" style="left:'+(head-arrOrigin)*arrScale+'px"></i></div></div></div>';
 }
 function arrClip(t,c){
  const active=clipId===c.id;
  const name=c.asset?project.assets[c.asset]?.name:t.name;
  const visibleStart=Math.max(c.start,arrOrigin),visibleEnd=Math.min(c.start+c.length,arrOrigin+extent*4);
  const graphics=c.asset?'<canvas class="w-clip-wave" width="192" height="22" aria-hidden="true"></canvas>':(t.kind==="drums"?[...c.notes,...c.layers.map(h=>({start:h.beat,length:.13,pitch:h.pad+60}))]:c.notes).slice(0,48).map(n=>'<i class="w-mini-note" style="left:'+n.start/c.length*100+'%;width:'+Math.min(100,n.length/c.length*100)+'%;top:'+(23-(n.pitch%12))+'px"></i>').join("");
  const handles=active?(visibleStart===c.start?'<i data-size="start" class="w-edge left" title="Recortar inicio"></i>':'')+
   (visibleEnd===c.start+c.length?'<i data-size="end" class="w-edge" title="Recortar final"></i>':''):'';
  return '<button class="w-clip '+(active?'selected':'')+'" data-part="'+c.id+'" aria-label="Clip '+esc(name)+'" style="left:'+(visibleStart-arrOrigin)*arrScale+'px;width:'+Math.max(3,(visibleEnd-visibleStart)*arrScale-2)+'px"><strong>'+esc(name)+'</strong>'+graphics+handles+'</button>';
 }
 function piano(){
  const t=pTrack(),c=pClip();
  if(!t||!c||c.asset||["bus","audio"].includes(t.kind))return '<div class="w-empty-detail"><strong>Piano roll</strong><p>Añade un instrumento y selecciona un patrón para editar sus notas.</p></div>';
  rollExtent=Math.min(96,Math.max(rollExtent,chapters(Math.max(0,Math.min(c.length,rollOrigin+380)-rollOrigin)/4)));
  const low=Math.max(0,(oct-1)*12),high=Math.min(127,(oct+4)*12-1),count=high-low+1;
  return '<div class="w-ed-head"><div><h2>Piano roll</h2><small>'+esc(t.name)+' · '+formatPos(c.start)+'</small></div><div class="w-row">'+
   previewButton()+toolbar(["Dibujar","Mover","Cortar","Borrar"],tool,"tool")+
   '<label class="w-jump">Octava <select id="w-oct">'+options(Array.from({length:8},(_,i)=>[i,i]),oct)+'</select></label>'+
   '<label class="w-jump">Cuadrícula <select id="w-snap">'+options([[4,"Compás"],[1,"1/4"],[.5,"1/8"],[.25,"1/16"],[.125,"1/32"],[.03125,"1/128"]],snap)+'</select></label>'+
   '<label class="w-jump">Compás <input id="w-roll-to" type="number" min="1" step="1" value="'+(Math.floor((rollOrigin+rollLeft/rollScale)/4)+1)+'"></label>'+btn("Ir","id=w-roll-jump")+'</div></div>'+
   '<div class="w-roll w-scroll" id="w-roll-scroll"><div class="w-roll-inner" style="--beat:'+rollScale+'px;--snap:'+rollScale*snap+'px;width:'+(rollExtent*4*rollScale+57)+'px">'+
   '<div class="w-roll-ruler"><span>Nota</span><div class="w-ruler" data-ruler="roll"></div></div><div class="w-roll-body">'+
   '<div class="w-names">'+Array.from({length:count},(_,i)=>'<button data-sound-note="'+(high-i)+'" class="'+(names[(high-i)%12].includes("♯")?'black':'')+'">'+pitchName(high-i)+'</button>').join("")+'</div>'+
   '<div class="w-notes" data-high="'+high+'" data-low="'+low+'" style="height:'+count*20+'px">'+
   (notePasteBeat!==null&&notePasteBeat>=rollOrigin&&notePasteBeat<rollOrigin+rollExtent*4?'<i class="w-note-cursor" aria-hidden="true" style="left:'+((notePasteBeat-rollOrigin)*rollScale)+'px"></i>':'')+
   c.notes.filter(n=>n.pitch<=high&&n.pitch>=low&&n.start+n.length>rollOrigin&&n.start<rollOrigin+rollExtent*4).map(n=>'<button class="w-note '+(n.id===noteId?'selected':'')+'" data-note="'+n.id+'" style="left:'+(n.start-rollOrigin)*rollScale+'px;width:'+Math.max(3,n.length*rollScale-1)+'px;top:'+((high-n.pitch)*20+2)+'px"><span>'+pitchName(n.pitch)+'</span><i class="w-edge left" data-size="start"></i><i class="w-edge" data-size="end"></i></button>').join("")+'</div></div></div></div>'+
   controller(c);
 }
 function controller(c){
  const n=pNote(),name=WModel.noteSpec[channelLane]?.[0]||WModel.groupSpec[channelLane]?.[0];
  return '<div class="w-controllers"><div class="w-row"><label class="w-jump">Controlador <select id="w-lane"><optgroup label="Propiedades de nota">'+options(Object.entries(WModel.noteSpec).map(([k,[label]])=>[k,label]),channelLane)+'</optgroup><optgroup label="Automatización de canal">'+options(Object.entries(WModel.groupSpec).map(([k,[label]])=>[k,label]),channelLane)+'</optgroup></select></label>'+
   (WModel.noteSpec[channelLane]?'<span class="w-quiet">'+(n?pitchName(n.pitch)+" · "+formatPos(n.start):'Selecciona una nota')+'</span>':'')+'</div>'+
   (WModel.noteSpec[channelLane]?
    (n?'<div class="w-row w-note-values">'+slider(name,n[channelLane],WModel.noteSpec[channelLane][1],WModel.noteSpec[channelLane][2],'data-nval="'+channelLane+'"',specStep(channelLane))+
    float("Inicio", "w-note-start",n.start,0,1e12,.03125)+float("Duración (pulsos)","w-note-length",n.length,minBeat,1e12,.03125)+btn("Escuchar","id=w-note-preview")+btn("Borrar","id=w-note-delete")+'</div>':"")+
    '<div class="w-lane-bars w-scroll" id="w-lane-scroll"><div style="width:'+rollExtent*4*rollScale+'px">'+c.notes.filter(n=>n.start>=rollOrigin&&n.start<rollOrigin+rollExtent*4).map(n=>noteBar(n,channelLane)).join("")+'</div></div>'
    :automation(c,channelLane==="vol"?"gain":channelLane))+'</div>';
 }
 function noteBar(n,key){
  const [label,lo,hi]=WModel.noteSpec[key];
  return '<button class="w-property '+(n.id===noteId?'selected':'')+'" aria-label="'+label+' '+pitchName(n.pitch)+' '+compact(n[key],3)+'" title="'+label+' '+compact(n[key],3)+'" data-bar="'+n.id+'" style="left:'+(n.start-rollOrigin)*rollScale+'px;height:'+(8+(n[key]-lo)/(hi-lo)*53)+'px"></button>';
 }
 function manual(){
  const t=pTrack(),can=t&&!["audio","bus"].includes(t.kind),base=(oct+1)*12;
  let white=0;
  return '<section class="w-box w-manual"><div class="w-ed-head"><div><h2>Piano manual</h2><small>'+ (can?esc(t.name)+' · ':'')+'25 teclas físicas · '+pitchName(base)+'–'+pitchName(base+24)+'</small></div><div class="w-row"><label class="w-jump">Octava <select id="w-man-oct">'+options(Array.from({length:8},(_,i)=>[i,i]),oct)+'</select></label></div></div>'+
   '<div class="w-piano-scroll"><div class="w-keys">'+WModel.keymap.map((key,i)=>{
    const accidental=names[i%12].includes("♯"),position=white;
    if(!accidental)white++;
    return '<button class="'+(accidental?'black':'white')+'" style="--p:'+position+'" data-manual="'+i+'" aria-label="'+pitchName(base+i)+' · '+key.toUpperCase()+'" '+(!can?'disabled':'')+'><span>'+pitchName(base+i)+'</span><b>'+key.toUpperCase()+'</b></button>';
   }).join("")+'</div></div></section>';
 }
 function previewButton(){
  const running=audition?.clip===clipId;
  return btn(running?"■ Detener patrón":"▸ Escuchar patrón",'data-preview-pattern aria-pressed="'+Boolean(running)+'"',"w-pattern-play");
 }
 const stepsPerBar=16, maxRackSteps=1024;
 const rackSteps=c=>Math.max(1,Math.ceil(c.length*4));
 const lastRackBar=c=>Math.floor((rackSteps(c)-1)/stepsPerBar);
 function rack(){
  const c=pClip(),t=pTrack();
  const tracks=project.tracks.filter(track=>!["audio","bus"].includes(track.kind));
  if(!tracks.length)return '<div class="w-empty-detail"><strong>Channel Rack</strong><p>Añade un instrumento para crear patrones.</p></div>';
  const pickers='<label class="w-jump">Canal <select id="w-rack-track">'+options([["","Seleccionar"],...tracks.map(x=>[x.id,x.name])],t?.id||"")+'</select></label>'+
   (c&&!c.asset?'<label class="w-jump">Patrón <select id="w-rack-pattern">'+options(t.clips.map((x,i)=>[x.id,"Patrón "+(i+1)+" · compás "+(Math.floor(x.start/4)+1)]),c.id)+'</select></label>':"");
  const head='<div class="w-ed-head"><div><h2>Channel Rack</h2><small>Secuenciador de 16 pasos por compás</small></div><div class="w-row">'+pickers+
   (c&&!c.asset?previewButton():"")+(t?.kind==="drums"?btn("Abrir Larp Drums","data-mode='Larp Drums'"):"")+'</div></div>';
  if(!t||!c||c.asset)return head+'<div class="w-empty-detail">Selecciona un canal de instrumento y un patrón.</div>';
  const isDrum=t.kind==="drums",root=Math.min(115,rackRoot),midi=isDrum?[]:[0,2,4,5,7,9,11,12].map(n=>root+n);
  const labels=isDrum?WModel.padNames:midi.map(pitchName),total=rackSteps(c);
  const last=lastRackBar(c);
  rackBar=Math.min(rackBar,last);
  const first=rackBar*stepsPerBar;
  const controls='<div class="w-rack-tools w-row">'+btn("‹","data-drum-bar=-1 aria-label='Compás anterior' "+(rackBar===0?"disabled":""))+
    '<label class="w-jump">Compás del patrón <input id="w-rack-bar" type="number" min="1" max="'+(last+1)+'" value="'+(rackBar+1)+'"></label>'+
    btn("›","data-drum-bar=1 aria-label='Compás siguiente' "+(rackBar===last?"disabled":""))+
    '<label class="w-jump">Total de pasos <input id="w-rack-steps" type="number" min="1" max="'+Math.max(maxRackSteps,total)+'" value="'+total+'"></label>'+
    (isDrum?"":'<label class="w-jump">Raíz <select id="w-rack-root">'+options(Array.from({length:72},(_,i)=>[i+24,pitchName(i+24)]),root)+'</select></label>')+
    '<span class="w-rack-help">Pulsa el nombre para escuchar el sonido</span></div>';
  const steps=labels.map((name,i)=>'<div class="w-step-row" style="--track:'+palette[i]+'">'+
    btn(esc(name),'data-rack-sound="'+(isDrum?i:midi[i])+'"','w-step-label')+
    Array.from({length:Math.min(stepsPerBar,total-first)},(_,j)=>{
     const number=first+j+1,beat=(number-1)/4;
     const on=isDrum?c.layers.some(h=>h.pad===i&&Math.abs(h.beat-beat)<.00001):c.notes.some(n=>n.pitch===midi[i]&&Math.abs(n.start-beat)<.00001);
     const value=(isDrum?i:midi[i])+':'+beat;
     return btn(""+number,'aria-label="'+esc(name)+' paso '+number+'" data-step="'+value+'" data-pulse="'+(j/4)+'" aria-pressed="'+on+'"');
    }).join("")+'</div>').join("");
  return head+controls+'<div class="w-steps w-scroll">'+steps+'</div>';
 }
 function drumPanel(t){
  const cfg=t.kit[selectedPad],asset=project.assets[cfg.sample],name=WModel.padNames[selectedPad];
  return '<div class="w-kit-panel-inner"><div class="w-kit-inspector"><div><h3>'+name+'</h3><small>'+(asset?"Muestra importada":"Síntesis")+'</small></div>'+
   '<span class="w-pad-key">'+WModel.padKeys[selectedPad].toUpperCase()+'</span></div>'+
   '<label class="w-jump w-kit-select">Pieza <select id="w-pad-select">'+options(WModel.padNames.map((v,i)=>[i,v]),selectedPad)+'</select></label>'+
   '<canvas class="w-pad-wave" id="w-pad-wave" width="340" height="76" aria-label="'+(asset?"Forma de onda de la muestra":"Envolvente del pad")+'"></canvas>'+
   '<div class="w-drum-knobs">'+Object.entries(WModel.padSpec).map(([key,[label,min,max,,step]])=>{
    const angle=-132+264*(cfg[key]-min)/(max-min);
    return '<label class="w-drum-knob"><span>'+label+'</span><i class="w-drum-dial" style="--angle:'+angle+'deg"></i>'+
     '<input type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+cfg[key]+'" data-pad-param="'+key+'"><output>'+compact(cfg[key],1)+'</output></label>';
   }).join("")+'</div><div class="w-kit-sample"><b>Sonido de la pieza</b><span>'+esc(asset?.name||"Sonido del kit")+'</span>'+
   '<div class="w-row">'+fileInput("w-pad-file","Sustituir sonido","audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff,.aif,.opus")+
   (asset?btn("Restaurar","id=w-pad-reset"):"")+'</div></div>'+btn("Escuchar pieza","id=w-pad-listen","w-pad-listen")+'</div>';
 }
 function drums(){
  const c=pClip(),t=pTrack();
  if(!t||t.kind!=="drums")return '<div class="w-empty-detail">Selecciona una pista de Batería.</div>';
  return '<div class="w-ed-head w-kit-header"><div><h2>Larp Drums</h2><small>'+esc(t.name)+'</small></div><div class="w-row">'+
   '<label class="w-jump">Kit <select id="w-kit-style">'+options([["studio","Estudio"],["dry","Seco"]],t.kitStyle)+'</select></label>'+
   (c?previewButton()+recordMenu("drums","Grabar batería","w-drum-record"):btn("＋ Crear patrón","data-create-drum-pattern"))+'</div></div>'+
   '<div class="w-kit-layout"><div class="w-kit-stage"><div class="w-kit-picture" aria-label="Batería acústica interactiva">'+
   WModel.padNames.map((name,i)=>'<button type="button" class="w-kit-piece" data-pad="'+i+'" aria-label="'+name+' · tecla '+WModel.padKeys[i].toUpperCase()+'" aria-pressed="'+(selectedPad===i)+'" style="--pad:'+palette[i]+'"><kbd>'+WModel.padKeys[i].toUpperCase()+'</kbd><span>'+name+'</span></button>').join("")+
   '</div><div class="w-kit-footer"><span id="w-drum-status" role="status">'+(drumTake?"Toca para grabar en el patrón activo.":"Toca las piezas o usa las teclas marcadas.")+'</span>'+
   (c?'<label><input id="w-drum-snap" type="checkbox" '+(drumSnap?"checked":"")+'> Cuantizar a 1/16</label>':"")+'</div></div>'+
   '<aside class="w-kit-panel" id="w-kit-panel">'+drumPanel(t)+'</aside></div>';
 }
 function calibration(t,c){
  if(t?.kind!=="audio"||!c?.asset)return "";
  const fx=t.mix.fx.find(f=>f.kind==="bpm"),asset=project.assets[c.asset],measurement=asset?.tempo,sync=WModel.audioGrid(project,t,c);
  const use=c.sourceBpm>0?"Manual":sync.bpm?"Detectado":"Sin pulso fiable";
  const message=!fx?.enabled?"Original":!sync.bpm?"Introduce el BPM de origen":!sync.synced?"Conversión fuera del rango 0,5× a 2×":"Ajustado al proyecto · "+compact(sync.rate,3)+"×";
  return '<div class="w-calibrator"><div class="w-cal-head"><div><h3>Calibrador BPM</h3><small>'+esc(asset.name)+'</small></div><div class="w-row">'+
   (fx?btn(fx.enabled?"En bypass":"Activar", 'data-bpm-toggle aria-pressed="'+fx.enabled+'"'):btn("Añadir plugin","data-bpm-add","primary"))+'</div></div>'+
   '<div class="w-cal-grid"><div><small>BPM DE ORIGEN</small><strong>'+(sync.bpm||"—")+'</strong><span>'+use+'</span></div><div><small>BPM DEL PROYECTO</small><strong>'+project.bpm+'</strong><span>'+message+'</span></div>'+
   '<div><small>AJUSTE POR CLIP</small><label class="w-jump">BPM manual <input id="w-source-bpm" type="number" min="0" max="300" step=".1" placeholder="Automático" value="'+(c.sourceBpm||"")+'"></label>'+
   (measurement?.candidate&&!measurement.bpm?'<span>Sugerencia '+measurement.candidate+' BPM</span>':'<span>Campo vacío = detección automática</span>')+
   (measurement?.bpm?'<div class="w-row">'+btn("½ BPM","data-bpm-scale=.5")+btn("×2 BPM","data-bpm-scale=2")+'</div>':"")+'</div></div></div>';
 }
 function clips(){
  const t=pTrack(),c=pClip();
  return '<div class="w-ed-head"><div><h2>Clips de audio</h2><small>Audio local o de la biblioteca</small></div><div class="w-row">'+fileInput("w-media","Importar audio","audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff,.aif,.opus")+
   '<select id="w-library" aria-label="Audio de biblioteca">'+options([["","Elegir audio para preescuchar"],...sources().map(s=>[s.id,s.title])],"")+'</select></div></div>'+
   calibration(t,c)+(c?('<div class="w-calibrator w-row">'+float("Inicio (pulsos)","w-trim-start",c.start,0,1e12,.0001)+
    float("Fin (pulsos)","w-trim-end",c.start+c.length,0,1e12,.0001)+btn("Aplicar recorte","id=w-trim")+btn("Dividir en el cursor","id=w-split-at-head")+'</div>')+
    automation(c,"gain"):'<div class="w-empty-detail">Importa un archivo, o selecciona un clip del arreglo para editar su volumen.</div>');
 }
 const specStep=key=>["release","q","speed","room","rate"].includes(key)?.01:1;
 function automation(c,key){
  const keyLabel={gain:"Volumen de clip",pan:"Pan de canal",pitch:"Tono de canal"}[key];
  return '<div class="w-automation" data-auto="'+key+'"><div class="w-row"><b>'+keyLabel+'</b><small>Haz clic para añadir un punto · arrastra para ajustar · clic derecho para quitar</small></div><canvas id="w-auto-canvas" width="1100" height="100" aria-label="'+keyLabel+'" tabindex="0"></canvas>'+
   '<div class="w-row">'+float("Pulso","w-auto-at",0,0,c.length,.03125)+float(key==="gain"?"Nivel (dB)":key==="pan"?"Pan (%)":"Tono (¢)","w-auto-value",0,key==="gain"?-60:key==="pan"?-100:-1200,key==="gain"?12:key==="pan"?100:1200,.1)+btn("Fijar punto","id=w-auto-set")+'</div></div>';
 }
 function automationPanel(){
  const c=pClip();
  return '<div class="w-ed-head"><div><h2>Automatización</h2><small>'+esc(pTrack()?.name||"Arreglo")+'</small></div></div>'+
   (c?automation(c,"gain"):'<div class="w-empty-detail">Selecciona un clip en el arreglo para editar su envolvente.</div>');
 }
 function strip(t,m){
  const id=t?.id||"master",name=t?.name||"Master",active=id===mixerId;
  const width=m.width<0?Math.abs(m.width)+"% merged":m.width>0?m.width+"% separado":"Original";
  const timeText=(m.time>0?"+":"")+compact(m.time,3)+({ms:" ms",samples:" m",beats:" p"}[m.unit]);
  return '<div class="w-strip '+(!t?'w-master ':'')+(active?'selected':'')+'" data-strip="'+id+'" style="--track:'+(t?tint(t):"#dabaff")+'">'+
   '<button class="w-strip-name" data-mix-select="'+id+'"><small>'+(!t?"SALIDA":t.kind==="bus"?"BUS":"INSERT")+'</small><b>'+esc(name)+'</b></button>'+
   '<div class="w-strip-switch"><button data-mix-toggle="'+id+':mute" aria-label="Silenciar '+esc(name)+'" aria-pressed="'+m.mute+'">M</button>'+
   (t?'<button data-mix-toggle="'+id+':solo" aria-label="Solo '+esc(name)+'" aria-pressed="'+m.solo+'">S</button>':'')+'</div>'+
   '<label class="w-pan"><span>Pan</span><i class="w-dial" style="--turn:'+m.pan*1.25+'deg"></i><input data-mix-val="'+id+':pan" class="w-dial-range" aria-label="Pan '+esc(name)+'" type="range" min="-100" max="100" value="'+m.pan+'"><output>'+panLabel(m.pan)+'</output></label>'+
   '<div class="w-strip-switch"><button title="Invertir polaridad" data-mix-toggle="'+id+':polarity" aria-label="Invertir polaridad '+esc(name)+'" aria-pressed="'+m.polarity+'">Ø</button><button title="Intercambiar canales L/R" data-mix-toggle="'+id+':swap" aria-label="Intercambiar canales '+esc(name)+'" aria-pressed="'+m.swap+'">L⇄R</button></div>'+
   '<label class="w-width"><span>Ancho</span><input data-mix-val="'+id+':width" aria-label="Separación estéreo '+esc(name)+'" type="range" min="-100" max="100" value="'+m.width+'"><output>'+width+'</output></label>'+
   '<div class="w-fader"><span>0</span><span>−12</span><span>−24</span><span>−48</span>'+meter(id)+'<input type="range" min="-80" max="6" step=".1" value="'+m.volume+'" data-mix-val="'+id+':volume" aria-label="Volumen '+esc(name)+'"></div>'+
   '<output class="w-db">'+(m.volume<=-80?"−∞":compact(m.volume,1))+' dB</output>'+
   '<button title="Compensación de latencia" class="w-clock" data-clock="'+id+'" aria-label="Latencia '+esc(name)+'">◷ <span>'+timeText+'</span></button>'+
   '<button class="w-route-btn" data-route-focus="'+id+'" title="'+(t?"Enruta a "+esc(labelT(m.route)):"Salida de audio")+'"><i></i><span>'+(t?esc(labelT(m.route)):"Salida")+'</span></button></div>';
 }
 function panLabel(n){return n===0?"Centro":Math.abs(n)+(n<0?"% L":"% R");}
 function mixer(){
  const t=inst(),m=aMixer(),id=t?.id||"master";
  const targets=[["master","Master"],...project.tracks.filter(x=>x.kind==="bus"&&WModel.mayRoute(project,id,x.id)).map(x=>[x.id,x.name])];
  const sends=targets.filter(([k])=>k!=="master"&&k!==m.route&&!m.sends.some(s=>s.to===k));
  const routeDisplay=t?'<div class="w-routing"><label>Salida principal <select id="w-route">'+options(targets,m.route)+'</select></label>'+
    (m.sends.map(s=>'<div class="w-send">'+slider("Envío a "+esc(labelT(s.to)),s.level,-60,0,'data-send-level="'+s.to+'"',.1)+btn("Quitar",'data-remove-send="'+s.to+'" aria-label="Quitar envío a '+esc(labelT(s.to))+'"')+'</div>').join(""))+
    (sends.length?'<div class="w-row"><select aria-label="Bus de envío paralelo" id="w-send-to">'+options(sends,"")+'</select>'+btn("Añadir envío","id=w-add-send")+'</div>':"")+'</div>':'';
  const fx=Object.entries(WModel.effects).filter(([k])=>WModel.pluginAllowed(t?.kind||"bus",k)&&!(k==="bpm"&&m.fx.some(f=>f.kind===k)));
  const suggested=insertSuggestions[t?.kind||"bus"].filter(key=>!m.fx.some(f=>f.kind===key));
  return '<div class="w-ed-head"><div><h2>Mixer</h2><small>Master, inserts y envíos paralelos</small></div><button data-add-kind="bus">＋ Bus</button></div>'+
   '<div class="w-mix-content"><div class="w-mix-board">'+strip(null,project.master)+'<div class="w-strips w-scroll">'+project.tracks.map(x=>strip(x,x.mix)).join("")+'</div><canvas class="w-cables" width="1080" height="48" aria-label="Conexiones del canal seleccionado"></canvas></div>'+
   '<aside class="w-insert"><div class="w-insert-title"><h3>'+esc(labelT(id))+'</h3><span class="w-mix-peak" data-peak="'+id+'">−∞ dBFS</span></div>'+
   '<details id="w-route-details" open><summary>Enrutamiento</summary>'+routeDisplay+
   '<div class="w-path"><span>'+esc(labelT(id))+'</span><i></i><span>'+esc(t?labelT(m.route):"Salida")+'</span></div>'+
   (t?m.sends.map(s=>'<div class="w-path parallel"><span>Envío</span><i></i><span>'+esc(labelT(s.to))+'</span></div>').join(""):"")+'</details>'+
   '<details id="w-clock-details"><summary>Compensación de latencia</summary><div class="w-row"><label class="w-jump">Unidad <select id="w-latency-unit">'+options([["ms","ms"],["samples","Muestras"],["beats","Pulsos"]],m.unit)+'</select></label>'+
   float("Ajuste","w-latency-val",m.time,t?-500000:0,500000,m.unit==="samples"?1:.001)+btn("Restaurar","id=w-latency-reset")+'</div><small id="w-latency-effective">'+compact(WModel.manualMs(m,project.bpm,ctx?.sampleRate||48000),3)+' ms de corrección manual</small></details>'+
   '<div class="w-fx-head"><b>Plugins · '+m.fx.length+'</b>'+(fx.length?'<select id="w-plugin-select" aria-label="Plugin compatible">'+options(fx.map(([k,e])=>[k,e.title]),"")+'</select>'+btn("Añadir","id=w-add-fx"):"")+'</div>'+
   (suggested.length?'<div class="w-insert-suggestions"><small>Sugeridos para '+esc(t?WModel.types[t.kind][0]:"el máster")+'</small><div class="w-row">'+
    suggested.map(key=>btn("＋ "+insertNames[key],'data-add-insert="'+key+'" title="'+esc(WModel.effects[key].title)+'"')).join("")+'</div></div>':"")+
   (m.fx.map((fx,i)=>fxPanel(fx,i,m.fx.length)).join("")||'<small class="w-fx-none">'+(fx.length?"Esta cadena está vacía.":t?.kind==="drums"?"Abre Larp Drums desde la pista de Batería.":"Sin plugins disponibles para este canal.")+'</small>')+'</aside></div>';
 }
 function dial(label,min,max,value,attribute,step=1,unit=""){
  const angle=-137+(value-min)/(max-min)*274;
  return '<label class="w-metal-knob" style="--turn:'+angle+'deg" data-unit="'+esc(unit)+'"><span>'+esc(label)+'</span><span class="w-metal-shaft" aria-hidden="true"></span>'+
   '<input type="range" '+attribute+' min="'+min+'" max="'+max+'" value="'+value+'" step="'+step+'" aria-label="'+esc(label)+'"><output>'+compact(value,2)+esc(unit)+'</output></label>';
 }
 function selectModule(label,items,value,attr){
  return '<label class="w-module-select"><span>'+esc(label)+'</span><select '+attr+' aria-label="'+esc(label)+'">'+options(items.map((x,i)=>[String(i),x]),String(value))+'</select></label>';
 }
 function fxPanel(f,i,total){
  const definition=WModel.effects[f.kind];
  const power=()=>btn(f.enabled?"Encendido":"Apagado",'data-fx-bypass="'+f.id+'" aria-label="'+(f.enabled?"Apagar ":"Encender ")+esc(definition.title)+'" aria-pressed="'+f.enabled+'"',"w-fx-power");
  const header='<summary><i></i><span>'+definition.title+'</span><small>'+(f.enabled?"Activo":"Apagado")+'</small></summary>';
  if(f.kind==="bpm")return '<details open class="w-plugin" data-fx-panel="'+f.id+'" data-fx="bpm">'+header+'<div class="w-pedal" data-powered="'+f.enabled+'">'+
   '<div class="w-pedal-front"><div class="w-pedal-display">BPM</div>'+btn("Ver ajustes",'data-bpm-focus')+'</div><div class="w-pedal-foot">'+power()+btn("Quitar",'data-fx-remove="'+f.id+'"')+'</div></div></details>';
  const pad=fxPads.get(f.id)??0;
  const controls=Object.entries(definition.controls).filter(([key])=>!key.match(/^p\d_/)).map(([key,[name,lo,hi,,step,unit]])=>{
   const attr='data-fx-param="'+f.id+':'+key+'"';
   return definition.choices?.[key]?selectModule(name,definition.choices[key],Math.round(f.values[key]),attr):
    dial(name,lo,hi,f.values[key],attr,step||1,unit);
  });
  const pads=definition.pad?'<div class="w-fx-pads" aria-label="Piezas del plugin">'+WModel.padNames.map((name,n)=>
   btn(String(n+1)+'<span>'+esc(name)+'</span>','data-fx-pad="'+f.id+':'+n+'" aria-pressed="'+(n===pad)+'" aria-label="'+esc(name)+'"')).join("")+
   '</div><div class="w-pad-edit"><strong>'+esc(WModel.padNames[pad])+'</strong>'+btn("Tocar",'data-pad-audition="'+pad+'"')+'</div><div class="w-fx-controls">'+
   Object.entries(definition.controls).filter(([key])=>key.startsWith("p"+pad+"_")).map(([key,[name,lo,hi ,,step]])=>dial(name,lo,hi,f.values[key],'data-fx-param="'+f.id+':'+key+'"',step||1)).join("")+'</div>':"";
  return '<details class="w-plugin" data-fx-panel="'+f.id+'" data-fx="'+f.kind+'" '+(i===total-1||fxPads.has(f.id)?'open':'')+'>'+header+
   '<div class="w-pedal" data-powered="'+f.enabled+'"><div class="w-pedal-brand"><b>'+esc(definition.title.replace(/^Larp /,""))+'</b><i aria-hidden="true"></i></div>'+
   '<div class="w-fx-controls">'+controls.join("")+'</div>'+pads+
   '<div class="w-pedal-foot">'+power()+'<div class="w-row">'+btn("↑",'data-fx-shift="'+f.id+':-1" aria-label="Subir plugin" '+(i===0?"disabled":""))+
   btn("↓",'data-fx-shift="'+f.id+':1" aria-label="Bajar plugin" '+(i===total-1?"disabled":""))+btn("Quitar",'data-fx-remove="'+f.id+'"')+'</div></div></div></details>';
 }
 function instrumentModule(){
  const t=pTrack(),d=WInstruments.defs[t.kind],v=WInstruments.get(t),can=Boolean(pClip());
  if(ctx)prepareTakes(ctx,t);
  const renderControl=(key,p)=>p.options?selectModule(p.label,p.options,Math.round(v[key]),'data-instrument-param="'+key+'"'):
   dial(p.label,p.min,p.max,v[key],'data-instrument-param="'+key+'"',p.step,p.unit);
  const presets=[["-1","Ajuste propio"],...d.presets.map(([label],i)=>[String(i),label])];
  return '<div class="w-instrument-module" data-instrument-kind="'+t.kind+'"><div class="w-instrument-hero">'+
   (t.kind==="fx"?'<figure class="w-fx-scope"><canvas width="520" height="138" aria-label="Contorno de la frecuencia y de la envolvente del efecto"></canvas><figcaption>Frecuencia <span>Envolvente</span></figcaption></figure>':"")+
   '<div class="w-module-ident"><h2>'+d.title+'</h2><div class="w-module-pickers">'+renderControl("model",d.models)+
   '<label class="w-module-select"><span>Preset</span><select id="w-instrument-preset" aria-label="Preset del instrumento">'+options(presets,String(t.instrumentPreset??-1))+'</select></label></div>'+
   '<div class="w-row">'+recordMenu("keys","Grabar instrumento","w-record",!can)+(can?previewButton():"")+
    (WInstruments.isGuitar(t.kind)?btn("Soltar sostenidos","data-instrument-release"):"")+'</div></div></div>'+
   '<div class="w-module-groups">'+d.panels.map(([name,items])=>'<fieldset><legend>'+esc(name)+'</legend><div class="w-module-controls">'+
    Object.entries(items).map(([key,p])=>renderControl(key,p)).join("")+'</div></fieldset>').join("")+'</div>'+
   manual()+'</div>';
 }
 function drawFxContour(){
  const canvas=out.querySelector(".w-fx-scope canvas");if(!canvas)return;
  const v=WInstruments.get(pTrack()),g=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  const from=[.06,.87,.88,.39][v.model],to=[.84,.16,.15,.62][v.model];
  const rise=[.70,.018/v.duration,.007/v.duration,Math.min(.35,.6/v.duration)][v.model];
  const sustain=[.80,.18,.014,.63][v.model],sweep=v.sweep/48;
  g.clearRect(0,0,w,h);g.strokeStyle="#56676f";g.lineWidth=1;
  g.beginPath();
  for(let x=12;x<w;x+=31){g.moveTo(x,0);g.lineTo(x,h);}
  for(let y=11;y<h;y+=24){g.moveTo(0,y);g.lineTo(w,y);}
  g.stroke();
  const plot=(color,dashed,fn)=>{
   g.beginPath();g.strokeStyle=color;g.lineWidth=2.3;g.setLineDash(dashed?[5,5]:[]);
   for(let i=0;i<=150;i++){
    const t=i/150,x=8+t*(w-16),y=h-9-fn(t)*(h-18);
    if(i)g.lineTo(x,y);else g.moveTo(x,y);
   }
   g.stroke();g.setLineDash([]);
  };
  const gate=v.duration/(v.duration+v.release);
  plot("#8ef4df",false,t=>.48+(from+(to-from)*Math.min(1,t/gate)**(v.model===2? .23:1)-.48)*sweep);
  plot("#ffd39e",true,t=>{
   const span=t/gate;
   if(span<rise)return span/rise;
   if(span<1)return sustain**((span-rise)/(1-rise));
   return sustain*Math.max(0,1-(t-gate)/(1-gate))**3;
  });
 }
 function instrument(){
  const t=pTrack();
  if(!t||["bus","audio","drums"].includes(t.kind))return "";
  return '<div class="w-inst"><div><b>'+esc(WModel.types[t.kind][0])+'</b><small>Instrumento de la pista</small></div>'+
   slider("Timbre",t.timbre,0,100,'data-timbre="timbre"')+slider("Ataque (s)",t.attack,.001,.45,'data-timbre="attack"',.001)+
   slider("Liberación (s)",t.release,.01,2,'data-timbre="release"',.01)+
   '</div>';
 }
 function render(){
  if(!isOpen())return;
  const identity=session.user?.id||"guest";
  if (identity!==owner) {
   if(owner)sessions.set(owner,project);
   owner=identity;
   clipboard=null;
   clearProject(sessions.get(identity)||WModel.empty(),false);
  }
  cancelAnimationFrame(meters);enabled=true;
  const play=transport!==null,ts=pTrack(),cs=pClip();
  const title=ts&&WInstruments.defs[ts.kind]?.title;
  const visibleTabs=["Piano roll","Channel rack","Mixer","Clips de audio"].concat(ts?.kind==="drums"?["Larp Drums"]:title?[title]:[]).concat(mode==="Automatización"?["Automatización"]:[]);
  if(mode!=="Larp Drums"&&mode.startsWith("Larp ")&&mode!==title)mode=title||"Piano roll";
  const hasPanel=mode===title&&Boolean(title);
  const exporting=projectUpload?.owner===owner?projectUpload:null;
  if(mode==="Larp Drums"&&ts?.kind!=="drums")mode="Piano roll";
  if(mode!=="Larp Drums"&&drumTake)endInstrumentTake();
  out.innerHTML='<div class="wb"><div class="w-top"><div class="w-project"><span>ESTUDIO</span><input id="w-project-name" aria-label="Nombre del proyecto" maxlength="80" value="'+esc(project.name)+'"></div><div class="w-row w-files">'+btn("Nuevo","id=w-new")+fileInput("w-open","Abrir proyecto",".json,application/json")+fileInput("w-midi","Importar MIDI",".mid,.midi,audio/midi")+btn("Guardar proyecto","id=w-save")+btn("Proyectos anteriores","id=w-legacy")+'</div>'+
    '<section class="w-mix-export" aria-label="Exportar mezcla"><label><span>WAV estéreo · 24 bits</span><select id="w-export-rate" aria-label="Frecuencia de exportación" '+(exporting?"disabled":"")+'>'+options(studioRates.map(rate=>[rate,rate/1000+" kHz"]),exportRate)+'</select></label><div class="w-row">'+
    btn("Descargar WAV","id=w-download-mix "+(exporting?"disabled":""))+btn("Subir",'id=w-upload title="Subir la mezcla WAV a Biblioteca → Pistas" '+(exporting?"disabled":""),"primary")+'</div>'+
    '<output id="w-export-status" aria-live="polite">'+esc(exporting?.message||"")+'</output></section></div>'+
    '<div class="w-transport"><div class="w-row">'+btn(play?"■ Detener":"▸ Reproducir","id=w-play",play?"":"primary")+
    (mode==="Larp Drums"||hasPanel?"":recordMenu("keys","Grabar instrumento","w-record",!ts||!cs||["audio","bus"].includes(ts.kind)))+recordMenu("mic","Grabar audio","w-mic-record")+
    '<div class="w-counter"><span id="w-position">'+formatPos(head)+'</span><small>COMPÁS · PULSO</small></div>'+
    float("BPM","w-bpm",project.bpm,30,300,.1).replace("<input","<input "+(takeClock||micTake?"disabled":""))+btn("↶","id=w-undo aria-label='Deshacer' "+(!undo.length?"disabled":""))+btn("↷","id=w-redo aria-label='Rehacer' "+(!redo.length?"disabled":""))+'</div>'+
    '<div class="w-row w-add"><select id="w-add-kind" aria-label="Instrumento o pista">'+options(Object.entries(WModel.types).map(([kind,[name]])=>[kind,name]),"synth")+'</select>'+btn("＋ Añadir pista","id=w-add",project.tracks.length?"":"primary")+'</div></div>'+
    recordingStatus()+'<section class="w-box">'+arrangement()+'</section>'+
    '<section class="w-box"><div class="w-tabs">'+toolbar(visibleTabs,mode,"mode")+
      (ts?'<label class="w-jump w-rename">Nombre <input id="w-track-name" maxlength="80" value="'+esc(ts.name)+'"></label>'+btn("Quitar pista","id=w-remove-track")+"":"")+
      (cs?btn("Quitar clip","id=w-remove-clip"):"")+'</div>'+
    (hasPanel?instrumentModule():({ "Piano roll":piano,"Channel rack":rack,"Mixer":mixer,"Clips de audio":clips,"Larp Drums":drums,"Automatización":automationPanel }[mode])())+'</section>'+
    (hasPanel?"":instrument())+(mode==="Larp Drums"||hasPanel?"":manual())+'</div>';
  bind();bindKitPanel();updateRecordingStatus();restoreScroll();drawRulers();drawAutomation();paintClipWaves();drawCables();drawFxContour();
  if(mode==="Mixer"||play||audition)tick();
 }
 function tick(){
  if(!isOpen())return;
  if(audition&&mode==="Channel rack"){
   const elapsed=Math.max(0,(ctx.currentTime-audition.start)*audition.bpm/60);
   const pos=Math.floor((elapsed-rackBar*4)*4);
   for(const k of out.querySelectorAll("[data-step]"))k.classList.toggle("w-step-playhead",pos>=0&&pos<16&&+k.dataset.pulse===pos/4);
  }
  if(transport){
   head=Math.max(transport.from,transport.from+(ctx.currentTime-transport.at)*project.bpm/60);
   const caret=$(".w-head");if(caret)caret.style.left=(head-arrOrigin)*arrScale+"px";
   const counter=$("#w-position");if(counter)counter.textContent=formatPos(head);
  }
  for(const el of out.querySelectorAll("[data-meter]")){
   const n=WDSP.measure(el.dataset.meter);el.firstElementChild.style.height=clamp((n+60)/60*100,0,100)+"%";el.classList.toggle("clip",n>=0);
  }
  for(const el of out.querySelectorAll("[data-peak]")){
   const v=WDSP.measure(el.dataset.peak);el.textContent=(v<=-100?"−∞":compact(v,1))+" dBFS";
  }
  meters=requestAnimationFrame(tick);
 }
 function drawCables(){
  const canvas=$(".w-cables");if(!canvas)return;
  const rect=canvas.getBoundingClientRect(),w=canvas.width=Math.max(1,Math.round(rect.width)),g=canvas.getContext("2d");
  g.clearRect(0,0,w,48);
  function locate(id){
   const end=out.querySelector('[data-route-focus="'+id+'"]');
   if(!end)return null;
   const r=end.getBoundingClientRect(),x=r.left+r.width/2-rect.left;
   return clamp(x,id==="master"?5:92,w-6);
  }
  function plug(x){g.beginPath();g.arc(x,5,3.3,0,Math.PI*2);g.fill();}
  if(mixerId==="master")return;
  const m=aMixer(),origin=locate(mixerId);if(origin===null)return;
  g.strokeStyle=g.fillStyle="#87dda5";g.lineWidth=1.45;
  for(const [i,id] of [m.route,...m.sends.map(s=>s.to)].entries()){
   const x=locate(id);if(x===null||Math.abs(x-origin)<6)continue;
   const h=Math.min(43,21+i*7);g.setLineDash(i?[4,4]:[]);
   g.beginPath();g.moveTo(origin,5);g.bezierCurveTo(origin,h,x,h,x,5);g.stroke();plug(x);
  }
  plug(origin);
 }
 function paintClipWaves(){
  for(const t of project.tracks)for(const c of t.clips){
   const asset=project.assets[c.asset];if(!asset?.peaks?.length)continue;
   const canvas=out.querySelector('[data-part="'+c.id+'"] canvas');if(!canvas)continue;
   const g=canvas.getContext("2d"),scale=c.sourceScale||60/project.bpm,start=c.offset*scale,span=c.length*scale;
   g.fillStyle=tint(t);
   for(let i=0;i<canvas.width;i++){
    const index=Math.floor((start+span*i/canvas.width)/asset.duration*asset.peaks.length);
    const h=Math.min(11,(asset.peaks[index]||0)*18);if(h>0)g.fillRect(i,11-h,1,h*2);
   }
  }
 }
 function restoreScroll(){
  const a=$("#w-arr-scroll"),r=$("#w-roll-scroll"),l=$("#w-lane-scroll");
  if(a)a.scrollLeft=arrLeft;
  if(r){r.scrollLeft=rollLeft;r.scrollTop=rollTop;}
  if(l)l.scrollLeft=rollLeft;
 }
 function drawRulers(){
  for(const [selector,scale,scroll,origin] of [["arr",arrScale,$("#w-arr-scroll"),arrOrigin],["roll",rollScale,$("#w-roll-scroll"),rollOrigin]]){
   const el=$('[data-ruler="'+selector+'"]');if(!el||!scroll)continue;
   const left=Math.max(0,Math.floor(scroll.scrollLeft/(4*scale))-1),count=Math.ceil(scroll.clientWidth/(4*scale))+4;
   el.innerHTML=Array.from({length:count},(_,i)=>'<span style="left:'+((left+i)*4*scale)+'px">'+(origin/4+left+i+1)+'</span>').join("");
  }
 }
 function jump(beat,roll=false){
  const key=roll?"roll":"arr";
  const b=clamp(beat,0,1e12),current=roll?rollOrigin:arrOrigin;
  const origin=b<current||b>=current+360?Math.max(0,Math.floor(b/32)*32-16):current;
  if(roll){rollOrigin=origin;rollLeft=(b-origin)*rollScale;rollExtent=Math.max(32,chapters((b-origin)/4+3));}
  else{head=b;arrOrigin=origin;arrLeft=(b-origin)*arrScale;extent=Math.max(32,chapters((b-origin)/4+3));}
  render();
 }
 function displaySelected(t,c){
  pick(t,c);
  if(mode==="Larp Drums"&&t.kind!=="drums")mode="Piano roll";
  if(c&&c.id!==currentRoll){
   rollOrigin=0;rollLeft=0;rollExtent=32;currentRoll=c.id;
  }
 }
 let arrOrigin=0,rollOrigin=0,currentRoll="";
 function extend(scroll,roll){
  if(!scroll.isConnected)return;
  const scale=roll?rollScale:arrScale,limit=roll?rollExtent:extent;
  const beyond=scroll.scrollWidth-scroll.clientWidth-scroll.scrollLeft<120;
  if(beyond&&limit<96){
   if(roll)rollExtent=Math.min(96,rollExtent+16);else extent=Math.min(96,extent+16);
   const content=scroll.firstElementChild;
   content.style.width=((roll?rollExtent:extent)*4*scale+(roll?57:0))+"px";
   const lane=$("#w-lane-scroll > div");if(roll&&lane)lane.style.width=rollExtent*4*scale+"px";
  }else if(beyond&&limit>=96){
   if(roll){rollOrigin+=256;rollLeft-=scale*256;}
   else{arrOrigin+=256;arrLeft-=scale*256;}
   render();
  }else if(scroll.scrollLeft===0&&(roll?rollOrigin:arrOrigin)>0){
   if(roll){const shift=Math.min(128,rollOrigin);rollOrigin-=shift;rollLeft+=scale*shift;}
   else{const shift=Math.min(128,arrOrigin);arrOrigin-=shift;arrLeft+=scale*shift;}
   render();
  }
 }
 function coordinates(e,grid,scale,origin=0){return origin+(e.clientX-grid.getBoundingClientRect().left)/scale;}
 function pointerDrag(e,onMove,complete){
  const start=e.target;
  start.setPointerCapture(e.pointerId);
  const cleanup=()=>{
   start.removeEventListener("pointermove",onMove);start.removeEventListener("pointerup",finish);start.removeEventListener("pointercancel",cancel);
  };
  const finish=ev=>{cleanup();complete(ev);};
  const cancel=()=>{cleanup();render();};
  start.addEventListener("pointermove",onMove);start.addEventListener("pointerup",finish);start.addEventListener("pointercancel",cancel);
 }
 function splitAt(t,c,cut){
  if(cut-c.start<minBeat||c.start+c.length-cut<minBeat){toast("Coloca el cursor dentro del clip para dividirlo.");return;}
  stop();mutate(()=>{
   const right=WModel.split(c,cut);t.clips.push(right);displaySelected(t,right);
   head=cut;arrangePasteBeat=null;editTarget="clip";
  });
 }
 function maxClipEnd(c){
  const duration=project.assets[c.asset]?.duration;
  return duration?Math.max(c.start+c.length,c.start+duration/(c.sourceScale||60/project.bpm)-c.offset):Infinity;
 }
 function dragArrange(e){
  if(e.button!==0)return;
  const row=e.target.closest("[data-arrrow]"),t=project.tracks.find(x=>x.id===row?.dataset.arrrow);
  const el=e.target.closest("[data-part]"),c=t?.clips.find(c=>c.id===el?.dataset.part);
  if(!c||!row)return;
  e.preventDefault();
  if(takeClock||micTake){toast("Detén la grabación antes de editar.");return;}
  editTarget="clip";arrangePasteBeat=null;
  const at=coordinates(e,row,arrScale,arrOrigin),original=c.start,originalLength=c.length,offset=c.offset;
  const trim=e.target.dataset.size;
  const timelineBeat=(beat,key)=>key.altKey?compact(beat,4):snapAt(beat);
  if(!trim&&arrTool==="Dividir"){
   splitAt(t,c,timelineBeat(at,e));
   return;
  }
  if(!trim&&arrTool==="Volumen"){displaySelected(t,c);mode="Automatización";render();return;}
  const end=original+originalLength,max=maxClipEnd(c);
  let changed=false;
  const adjusted=ev=>(ev.clientX-e.clientX)/arrScale;
  const bounds=ev=>trim==="start"?[clamp(timelineBeat(original+adjusted(ev),ev),original,end-minBeat),end]:
   [original,clamp(timelineBeat(end+adjusted(ev),ev),original+minBeat,max)];
  pointerDrag(e,ev=>{
   if(Math.abs(ev.clientX-e.clientX)<3&&!changed)return;
   changed=true;
   const delta=adjusted(ev);
   if(trim){const [first,last]=bounds(ev);el.style.left=(first-arrOrigin)*arrScale+"px";el.style.width=Math.max(3,(last-first)*arrScale-2)+"px";}
   else if(arrTool==="Deslizar"&&c.asset)el.style.backgroundPositionX=delta*arrScale+"px";
   else el.style.left=(snapAt(original+delta)-arrOrigin)*arrScale+"px";
  },ev=>{
   if(changed){
    stop();checkpoint();const delta=adjusted(ev);
    if(trim)WModel.trim(c,...bounds(ev));
    else if(arrTool==="Deslizar"&&c.asset){
     const max=(project.assets[c.asset]?.duration||0)/(c.sourceScale||60/project.bpm);
     c.offset=clamp(snapAt(offset+delta),0,Math.max(0,max-minBeat));
    }else c.start=snapAt(original+delta);
   }
   displaySelected(t,c);
   if(t.kind==="audio")mode="Clips de audio";
   render();
  });
 }
 function dragNote(e,tapped=false){
  if(e.button!==0)return;
  const grid=e.currentTarget,c=pClip(),n=pClip()?.notes.find(n=>n.id===e.target.closest("[data-note]")?.dataset.note);
  if(!c)return;
  editTarget="note";notePasteBeat=null;
  const midi=ev=>clamp(Number(grid.dataset.high)-Math.floor((ev.clientY-grid.getBoundingClientRect().top)/20),+grid.dataset.low,+grid.dataset.high);
  const at=ev=>snapAt(coordinates(ev,grid,rollScale,rollOrigin));
  if(!n){
   if(e.pointerType==="touch"&&!tapped){
    const x=e.clientX,y=e.clientY;
    grid.addEventListener("pointerup",ev=>{
     if(ev.pointerId===e.pointerId&&Math.hypot(ev.clientX-x,ev.clientY-y)<8)dragNote(ev,true);
    },{once:true});
    return;
   }
   if(tool!=="Dibujar"){setNotePasteBeat(at(e));return;}
   const next=WModel.note(at(e),midi(e),snap);
   mutate(()=>{c.notes.push(next);noteId=next.id;c.length=Math.max(c.length,next.start+next.length);});
   previewNote(next);
   return;
  }
  e.preventDefault();
  if(tool==="Borrar"){
   removeNote(c,n);
   return;
  }
  if(tool==="Cortar"){
   const cut=at(e)-n.start;
   if(cut<minBeat||n.length-cut<minBeat)return;
   mutate(()=>{const right={...n,id:uid(),start:n.start+cut,length:n.length-cut};n.length=cut;c.notes.push(right);noteId=right.id;});
   return;
  }
  const el=e.target.closest("[data-note]"),edge=e.target.dataset.size;
  const start=n.start,pitch=n.pitch,length=n.length;
  const res=ev=>{
   const delta=(ev.clientX-e.clientX)/rollScale,pitchDelta=midi(ev)-midi(e);
   if(edge==="start"){const next=Math.min(start+length-minBeat,snapAt(start+delta));return [next,pitch,start+length-next];}
   if(edge==="end")return [start,pitch,Math.max(minBeat,snapAt(length+delta))];
   return [snapAt(start+delta),clamp(pitch+pitchDelta,+grid.dataset.low,+grid.dataset.high),length];
  };
  let changed=false;
  pointerDrag(e,ev=>{
   if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<3&&!changed)return;
   changed=true;
   const [pos,nn,len]=res(ev);
   el.style.left=(pos-rollOrigin)*rollScale+"px";el.style.width=Math.max(3,len*rollScale-1)+"px";
   el.style.top=((+grid.dataset.high-nn)*20+2)+"px";
  },ev=>{
   if(changed){checkpoint();[n.start,n.pitch,n.length]=res(ev);c.length=Math.max(c.length,n.start+n.length);}
   noteId=n.id;render();if(!changed)previewNote(n);
  });
 }
 function autoRange(key){return key==="gain"?[-60,12]:key==="pan"?[-100,100]:[-1200,1200];}
 function drawAutomation(){
  const canvas=$("#w-auto-canvas"),c=pClip();if(!canvas||!c)return;
  const g=canvas.getContext("2d"),key=canvas.parentElement.dataset.auto,[min,max]=autoRange(key),w=canvas.width,h=canvas.height;
  const x=b=>8+clamp(b/c.length,0,1)*(w-16),y=v=>7+(1-(v-min)/(max-min))*(h-14);
  g.clearRect(0,0,w,h);g.fillStyle="#171823";g.fillRect(0,0,w,h);
  g.strokeStyle="#2c2c42";g.lineWidth=1;g.beginPath();
  for(let i=0;i<=16;i++){const left=8+i*(w-16)/16;g.moveTo(left,0);g.lineTo(left,h);}
  for(const level of [min,0,max]){g.moveTo(0,y(level));g.lineTo(w,y(level));}
  g.stroke();g.beginPath();
  g.moveTo(x(0),y(WModel.at(c[key],0)));
  for(const point of c[key])g.lineTo(x(point.beat),y(point.value));
  g.lineTo(x(c.length),y(WModel.at(c[key],c.length)));
  g.lineTo(w-8,h);g.lineTo(8,h);g.closePath();g.fillStyle="#986bef32";g.fill();
  g.beginPath();g.moveTo(x(0),y(WModel.at(c[key],0)));
  for(const point of c[key])g.lineTo(x(point.beat),y(point.value));
  g.lineTo(x(c.length),y(WModel.at(c[key],c.length)));
  g.strokeStyle="#bdabff";g.lineWidth=2.5;g.stroke();g.fillStyle="#dfd3ff";
  for(const point of c[key]){g.beginPath();g.arc(x(point.beat),y(point.value),4,0,Math.PI*2);g.fill();}
 }
 function insertPoint(c,key,beat,value){
  const clean=clamp(beat,0,c.length),at=c[key].find(p=>Math.abs(p.beat-clean)<1e-7);
  if(at)at.value=value;else c[key].push({beat:clean,value});
  c[key].sort((a,b)=>a.beat-b.beat);
 }
 function bindCanvas(canvas){
  const c=pClip(),key=canvas.parentElement.dataset.auto,[lo,hi]=autoRange(key);
  function xy(e){
   const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
   return [clamp(snapAt(x*c.length),0,c.length),compact(clamp(hi-y*(hi-lo),lo,hi),1),x,r.width];
  }
  function near(x,w){return c[key].find(p=>Math.abs(p.beat/c.length-x)*w<9);}
  canvas.onpointerdown=e=>{
   if(e.button!==0)return;
   checkpoint();
   const [beat,value,x,w]=xy(e),nearby=near(x,w);
   let point=nearby;
   if(!point){insertPoint(c,key,beat,value);point=c[key].find(p=>p.beat===beat);}
   $("#w-auto-at").value=point.beat;$("#w-auto-value").value=point.value;
   drawAutomation();
   pointerDrag(e,ev=>{
    const [pos,val]=xy(ev);
    if(!c[key].some(p=>p!==point&&p.beat===pos))point.beat=pos;
    point.value=val;c[key].sort((a,b)=>a.beat-b.beat);drawAutomation();
   },()=>render());
  };
  canvas.oncontextmenu=e=>{
   e.preventDefault();const [,,x,w]=xy(e),p=near(x,w);
   if(p&&c[key].length>1)mutate(()=>{c[key]=c[key].filter(point=>point!==p);});
  };
 }
 function projectFilename(){return (project.name.replace(/[\\/\u0000-\u001f\u007f]/gu,"_").trim()||"larp")+".larp.json";}
 function saveProject(){
  const blob=new Blob([JSON.stringify(project)],{type:"application/json"});
  const href=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=href;a.download=projectFilename();
  a.click();setTimeout(()=>URL.revokeObjectURL(href),5000);toast("Proyecto guardado como archivo local.");
 }
 async function exportMix(upload){
  const identity=owner;
  if(upload&&!session.user?.id){toast("Inicia sesión para subir la mezcla a tu Biblioteca.");return;}
  if(takeClock||micTake){toast("Detén la grabación antes de exportar la mezcla.");return;}
  if(projectUpload?.owner===identity)return;
  const rate=exportRate,title=projectFilename().replace(/\.larp\.json$/i,""),snapshot=copyProject();
  const ticket={owner:identity,message:"Renderizando mezcla…"};projectUpload=ticket;
  const sameAccount=()=>(session.user?.id||"guest")===identity;
  render();
  try{
   const status=text=>{
    ticket.message=text;
    const output=$("#w-export-status");
    if(output&&sameAccount())output.textContent=text;
   };
   const buffer=await renderStudioMix(snapshot,rate);
   if(!sameAccount())return;
   const file=encodeWav(buffer,title+".wav",24,{dither:true});
   if(!upload){downloadFile(file);toast("Mezcla WAV descargada.");return;}
   await addLibraryFile(file,(bytes,total)=>status("Subiendo "+Math.round(bytes/total*100)+" %"));
   if(sameAccount()){
    toast("Mezcla WAV guardada en Biblioteca → Pistas.");
    if(["lib","pl"].includes(session.page))refreshLibrary().catch(()=>{});
   }
  }catch(error){if(sameAccount())toast(error.message);}
  finally{if(projectUpload===ticket){projectUpload=null;if(isOpen())render();}}
 }
 async function openLibraryProject(item){
  const identity=session.user?.id;
  if(!identity)return;
  if(owner===identity&&project.tracks.length&&!confirm("¿Abrir el proyecto de Biblioteca? Guarda el arreglo actual si quieres conservar sus cambios."))return;
  if(item.size>130*1024*1024)throw new Error("El proyecto supera 130 MiB.");
  const opening=openingProject=Symbol();
  const view=session.viewVersion;
  const response=await fetch(media(item.id));
  if(!response.ok)throw new Error("No se pudo abrir el proyecto de Biblioteca.");
  const next=WModel.readProject(await response.json());
  if(session.user?.id!==identity||session.viewVersion!==view||openingProject!==opening)return;
  navigation.go("syn");clearProject(next);
  toast("Proyecto abierto desde Biblioteca.");
 }
 async function importMidi(file){
  if(!file)return;
  if(file.size>5*1024*1024){toast("El MIDI supera 5 MiB.");return;}
  const current=project;
  try{
   const midi=WMidi.parse(await file.arrayBuffer());
   if(current!==project)return;
   if(midi.parts.length+project.tracks.length>20)throw new Error("El MIDI supera las pistas libres del arreglo.");
   mutate(()=>{
    if(!project.tracks.length)project.bpm=compact(midi.tempo,2);
    let first;
    for(const part of midi.parts){
     const kind=WMidi.instrument(part),t=WModel.track(kind,part.name||WModel.types[kind][0]);
     const length=part.notes.reduce((last,n)=>Math.max(last,n.start+n.length),minBeat);
     const c=WModel.clip(snapAt(head),length);
     c.notes=part.notes.map(n=>({...WModel.note(n.start,kind==="drums"?WMidi.drumPitch(n.pitch):n.pitch,n.length),velocity:n.velocity}));
     t.clips.push(c);project.tracks.push(t);first??=t;
    }
    displaySelected(first);mode="Piano roll";
   });
   toast("MIDI importado · "+midi.parts.length+" pistas.");
  }catch(e){toast(e.message);}
 }
 function clearProject(replacement=WModel.empty(),redraw=true){
  cancelMic();
  stop();releaseKeys();record=false;project=replacement;undo=[];redo=[];WDSP.resetBuffers();
  pick(project.tracks[0]);mode="Piano roll";tool="Dibujar";arrTool="Mover";head=0;
  editTarget="";arrangePasteBeat=null;
  arrOrigin=rollOrigin=arrLeft=rollLeft=0;extent=rollExtent=32;syncGraph();if(redraw)render();
 }
 async function readFile(file){
  if(!file)return;
  if(file.size>130*1024*1024){toast("El archivo de proyecto supera 130 MiB.");return;}
  try{const next=WModel.readProject(JSON.parse(await file.text()));clearProject(next);toast("Proyecto abierto desde el archivo.");}
  catch(error){toast(error.message);}
 }
 async function readAudioAsset(file,analyze,replace=""){
  const used=Object.entries(project.assets).reduce((n,[id,a])=>n+(id===replace?0:a.base64.length),0);
  if(file.size*4/3+used>120*1024*1024)throw new Error("El Estudio admite unos 90 MiB de audio por proyecto.");
  if(Object.keys(project.assets).length>=120&&!replace)throw new Error("El proyecto llegó a 120 archivos de audio.");
  await audio();
  const decoded=await ctx.decodeAudioData(await file.arrayBuffer());
  const type=/^audio\/[a-z0-9.+-]+$/i.test(file.type)?file.type:"audio/wav";
  const base64=await new Promise((resolve,reject)=>{
   const r=new FileReader();r.onload=()=>resolve(r.result.split(",")[1]);r.onerror=reject;r.readAsDataURL(file);
  });
  const peaks=Array.from({length:192},(_,bucket)=>{
   const start=Math.floor(bucket*decoded.length/192),end=Math.floor((bucket+1)*decoded.length/192);
   let peak=0;
   for(let channel=0;channel<decoded.numberOfChannels;channel++){
    const part=decoded.getChannelData(channel);
    for(let i=start;i<end;i+=Math.max(1,Math.floor((end-start)/224)))peak=Math.max(peak,Math.abs(part[i]));
   }
   return compact(Math.min(1,peak),3);
  });
  return {id:uid(),decoded,asset:{name:file.name.slice(0,160),type,base64,duration:decoded.duration,peaks,tempo:analyze?WTempo.estimate(decoded):null}};
 }
 function registerAsset(result){
  project.assets[result.id]=result.asset;
  WDSP.setBuffer(result.id,result.decoded);
 }
 function assetReferences(id){
  return project.tracks.reduce((sum,t)=>sum+t.clips.filter(c=>c.asset===id).length+(t.kit||[]).filter(pad=>pad.sample===id).length,0);
 }
 function discardUnused(id){if(id&&!assetReferences(id)){delete project.assets[id];WDSP.forget(id);}}
 function setNotePasteBeat(beat){
  editTarget="note";noteId="";notePasteBeat=beat;render();
 }
 function removeNote(c,n){
  stop();mutate(()=>{c.notes=c.notes.filter(item=>item!==n);noteId="";notePasteBeat=n.start;});
 }
 function removeClip(t,c){
  stop();mutate(()=>{
   t.clips=t.clips.filter(item=>item!==c);discardUnused(c.asset);
   editTarget="arrange";head=arrangePasteBeat=c.start;cleanSelection();
  });
 }
 function removeTrack(t){
  stop();mutate(()=>{
   project.tracks=project.tracks.filter(item=>item!==t);
   for(const item of project.tracks){
    if(item.mix.route===t.id)item.mix.route="master";
    item.mix.sends=item.mix.sends.filter(send=>send.to!==t.id);
   }
   for(const id of [...t.clips.map(c=>c.asset),...(t.kit||[]).map(pad=>pad.sample)])discardUnused(id);
   editTarget="arrange";cleanSelection();
  });
 }
 function focusedEditTarget(target){
  const note=target.closest("[data-note], [data-bar]");
  const part=target.closest("[data-part]"),row=target.closest(".w-track[data-track]");
  if(note&&pClip()?.notes.some(n=>n.id===(note.dataset.note||note.dataset.bar))){
   noteId=note.dataset.note||note.dataset.bar;notePasteBeat=null;editTarget="note";
  }else if(part||row){
   const t=project.tracks.find(t=>t.id===(row?.dataset.track||part.closest("[data-arrrow]")?.dataset.arrrow));
   if(!t)return;
   displaySelected(t,part?t.clips.find(c=>c.id===part.dataset.part):null);
   editTarget=part?"clip":"track";arrangePasteBeat=null;
  }
 }
 function editSelection(){
  const t=pTrack(),c=pClip(),n=pNote();
  if(editTarget==="note"&&mode==="Piano roll"&&n)return {type:"note",value:n,remove:()=>removeNote(c,n)};
  if(editTarget==="clip"&&c)return {type:"clip",kind:t.kind,value:c,remove:()=>removeClip(t,c)};
  if(editTarget==="track"&&t?.kind==="audio")return {type:"track",kind:"audio",value:t,remove:()=>removeTrack(t)};
  return null;
 }
 function copySelection({type,kind,value}){
  const clips=type==="track"?value.clips:type==="clip"?[value]:[];
  const assets=new Map(clips.filter(c=>c.asset&&Object.hasOwn(project.assets,c.asset)).map(c=>[c.asset,project.assets[c.asset]]));
  clipboard={type,kind,value:structuredClone(value),assets,trackId};
 }
 function assetsForPaste(assets){
  const ids=new Map(),added=[];
  for(const [id,asset] of assets){
   const current=Object.hasOwn(project.assets,id)?project.assets[id]:null;
   if(current===asset||(current&&current.base64===asset.base64&&current.type===asset.type&&current.name===asset.name)){
    ids.set(id,id);continue;
   }
   const nextId=current?uid():id;
   ids.set(id,nextId);added.push([nextId,asset]);
  }
  if(added.length){
   const current=Object.values(project.assets);
   const bytes=[...current,...added.map(([,asset])=>asset)].reduce((sum,asset)=>sum+asset.base64.length,0);
   if(current.length+added.length>120||bytes>120*1024*1024)return null;
  }
  return {ids,added};
 }
 function pasteSelection(){
  const entry=clipboard,t=pTrack(),c=pClip();
  if(entry.type==="note"){
   if(editTarget!=="note"||mode!=="Piano roll"||!c||t.kind==="audio"||c.asset){toast("Abre el piano roll de un patrón para pegar la nota.");return;}
   const selected=pNote(),after=selected?Math.ceil((selected.start+selected.length)/snap)*snap:snapAt(rollOrigin+rollLeft/rollScale);
   const start=notePasteBeat??after;
   const n={...entry.value,id:uid(),start};
   stop();mutate(()=>{
    c.notes.push(n);c.length=Math.max(c.length,n.start+n.length);noteId=n.id;
    notePasteBeat=Math.ceil((n.start+n.length)/snap)*snap;
   });
   toast("Nota pegada.");return;
  }
  if(!["arrange","clip","track"].includes(editTarget)){toast("Selecciona un destino en el arreglo para pegar.");return;}
  const compatible=entry.kind==="audio"||entry.kind==="drums"?t?.kind===entry.kind:t&&!["audio","drums","bus"].includes(t.kind);
  if(entry.type==="clip"&&!compatible&&entry.kind!=="audio"){toast("Selecciona una pista compatible para pegar el patrón.");return;}
  const newTrack=entry.type==="track"||!compatible;
  if(newTrack&&project.tracks.length>=20){toast("Libera una de las 20 pistas para pegar audio.");return;}
  if(!newTrack&&t.clips.length>=7000){toast("La pista alcanzó el límite de clips.");return;}
  const assets=assetsForPaste(entry.assets);
  if(!assets){toast("No hay espacio para pegar las muestras de audio en este proyecto.");return;}
  const after=editTarget==="clip"&&c&&t.id===entry.trackId&&c.id===entry.value.id&&Math.abs(head-c.start)<minBeat?Math.ceil((c.start+c.length)/snap)*snap:snapAt(head);
  const start=arrangePasteBeat??after;
  const cloneClip=(source,beat)=>{
   const clip=structuredClone(source);
   clip.id=uid();clip.start=beat;clip.asset=assets.ids.get(clip.asset)||"";
   for(const note of clip.notes)note.id=uid();
   return clip;
  };
  stop();mutate(()=>{
   for(const [id,asset] of assets.added)project.assets[id]=asset;
   const target=entry.type==="track"?structuredClone(entry.value):newTrack?WModel.track("audio",entry.assets.get(entry.value.asset)?.name?.replace(/\.[^.]*$/, "").slice(0,80)):t;
   if(entry.type==="track"){
    target.id=uid();
    target.clips=target.clips.map(part=>cloneClip(part,part.start));
    for(const fx of target.mix.fx)fx.id=uid();
    if(!WModel.mayRoute(project,target.id,target.mix.route))target.mix.route="master";
    target.mix.sends=target.mix.sends.filter(send=>WModel.mayRoute(project,target.id,send.to));
   }
   if(newTrack)project.tracks.splice(t?project.tracks.indexOf(t)+1:project.tracks.length,0,target);
   if(entry.type==="clip"){
    const part=cloneClip(entry.value,start);
    if(part.asset)WModel.recalibrate(project,target,part);
    target.clips.push(part);displaySelected(target,part);editTarget="clip";
    head=part.start;arrangePasteBeat=Math.ceil((part.start+part.length)/snap)*snap;
   }else{
    syncClips(target);displaySelected(target);editTarget="track";arrangePasteBeat=null;
   }
   if(target.kind==="audio")mode="Clips de audio";
  });
  toast(entry.type==="track"?"Pista de audio pegada.":"Clip pegado.");
 }
 function editWithKeyboard(e,key){
  const shortcut=(e.ctrlKey||e.metaKey)&&!e.shiftKey&&["c","x","v"].includes(key);
  const deleting=!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&key==="delete";
  if(e.altKey||(!shortcut&&!deleting)||e.target.closest("input, [contenteditable]:not([contenteditable=false])"))return false;
  if(shortcut&&key!=="v"&&window.getSelection()?.isCollapsed===false)return false;
  if(takeClock||micTake){e.preventDefault();toast("Detén la grabación antes de editar.");return true;}
  focusedEditTarget(e.target);
  const selected=editSelection(),pasting=shortcut&&key==="v";
  if(pasting?(!clipboard||!editTarget):!selected)return false;
  e.preventDefault();
  if(pasting)pasteSelection();
  else{
   if(shortcut)copySelection(selected);
   if(deleting||key==="x")selected.remove();
   if(shortcut)toast(key==="c"?"Selección copiada.":"Selección cortada.");
  }
  return true;
 }
 async function importFile(file,placement=null){
  if(!file)return;
  const ticket=project,selected=placement?project.tracks.find(t=>t.id===placement.target&&t.kind==="audio"):pTrack()?.kind==="audio"?pTrack():null;
  const existing=placement&&project.tracks.length<20?null:selected;
  const beat=placement?.beat??snapAt(head);
  if(!existing&&project.tracks.length>=20){toast("Elige una pista de audio o libera una de las 20 pistas.");return;}
  try{
   const result=await readAudioAsset(file,!placement);
   if(ticket!==project||existing&&!project.tracks.includes(existing)||!isOpen())return;
   stop();checkpoint();registerAsset(result);
   const t=existing||WModel.track("audio",file.name.replace(/\.[^.]*$/,"").slice(0,80));
   if(!existing)project.tracks.push(t);
   const c=WModel.clip(beat,Math.max(minBeat,result.decoded.duration*project.bpm/60),result.id);
   c.sourceScale=60/project.bpm;
   t.clips.push(c);WModel.recalibrate(project,t,c);pick(t,c);
   syncGraph();mode="Clips de audio";render();toast("Audio añadido al arreglo.");
  }catch(e){toast(e instanceof DOMException?"El navegador no pudo decodificar este audio.":e.message);}
 }
 async function importCandidate(src){
  if(!src)return;
  navigation.go("syn");
  if(src.rawFile){await importFile(src.rawFile);return;}
  const response=await fetch(src.url);
  if(!response.ok)throw new Error("No se pudo abrir el audio en la biblioteca.");
  const blob=await response.blob();
  await importFile(new File([blob],src.name||src.title,{type:blob.type}));
 }
 function recordMenu(kind,label,id,disabled=false){
  const active=kind==="mic"?micTake:takeClock?.kind===kind?takeClock:null;
  if(active)return btn(kind==="mic"&&!active.capture?"Cancelar":"■ Detener toma",'id="'+id+'" data-record-stop="'+kind+'" aria-pressed="true"','w-record-live');
  if(disabled||micTake||takeClock)return btn(label,'id="'+id+'" disabled');
  return '<details class="w-record-menu"><summary id="'+id+'">● '+label+' <span aria-hidden="true">⌄</span></summary><div class="w-record-options">'+
   btn("Con metrónomo · "+project.bpm+" BPM",'data-record-mode="'+kind+':yes"')+btn("Sin metrónomo",'data-record-mode="'+kind+':no"')+'</div></details>';
 }
 function recordingStatus(){
  if(!takeClock&&!micTake)return "";
  return '<div class="w-record-status"><i></i><span id="w-record-status" role="status"></span></div>';
 }
 function updateRecordingStatus(){
  const el=$("#w-record-status",out),run=micTake||takeClock;
  if(!el||!run)return;
  if(micTake&&!micTake.capture){el.textContent="Esperando acceso al micrófono…";return;}
  const target=micTake?.capture.start??takeClock?.audioAt;
  if(!target||ctx.currentTime<target){
   const left=target?clamp(Math.ceil((target-ctx.currentTime)/WRecord.secondsPerBeat(run.bpm)),1,4):4;
   el.dataset.count=String(left);el.textContent="Entrada · "+left+" de 4 pulsos · "+run.bpm+" BPM";return;
  }
  delete el.dataset.count;
  let status=micTake?micTake.capture.format:takeClock.kind==="drums"?"Toma de batería":"Toma de instrumento";
  status+=" · "+(run.withGuide?"Metrónomo a "+run.bpm+" BPM":"Sin metrónomo");
  if(micTake)status+=" · "+fmt(Math.max(0,ctx.currentTime-micTake.capture.start));
  el.textContent=status;
 }
 function clockBeat(take){
  if(!ctx||take.audioAt===null||ctx.currentTime<take.audioAt)return null;
  return take.start+(ctx.currentTime-take.audioAt)*take.bpm/60;
 }
 async function startInstrumentTake(kind,withGuide){
  const t=pTrack(),c=pClip();if(!t||!c||micTake||takeClock)return;
  stop();releaseKeys();
  const start=kind==="drums"?rackBar*4:Math.max(0,head-c.start);
  const run={kind,withGuide,bpm:project.bpm,start,clock:null,audioAt:null,monitor:null,track:t.id,clip:c.id,count:0};
  takeClock=run;record=kind==="keys";drumTake=kind==="drums"?run:null;
  render();
  try{
   await audio();
   if(takeClock!==run)return;
   const lead=ctx.currentTime+.105;
   run.audioAt=lead+WRecord.countIn(run.bpm);
   if(withGuide)run.monitor=WRecord.guide(ctx,run.bpm,lead,Math.floor(c.start+start)%4);
   run.timer=setInterval(updateRecordingStatus,40);
  }catch{if(takeClock===run){endInstrumentTake();render();toast("El navegador no pudo iniciar el metrónomo.");}}
 }
 function endInstrumentTake(){
  if(!takeClock){releaseKeys();return;}
  releaseKeys();clearInterval(takeClock.timer);takeClock.monitor?.stop();takeClock=null;drumTake=null;record=false;
 }
 function cleanMic(run){
  clearInterval(run.timer);run.monitor?.stop();
  run.stream?.getTracks().forEach(t=>t.stop());
 }
 function cancelMic(redraw=true){
  if(!micTake)return;
  const run=micTake;micTake=null;run.cancelled=true;run.capture?.cancel();
  cleanMic(run);if(redraw)render();
 }
 async function startMic(withGuide){
  if(micTake)return;
  if(!navigator.mediaDevices?.getUserMedia){toast("Abre el Estudio en HTTPS o localhost para usar el micrófono.");return;}
  if(project.tracks.length>=20&&pTrack()?.kind!=="audio"){toast("Selecciona una pista de audio o libera una de las 20 pistas.");return;}
  const occupied=Object.values(project.assets).reduce((sum,file)=>sum+file.base64.length,0);
  const byteLimit=Math.floor((120*1024*1024-occupied)/4)*3;
  if(byteLimit<4096){toast("No queda espacio para otra toma en este proyecto.");return;}
  stop();
  const run={project,beat:head,target:pTrack()?.id,withGuide,bpm:project.bpm,capture:null,stream:null};
  micTake=run;render();
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:2}}});
   run.stream=stream;if(micTake!==run){cleanMic(run);return;}
   await audio();
   if(micTake!==run){cleanMic(run);return;}
   const capture=await WRecord.mic(ctx,stream,current=>{
    run.capture=current;
    if(micTake!==run){current.finished.catch(()=>{});current.cancel();return;}
    if(withGuide)run.monitor=WRecord.guide(ctx,run.bpm,current.lead,Math.floor(run.beat)%4);
    run.timer=setInterval(updateRecordingStatus,50);
    render();
   },byteLimit,run.bpm);
   const result=await capture.finished;
   if(micTake!==run||run.project!==project)return;
   micTake=null;cleanMic(run);
   if(result.blob.size<96){render();toast("La toma quedó vacía.");return;}
   const time=new Date().toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).replaceAll(":","-");
   await importFile(new File([result.blob],"Toma de micrófono "+time+"."+result.extension,{type:result.blob.type}),run);
   render();
  }catch(error){
   if(micTake===run){
    micTake=null;render();
    toast(error.name==="NotAllowedError"?"No se concedió acceso al micrófono.":error.message||"No se pudo grabar audio.");
   }
  }finally{cleanMic(run);}
 }
 async function play(){
  if(micTake){toast("Detén la grabación de audio primero.");return;}
  if(transport){stop();render();return;}
  stop();const stamp=++generation,active=project;
  try{
   await audio();
   const prepared=await WDSP.prepare(ctx,active);
   if(stamp!==generation||active!==project||!isOpen())return;
   const end=overall();
   if(end<=0){toast("Añade notas o audio al arreglo para reproducir.");return;}
   if(head>=end)head=0;
   const time=ctx.currentTime+.065,from=head,spb=60/project.bpm,played=new Set();
   transport={at:time,from,spb,id:0};
   function queue(){
    if(!transport||stamp!==generation)return;
    const cursor=from+Math.max(0,ctx.currentTime-time)/spb;
    for(const t of project.tracks)for(const c of t.clips){
     if(played.has(c.id)||c.start>cursor+1.25||c.start+c.length<=cursor)continue;
     played.add(c.id);
     const local=Math.max(from,cursor),initial=Math.max(ctx.currentTime+.009,time+(local-from)*spb);
     WDSP.playClip(ctx,project,t,c,initial,local,c.start+c.length,prepared);
    }
    if(cursor>=end){stop(false);render();}
   }
   queue();transport.id=setInterval(queue,45);render();
  }catch(error){toast("La reproducción se detuvo · "+error.message);}
 }
 function stop(kill=true){
  endInstrumentTake();generation++;
  if(audition){clearTimeout(audition.timer);audition=null;}
  if(transport)clearInterval(transport.id);
  transport=null;
  if(kill)WDSP.hardStop();
 }
 async function playPattern(){
  if(micTake){toast("Detén la grabación de audio primero.");return;}
  if(audition?.clip===clipId){stop();render();return;}
  const t=pTrack(),clip=pClip(),active=project;
  if(!t||!clip||t.kind==="audio"||t.kind==="bus")return;
  stop();const stamp=generation;
  try{
   await audio();
   const prepared=await WDSP.prepare(ctx,active,[[t,[clip]]]);
   if(stamp!==generation||project!==active||pClip()!==clip||!enabled)return;
   const start=ctx.currentTime+.045;
   WDSP.playClip(ctx,active,t,clip,start,clip.start,clip.start+clip.length,prepared);
   const span=clip.length*60000/active.bpm+80;
   audition={clip:clip.id,start,bpm:active.bpm,timer:setTimeout(()=>{
    if(audition?.clip===clip.id){audition=null;render();}
   },Math.min(2147483647,span))};
   render();
  }catch(e){toast("No se pudo escuchar el patrón · "+e.message);}
 }
 function syncClips(t){for(const c of t.clips)WModel.recalibrate(project,t,c);}
 async function enableCalibrator(t){
  if(!t||t.kind!=="audio"||t.mix.fx.some(f=>f.kind==="bpm"))return;
  const active=project;
  stop();mutate(()=>{t.mix.fx.push(WModel.plugin("bpm"));syncClips(t);});
  const pending=[...new Set(t.clips.map(c=>c.asset))].filter(id=>active.assets[id]&&!active.assets[id].tempo);
  if(!pending.length)return;
  try{
   await audio();
   const found=await Promise.all(pending.map(async id=>[id,WTempo.estimate(await WDSP.decode(ctx,active.assets[id],id))]));
   if(active!==project||!project.tracks.includes(t)||!t.mix.fx.some(f=>f.kind==="bpm"))return;
   for(const [id,tempo] of found)if(project.assets[id])project.assets[id]={...project.assets[id],tempo};
   syncClips(t);render();
  }catch{toast("No se pudo analizar el pulso. Puedes escribir el BPM de origen.");}
 }
 function toggleCalibrator(t){
  const f=t?.mix.fx.find(f=>f.kind==="bpm");if(!f)return;
  stop();mutate(()=>{f.enabled=!f.enabled;syncClips(t);});
 }
 function changeSourceBpm(t,c,bpm){
  stop();mutate(()=>{c.sourceBpm=bpm;WModel.recalibrate(project,t,c);});
 }
 function drawPad(t){
  const canvas=$("#w-pad-wave",out);if(!canvas)return;
  const g=canvas.getContext("2d"),{width:w,height:h}=canvas,cfg=t.kit[selectedPad],asset=project.assets[cfg.sample];
  g.clearRect(0,0,w,h);g.strokeStyle="#493d60";g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();
  g.strokeStyle=palette[selectedPad];g.lineWidth=1.6;g.beginPath();
  if(asset?.peaks?.length){
   for(const [i,amp] of asset.peaks.entries()){
    const x=i*w/asset.peaks.length,half=amp*(h-8)*.5;
    g.moveTo(x,h*.5-half);g.lineTo(x,h*.5+half);
   }
  }else{
   const total=cfg.attack+cfg.hold+cfg.decay;
   for(let i=0;i<=w;i++){
    const t=i/w*total;
    const amp=t<cfg.attack?t/cfg.attack:t<cfg.attack+cfg.hold?1:Math.exp(-7.6*(t-cfg.attack-cfg.hold)/cfg.decay);
    const y=h-4-amp*(h-10)*clamp(cfg.level/100,0,1);
    if(i===0)g.moveTo(i,y);else g.lineTo(i,y);
   }
  }
  g.stroke();
 }
 function selectPad(i){
  if(i===selectedPad)return;
  selectedPad=i;
  for(const el of out.querySelectorAll("[data-pad]"))el.setAttribute("aria-pressed",String(+el.dataset.pad===i));
  const panel=$("#w-kit-panel",out);
  if(panel){panel.innerHTML=drumPanel(pTrack());bindKitPanel();}
 }
 const padFlash=new WeakMap();
 async function strikeDrum(i,canRecord=true){
  const t=pTrack(),c=pClip(),active=project,time=performance.now();
  if(t?.kind!=="drums")return;
  if(mode==="Larp Drums")selectPad(i);
  const el=out.querySelector('[data-pad="'+i+'"]');
  if(el){el.classList.add("held");clearTimeout(padFlash.get(el));padFlash.set(el,setTimeout(()=>el.classList.remove("held"),145));}
  if(canRecord&&drumTake?.track===t.id&&drumTake.clip===c?.id){
   const take=drumTake;
   const at=clockBeat(take);
   if(at!==null){
    if(!take.count)checkpoint();
    const beat=drumSnap?Math.round(at*4)/4:compact(at,4);
    c.layers.push({pad:i,beat,velocity:.9});
    c.length=Math.max(c.length,beat+.25);take.count++;
    const status=$("#w-drum-status",out);if(status)status.textContent=take.count+(take.count===1?" golpe guardado":" golpes guardados")+" en el patrón";
   }
  }
  try{
   await audio();
   const id=t.kit[i].sample;
   if(id&&active.assets[id])await WDSP.decode(ctx,active.assets[id],id);
   const pipe=WDSP.graph.get(t.id);
   if(pipe&&active===project&&enabled)WDSP.hit(ctx,i,ctx.currentTime+.008,pipe.local,t,.91);
  }catch{toast("No se pudo reproducir la muestra de esta pieza.");}
 }
 function bindKitPanel(){
  const panel=$("#w-kit-panel",out),t=pTrack();
  if(!panel||t?.kind!=="drums")return;
  drawPad(t);
  $("#w-pad-select",panel).onchange=e=>selectPad(+e.target.value);
  for(const el of panel.querySelectorAll("[data-pad-param]")){
   const key=el.dataset.padParam,[,low,high]=WModel.padSpec[key];
   el.onpointerdown=checkpoint;
   el.oninput=()=>{
    const cfg=t.kit[selectedPad];cfg[key]=+el.value;
    el.previousElementSibling.style.setProperty("--angle",(-132+264*(cfg[key]-low)/(high-low))+"deg");
    el.nextElementSibling.textContent=compact(cfg[key],1);drawPad(t);
   };
  }
  $("#w-pad-listen",panel).onclick=()=>strikeDrum(selectedPad,false);
  const input=$("#w-pad-file",panel),reset=$("#w-pad-reset",panel);
  input.onchange=async()=>{
   const file=input.files[0],index=selectedPad,active=project,old=t.kit[index].sample;
   if(!file)return;
   if(file.size>24*1024*1024){toast("Cada pieza de batería admite una muestra de hasta 24 MiB.");return;}
   try{
    const result=await readAudioAsset(file,false,assetReferences(old)===1?old:"");
    if(active!==project||!project.tracks.includes(t)||t.kit[index].sample!==old)return;
    mutate(()=>{registerAsset(result);t.kit[index].sample=result.id;discardUnused(old);});
    toast("Muestra asignada a "+WModel.padNames[index]+".");
   }catch(e){toast(e instanceof DOMException?"El navegador no pudo decodificar la muestra.":e.message);}
  };
  if(reset)reset.onclick=()=>mutate(()=>{
   const cfg=t.kit[selectedPad],old=cfg.sample;
   cfg.sample="";discardUnused(old);
  });
 }
 async function previewNote(n){
  const t=pTrack();if(!t||["bus","audio"].includes(t.kind))return;
  await audio();
  await prepareTakes(ctx,t);
  const sample=t.kit?.[((n.pitch-60)%8+8)%8]?.sample;
  if(sample)await WDSP.decode(ctx,project.assets[sample],sample);
  const pipe=WDSP.graph.get(t.id);if(!pipe||!enabled)return;
  WDSP.voice(ctx,t,n,ctx.currentTime+.011,pipe.local,ctx.currentTime+.36);
 }
 function recordBeat(c){return Math.max(0,head-c.start);}
 function markKeyboard(i,on){out.querySelector('[data-manual="'+i+'"]')?.classList.toggle("held",on);}
 async function keyPress(token,index){
  const t=pTrack(),c=pClip();
  if(!t||["audio","bus"].includes(t.kind)||keys.has(token))return;
  const event=WModel.note(0,(oct+1)*12+index);
  const pressed=performance.now(),clock=takeClock;
  const beat=record&&c&&clock?.kind==="keys"?clockBeat(clock):c?recordBeat(c):0;
  const item={index,note:event,track:t,clip:c,record:record&&!!c&&beat!==null,head:beat,pressed,bpm:clock?.bpm||project.bpm,job:null};
  keys.set(token,item);markKeyboard(index,true);
  try{
   await audio();
   const pipe=WDSP.graph.get(t.id);
   if(!pipe||keys.get(token)!==item||!enabled)return;
   await prepareTakes(ctx,t);
   const sample=t.kit?.[((event.pitch-60)%8+8)%8]?.sample;
   if(sample)await WDSP.decode(ctx,project.assets[sample],sample);
   if(keys.get(token)===item)item.job=WDSP.voice(ctx,t,event,ctx.currentTime+.007,pipe.local);
  }catch{keys.delete(token);markKeyboard(index,false);}
 }
 function keyRelease(token,redraw=true){
  const item=keys.get(token);if(!item)return;
  keys.delete(token);item.job?.release();
  if(![...keys.values()].some(key=>key.index===item.index))markKeyboard(item.index,false);
  if(item.record&&item.clip&&project.tracks.includes(item.track)){
   const c=item.clip,second=(performance.now()-item.pressed)/1000;
   checkpoint();
   item.note.start=compact(item.head,4);
   item.note.length=compact(Math.max(minBeat,second*item.bpm/60),4);
   c.notes.push(item.note);c.length=Math.max(c.length,item.note.start+item.note.length);
   if(!transport)head=Math.max(head,c.start+item.note.start+item.note.length);
   if(redraw&&!keys.size)render();
  }
 }
 function releaseKeys(){for(const token of [...keys.keys()])keyRelease(token,false);}
 function keyboardDown(e){
  if(!isOpen()||document.querySelector("dialog[open]")||e.repeat||e.target.closest("input:not([type=range]),textarea,select,[contenteditable=true]"))return;
  const key=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&key==="z"){
   e.preventDefault();restore(e.shiftKey?redo:undo,e.shiftKey?undo:redo);return;
  }
  if(editWithKeyboard(e,key))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(mode==="Larp Drums"&&pTrack()?.kind==="drums"){
   const pad=WModel.padKeys.indexOf(e.key.toLowerCase());
   if(pad>=0){e.preventDefault();strikeDrum(pad);}
   return;
  }
  const index=WModel.keymap.indexOf(e.key.toLowerCase());
  if(index>=0&&pTrack()&&!["audio","bus"].includes(pTrack().kind)){e.preventDefault();keyPress(e.code||e.key.toLowerCase(),index);}
 }
 function keyboardUp(e){keyRelease(e.code||e.key.toLowerCase());}
 document.addEventListener("keydown",keyboardDown);
 document.addEventListener("keyup",keyboardUp);
 window.addEventListener("blur",()=>{releaseKeys();if(isOpen()&&record)render();});
 window.addEventListener("resize",drawCables);
 document.addEventListener("click",event=>{
  if(!isOpen())return;
  for(const menu of out.querySelectorAll(".w-record-menu[open]"))if(!menu.contains(event.target))menu.open=false;
 });
 document.addEventListener("keydown",event=>{
  if(isOpen()&&event.key==="Escape")for(const menu of out.querySelectorAll(".w-record-menu[open]"))menu.open=false;
 });
 function bind(){
  const get=s=>$(s,out);
  const click=(s,fn)=>{const el=get(s);if(el)el.onclick=fn;};
  const change=(s,fn)=>{const el=get(s);if(el)el.onchange=()=>fn(el);};
  const all=(s,kind,fn)=>out.querySelectorAll(s).forEach(el=>el.addEventListener(kind,e=>fn(el,e)));
  const input=(s,fn)=>all(s,"input",(el,e)=>{
   fn(el,e);
   const text=el.parentElement.querySelector("output");
   if(text)text.textContent=compact(Number(el.value),3);
  });
  click("#w-add",()=>addTrack(get("#w-add-kind").value));all("[data-add-kind]","click",el=>addTrack(el.dataset.addKind));
  click("#w-add-pattern",addPattern);
  click("#w-legacy",()=>navigation.go("syn-legacy"));
  click("#w-new",()=>{if(!project.tracks.length||confirm("¿Abrir un proyecto vacío? Guarda primero si quieres conservar los cambios."))clearProject();});
  click("#w-save",saveProject);click("#w-upload",()=>exportMix(true));click("#w-download-mix",()=>exportMix(false));
  change("#w-export-rate",el=>{exportRate=+el.value;});
  change("#w-open",el=>readFile(el.files[0]));change("#w-midi",el=>{importMidi(el.files[0]);el.value="";});
  change("#w-project-name",el=>{checkpoint();project.name=el.value.trim()||"Proyecto sin título";el.value=project.name;});
  change("#w-bpm",el=>{stop();mutate(()=>{
   const prev=project.bpm;project.bpm=clamp(+el.value||prev,30,300);
   for(const t of project.tracks)if(t.kind==="audio")for(const c of t.clips){
    c.sourceScale||=60/prev;WModel.recalibrate(project,t,c);
   }
  });});
  click("#w-undo",()=>restore(undo,redo));click("#w-redo",()=>restore(redo,undo));
  click("#w-play",play);
  all("[data-record-mode]","click",el=>{
   const [kind,withGuide]=el.dataset.recordMode.split(":");
   if(kind==="mic")startMic(withGuide==="yes");else startInstrumentTake(kind,withGuide==="yes");
  });
  all("[data-record-stop]","click",el=>{
   if(el.dataset.recordStop==="mic"){if(micTake?.capture)micTake.capture.stop();else cancelMic();}
   else{endInstrumentTake();render();}
  });
  all("[data-track],[data-rack]","click",el=>{
   const t=project.tracks.find(t=>t.id===(el.dataset.track||el.dataset.rack));displaySelected(t);
   editTarget=el.classList.contains("w-track")?"track":"";arrangePasteBeat=null;
   if(t.kind==="audio"&&mode!=="Mixer")mode="Clips de audio";
   if(t.kind==="bus")mode="Mixer";
   render();
  });
  change("#w-track-name",el=>{const t=pTrack();if(t)mutate(()=>{t.name=el.value.trim()||WModel.types[t.kind][0];});});
  click("#w-remove-track",()=>{const t=pTrack();if(t)removeTrack(t);});
  click("#w-remove-clip",()=>{const c=pClip(),t=pTrack();if(c&&t)removeClip(t,c);});
  all("[data-mode]","click",el=>{endInstrumentTake();mode=el.dataset.mode;editTarget=mode==="Piano roll"?"note":"";render();});
  all("[data-tool]","click",el=>{tool=el.dataset.tool;render();});
  all("[data-arrtool]","click",el=>{arrTool=el.dataset.arrtool;render();});
  const strips=get(".w-strips");if(strips)strips.onscroll=drawCables;
  const a=get("#w-arr-scroll"),r=get("#w-roll-scroll");
  a.onscroll=()=>{arrLeft=a.scrollLeft;drawRulers();extend(a,false);};
  if(r)r.onscroll=()=>{
   rollLeft=r.scrollLeft;rollTop=r.scrollTop;
   const lane=get("#w-lane-scroll");if(lane)lane.scrollLeft=rollLeft;drawRulers();extend(r,true);
  };
  function chooseArrangeBeat(beat){
   if(transport)stop();editTarget="arrange";head=arrangePasteBeat=beat;
  }
  all("[data-ruler=arr],[data-arrrow],.w-arr-empty","click",(el,e)=>{
   if(e.target.closest("[data-part]")||takeClock||micTake)return;
   const t=project.tracks.find(t=>t.id===el.dataset.arrrow);
   if(t&&t!==pTrack()){displaySelected(t);if(t.kind==="audio")mode="Clips de audio";}
   const beat=coordinates(e,el,arrScale,arrOrigin);
   chooseArrangeBeat(e.altKey?Math.max(0,compact(beat,4)):snapAt(beat));render();
  });
  all("[data-ruler=roll]","click",(el,e)=>setNotePasteBeat(snapAt(coordinates(e,el,rollScale,rollOrigin))));
  a.addEventListener("pointerdown",dragArrange);
  if(get(".w-notes"))get(".w-notes").addEventListener("pointerdown",e=>dragNote(e));
  all("[data-part],[data-note]","click",(el,e)=>{if(e.detail===0){focusedEditTarget(el);render();}});
  const seek=()=>{const beat=(Math.max(1,+get("#w-jump-where").value||1)-1)*4;chooseArrangeBeat(beat);jump(beat);};
  click("#w-jump",seek);all("#w-jump-where","keydown",(el,e)=>{if(e.key==="Enter")seek();});
  const seekRoll=()=>{
   editTarget="note";noteId="";notePasteBeat=(Math.max(1,+get("#w-roll-to").value||1)-1)*4;jump(notePasteBeat,true);
  };
  click("#w-roll-jump",seekRoll);all("#w-roll-to","keydown",(el,e)=>{if(e.key==="Enter")seekRoll();});
  change("#w-zoom",el=>{arrLeft=arrLeft/arrScale*(+el.value);arrScale=+el.value;render();});
  change("#w-oct",el=>{releaseKeys();oct=+el.value;rollTop=23*20;render();});
  change("#w-man-oct",el=>{releaseKeys();oct=+el.value;rollTop=23*20;render();});
  change("#w-snap",el=>{snap=+el.value;render();});
  change("#w-lane",el=>{channelLane=el.value;render();});
  all("[data-sound-note]","click",el=>previewNote(WModel.note(0,+el.dataset.soundNote)));
  all("[data-bar]","click",(el,e)=>{if(e.detail===0){focusedEditTarget(el);render();}});
  all("[data-bar]","pointerdown",(el,e)=>{
   if(e.button!==0)return;
   const n=pClip()?.notes.find(n=>n.id===el.dataset.bar),k=channelLane;
   if(!n)return;
   const [,lo,hi]=WModel.noteSpec[k],initial=n[k];let changed=false;
   e.preventDefault();
   pointerDrag(e,ev=>{
    if(!changed&&Math.abs(ev.clientY-e.clientY)<3)return;
    if(!changed){checkpoint();changed=true;}
    const step=specStep(k);
    n[k]=compact(clamp(Math.round((initial+(e.clientY-ev.clientY)/53*(hi-lo))/step)*step,lo,hi),3);
    el.style.height=(8+(n[k]-lo)/(hi-lo)*53)+"px";
   },()=>{editTarget="note";noteId=n.id;notePasteBeat=null;render();});
  });
  click("#w-note-preview",()=>{const n=pNote();if(n)previewNote(n);});
  click("#w-note-delete",()=>{const c=pClip(),n=pNote();if(c&&n)removeNote(c,n);});
  click("#w-split-at-head",()=>{const c=pClip(),t=pTrack();if(c&&t&&!takeClock&&!micTake)splitAt(t,c,head);});
  click("#w-trim",()=>{
   const c=pClip();if(!c||takeClock||micTake)return;
   const start=get("#w-trim-start").valueAsNumber,end=get("#w-trim-end").valueAsNumber;
   if(!Number.isFinite(start)||!Number.isFinite(end)||start<c.start-1e-4||start>=c.start+c.length||end-start<minBeat||end>maxClipEnd(c)+1e-4){
    toast("Introduce un inicio y un fin válidos dentro del audio.");return;
   }
   stop();mutate(()=>{WModel.trim(c,Math.max(c.start,start),Math.min(end,maxClipEnd(c)));editTarget="clip";});
  });
  for(const [sel,key] of [["#w-note-start","start"],["#w-note-length","length"]])change(sel,el=>{
   const c=pClip(),n=pNote();if(c&&n)mutate(()=>{n[key]=clamp(+el.value,key==="start"?0:minBeat,1e12);c.length=Math.max(c.length,n.start+n.length);});
  });
  input("[data-nval]",el=>{const n=pNote();if(n){
   const k=el.dataset.nval,[label,lo,hi]=WModel.noteSpec[k];n[k]=+el.value;
   const bar=out.querySelector('[data-bar="'+n.id+'"]');
   if(bar){bar.style.height=(8+(n[k]-lo)/(hi-lo)*53)+"px";bar.title=label+" "+compact(n[k],3);}
  }});
  all("[data-nval]","pointerdown",checkpoint);all("[data-timbre]","pointerdown",checkpoint);
  input("[data-timbre]",el=>{const t=pTrack();if(t)t[el.dataset.timbre]=+el.value;});
  all("[data-manual]","pointerdown",(el,e)=>{
   if(e.button!==0)return;e.preventDefault();
   const index=+el.dataset.manual,token="touch-"+e.pointerId;
   keyPress(token,index);el.setPointerCapture(e.pointerId);
  });
  all("[data-manual]","pointermove",(el,e)=>{
   const token="touch-"+e.pointerId;if(!keys.has(token))return;
   const next=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-manual]");
   if(!next||keys.get(token).index===+next.dataset.manual)return;
   keyRelease(token,false);keyPress(token,+next.dataset.manual);
  });
  for(const ev of ["pointerup","pointercancel","lostpointercapture"])all("[data-manual]",ev,(el,e)=>keyRelease("touch-"+e.pointerId));
  all("[data-manual]","click",(el,e)=>{if(e.detail===0)previewNote(WModel.note(0,(oct+1)*12+Number(el.dataset.manual)));});
  all("[data-preview-pattern]","click",()=>playPattern());
  change("#w-rack-track",el=>{const t=project.tracks.find(t=>t.id===el.value);if(t){stop();displaySelected(t);render();}});
  change("#w-rack-pattern",el=>{const t=pTrack(),c=t?.clips.find(c=>c.id===el.value);if(c){stop();displaySelected(t,c);render();}});
  change("#w-rack-bar",el=>{rackBar=clamp(Math.floor(+el.value||1)-1,0,lastRackBar(pClip()));render();});
  change("#w-rack-steps",el=>{
   const c=pClip();if(!c||!el.value)return;
   const requested=clamp(Math.round(+el.value),1,Math.max(rackSteps(c),maxRackSteps));
   if(requested===rackSteps(c)){el.value=requested;return;}
   let used=0;
   for(const note of c.notes)used=Math.max(used,note.start+note.length);
   for(const hit of c.layers)used=Math.max(used,(Math.floor(hit.beat*4)+1)/4);
   for(const key of ["gain","pan","pitch"])used=Math.max(used,c[key].at(-1)?.beat||0);
   if(requested/4<used){el.value=rackSteps(c);toast("Hay eventos después del paso "+requested+". Muévelos o bórralos antes de acortar el patrón.");return;}
   stop();
   mutate(()=>{c.length=requested/4;});
  });
  $("#w-rack-steps",out)?.addEventListener("keydown",event=>{
   if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}
  });
  change("#w-rack-root",el=>{rackRoot=+el.value;render();});
  all("[data-drum-bar]","click",el=>{rackBar=clamp(rackBar+Number(el.dataset.drumBar),0,lastRackBar(pClip()));render();});
  all("[data-rack-sound]","click",el=>{
   const t=pTrack(),value=+el.dataset.rackSound;
   if(t?.kind==="drums")strikeDrum(value,false);else previewNote(WModel.note(0,value));
  });
  all("[data-step]","click",el=>{
   const c=pClip(),t=pTrack(),[value,beat]=el.dataset.step.split(":").map(Number);
   if(!c||!t)return;
   mutate(()=>{
    if(t.kind==="drums"){
     const idx=c.layers.findIndex(h=>h.pad===value&&Math.abs(h.beat-beat)<.00001);
     if(idx>=0)c.layers.splice(idx,1);else c.layers.push({pad:value,beat,velocity:.86});
    }else{
     const idx=c.notes.findIndex(n=>n.pitch===value&&Math.abs(n.start-beat)<.00001);
     if(idx>=0)c.notes.splice(idx,1);else c.notes.push(WModel.note(beat,value,.25));
    }
    c.length=Math.max(c.length,beat+.25);
   });
  });
  all("[data-pad]","pointerdown",(el,e)=>{if(e.button===0){e.preventDefault();strikeDrum(+el.dataset.pad);}});
  all("[data-pad]","click",(el,e)=>{if(e.detail===0)strikeDrum(+el.dataset.pad);});
  all("[data-create-drum-pattern]","click",addPattern);
  change("#w-drum-snap",el=>{drumSnap=el.checked;});
  change("#w-kit-style",el=>mutate(()=>{
   const t=pTrack(),kit=WModel.drumKit(el.value);t.kitStyle=el.value;
   t.kit=kit.map((pad,i)=>({...pad,sample:t.kit[i].sample}));
  }));
  all("[data-bpm-add]","click",()=>enableCalibrator(pTrack()));
  all("[data-bpm-toggle]","click",()=>toggleCalibrator(pTrack()));
  all("[data-bpm-focus]","click",()=>{const t=inst();if(t?.kind==="audio"){displaySelected(t);mode="Clips de audio";render();}});
  all("[data-bpm-scale]","click",el=>{
   const c=pClip(),t=pTrack(),auto=project.assets[c?.asset]?.tempo?.bpm||0;
   if(c&&auto)changeSourceBpm(t,c,clamp(auto*Number(el.dataset.bpmScale),30,300));
  });
  change("#w-source-bpm",el=>{const c=pClip(),t=pTrack();if(c&&t)changeSourceBpm(t,c,el.value?clamp(+el.value,30,300):0);});
  change("#w-media",el=>{
   const rawFile=el.files[0];if(!rawFile)return;
   const url=URL.createObjectURL(rawFile);
   openPreview({rawFile,url,title:rawFile.name},importCandidate,()=>URL.revokeObjectURL(url));el.value="";
  });change("#w-library",el=>{const track=sources().find(s=>s.id===el.value);if(track)openPreview(track,importCandidate);el.value="";});
  if(get("#w-auto-canvas"))bindCanvas(get("#w-auto-canvas"));
  click("#w-auto-set",()=>{
   const c=pClip(),key=get(".w-automation").dataset.auto,[lo,hi]=autoRange(key);
   if(c)mutate(()=>insertPoint(c,key,+get("#w-auto-at").value||0,clamp(+get("#w-auto-value").value||0,lo,hi)));
  });
  for(const [attr,details] of [["mix-select",null],["clock","#w-clock-details"],["route-focus","#w-route-details"]])
   all("[data-"+attr+"]","click",el=>{
    mixerId=el.getAttribute("data-"+attr);render();
    if(details){get(details).open=true;get(details).scrollIntoView({block:"nearest"});}
   });
  all("[data-mix-toggle]","click",el=>{
   const [id,k]=el.dataset.mixToggle.split(":"),mix=WModel.mixId(project,id);checkpoint();
   mix[k]=!mix[k];el.setAttribute("aria-pressed",mix[k]);syncGraph();
  });
  all("[data-mix-val]","pointerdown",checkpoint);
  all("[data-mix-val]","input",el=>{
   const [id,k]=el.dataset.mixVal.split(":"),mix=WModel.mixId(project,id),s=el.closest(".w-strip");mix[k]=+el.value;
   if(k==="pan"){el.previousElementSibling.style.setProperty("--turn",mix.pan*1.25+"deg");el.nextElementSibling.textContent=panLabel(mix.pan);}
   else if(k==="volume")s.querySelector(".w-db").textContent=(mix.volume<=-80?"−∞":compact(mix.volume,1))+" dB";
   else el.nextElementSibling.textContent=mix.width<0?Math.abs(mix.width)+"% merged":mix.width>0?mix.width+"% separado":"Original";
   syncGraph();
  });
  change("#w-route",el=>{
   if(!WModel.mayRoute(project,mixerId,el.value))return;
   mutate(()=>{const m=aMixer();m.route=el.value;m.sends=m.sends.filter(s=>s.to!==m.route);});
  });
  click("#w-add-send",()=>{const el=get("#w-send-to");if(el&&WModel.mayRoute(project,mixerId,el.value))mutate(()=>aMixer().sends.push({to:el.value,level:-16}));});
  all("[data-remove-send]","click",el=>mutate(()=>{const m=aMixer();m.sends=m.sends.filter(x=>x.to!==el.dataset.removeSend);}));
  input("[data-send-level]",el=>{const s=aMixer().sends.find(x=>x.to===el.dataset.sendLevel);if(s){s.level=+el.value;syncGraph();}});
  function setLatency(value,unit){
   const sr=ctx?.sampleRate||48000,cap=unit==="ms"?500:unit==="samples"?sr/2:project.bpm/120;
   const m=aMixer();mutate(()=>{m.unit=unit;m.time=clamp(value,mixerId==="master"?0:-cap,cap);});
   get("#w-clock-details").open=true;
  }
  change("#w-latency-unit",el=>{
   const m=aMixer(),sr=ctx?.sampleRate||48000,ms=WModel.manualMs(m,project.bpm,sr);
   setLatency(el.value==="ms"?ms:el.value==="samples"?Math.round(ms*sr/1000):ms*project.bpm/60000,el.value);
  });
  change("#w-latency-val",el=>setLatency(+el.value,aMixer().unit));
  click("#w-latency-reset",()=>setLatency(0,aMixer().unit));
  function addInsert(kind){
   const m=aMixer();
   if(!WModel.pluginAllowed(inst()?.kind||"bus",kind))return;
   if(kind==="bpm"){enableCalibrator(inst());return;}
   if(m.fx.length>=32){toast("La cadena admite hasta 32 instancias.");return;}
   mutate(()=>m.fx.push(WModel.plugin(kind)));
  }
  click("#w-add-fx",()=>addInsert(get("#w-plugin-select").value));
  all("[data-add-insert]","click",el=>addInsert(el.dataset.addInsert));
  all("[data-fx-bypass]","click",el=>{
   const f=aMixer().fx.find(x=>x.id===el.dataset.fxBypass);
   if(f.kind==="bpm"){toggleCalibrator(inst());return;}
   checkpoint();f.enabled=!f.enabled;syncGraph();el.textContent=f.enabled?"Encendido":"Apagado";
   el.setAttribute("aria-pressed",String(f.enabled));
   el.setAttribute("aria-label",(f.enabled?"Apagar ":"Encender ")+WModel.effects[f.kind].title);
   el.closest(".w-pedal").dataset.powered=f.enabled;
   el.closest("details").querySelector("summary small").textContent=f.enabled?"Activo":"Apagado";
  });
  all("[data-fx-shift]","click",el=>{
   const [id,d]=el.dataset.fxShift.split(":"),fx=aMixer().fx,i=fx.findIndex(f=>f.id===id),j=i+Number(d);
   if(j>=0&&j<fx.length)mutate(()=>{[fx[i],fx[j]]=[fx[j],fx[i]];});
  });
  all("[data-fx-remove]","click",el=>{
   const id=el.dataset.fxRemove,m=aMixer(),t=inst();
   if(m.fx.find(f=>f.id===id)?.kind==="bpm")stop();
   mutate(()=>{m.fx=m.fx.filter(f=>f.id!==id);if(t?.kind==="audio")syncClips(t);});
  });
  function setFx(el){
   const [id,k]=el.dataset.fxParam.split(":"),f=aMixer().fx.find(x=>x.id===id);
   if(f){f.values[k]=+el.value;syncGraph();}
  }
  input("input[data-fx-param]",setFx);all("select[data-fx-param]","change",el=>{checkpoint();setFx(el);});
  all("[data-send-level]","pointerdown",checkpoint);
  function updateDial(inputEl){
   const parent=inputEl.closest(".w-metal-knob");if(!parent)return;
   const angle=-137+(+inputEl.value-+inputEl.min)/(+inputEl.max-+inputEl.min)*274;
   parent.style.setProperty("--turn",angle+"deg");
   parent.querySelector("output").textContent=compact(+inputEl.value,2)+parent.dataset.unit;
  }
  for(const el of out.querySelectorAll(".w-metal-knob input")){
   el.addEventListener("input",()=>queueMicrotask(()=>updateDial(el)));
   let drag;
   el.onpointerdown=e=>{
    e.preventDefault();checkpoint();el.focus({preventScroll:true});el.setPointerCapture(e.pointerId);
    drag={from:+el.value,x:e.clientX,y:e.clientY};
   };
   el.onpointermove=e=>{
    if(!drag)return;
    const min=+el.min,max=+el.max,step=+el.step;
    const scaled=(drag.y-e.clientY+(.53*(e.clientX-drag.x)))/115;
    const position=clamp(drag.from+scaled*(max-min),min,max);
    el.value=compact(min+Math.round((position-min)/step)*step,4);
    el.dispatchEvent(new Event("input",{bubbles:true}));
   };
   el.onpointerup=el.onpointercancel=el.onlostpointercapture=()=>drag=null;
  }
  function setInstrument(el,mark=false){
   const t=pTrack();if(!t||!WInstruments.has(t.kind))return;
   if(mark)checkpoint();
   const p=WInstruments.defs[t.kind].parameters[el.dataset.instrumentParam];
   if(!p)return;
   t.instrument[el.dataset.instrumentParam]=+el.value;t.instrumentPreset=-1;
   const preset=get("#w-instrument-preset");if(preset)preset.value="-1";
   syncGraph();if(t.kind==="fx")drawFxContour();
  }
  input('input[data-instrument-param]',el=>setInstrument(el));
  all('select[data-instrument-param]',"change",el=>setInstrument(el,true));
  change("#w-instrument-preset",el=>{
   const t=pTrack();if(!t)return;
   mutate(()=>{t.instrumentPreset=+el.value;t.instrument=WInstruments.preset(t.kind,+el.value);});
  });
  all("[data-instrument-release]","click",()=>{const t=pTrack();if(t)WDSP.releaseLatches(t.id);});
  all("[data-fx-pad]","click",el=>{
   const [id,pad]=el.dataset.fxPad.split(":");fxPads.set(id,+pad);render();
  });
  all("[data-pad-audition]","click",el=>{
   const t=inst(),pad=+el.dataset.padAudition;
   if(!t||t.kind!=="drums")return;
   audio().then(async()=>{
    const asset=t.kit[pad].sample;
    if(asset)await WDSP.decode(ctx,project.assets[asset],asset);
    const strip=WDSP.graph.get(t.id);if(strip)WDSP.hit(ctx,pad,ctx.currentTime+.01,strip.local,t);
   }).catch(()=>toast("No se pudo tocar este pad."));
  });
 }
 async function addClip(track,file){
  if (file)await importCandidate({rawFile:file});
  else if(track)await importCandidate(sources().find(item=>item.id===track.id));
 }
 function setTempo(bpm){
  mutate(()=>{project.bpm=clamp(bpm,30,300);for(const track of project.tracks)for(const clip of track.clips)WModel.recalibrate(project,track,clip);});
 }
 function leave(){enabled=false;cancelAnimationFrame(meters);cancelMic(false);stop();WDSP.reset();}
 return {render,leave,addClip,setTempo,stop,openLibraryProject,isRecording:()=>Boolean(takeClock||micTake||drumTake)};
})();

export { StudioWorkbench };
