import { clamp, uid } from "./host.js";
import { WInstruments } from "./instruments.js";
const WModel=(()=>{
 const keymap=[..."zaxscvdbfngmqhwjerktlyoui"];
 // Natural keys form the lower and upper QWERTY rows. The remaining letters fill sharps.
 if(keymap.length!==25||new Set(keymap).size!==25)throw new Error("Mapa de piano inválido");
 const types={
  synth:["Sintetizador",.018,.24,8200,.23],
  piano:["Piano Clásico",.004,.31,6300,.16],
  rhodes:["Rhodes",.004,.34,4600,.15],
  guitar:["Guitarra acústica",.002,.24,9100,.28],
  electric:["Guitarra eléctrica",.003,.29,9800,.25],
  bass:["Bajo",.009,.22,1600,.25],
  bass808:["808 Bass",.004,.71,2400,.40],
  flute:["Flauta",.071,.27,5400,.11],
  drums:["Batería",.002,.16,8100,.21],
  cello:["Cello",.094,.35,3900,.16],
  audio:["Audio",.004,.11,12000,.1],
  bus:["Bus"]
 };
 const drumControls=rules=>Object.fromEntries(Array.from({length:8},(_,pad)=>rules.map(([key,...spec])=>["p"+pad+"_"+key,spec])).flat());
 const effects={
  bpm:{title:"Calibrador BPM",allowed:["audio"],controls:{}},
  amp:{title:"Larp Amplificador",allowed:["electric","guitar","bass","audio"],
   choices:{mode:["Limpio","Crunch","Lead","Bajo"],cab:["Directa","2×12 abierta","4×12 cerrada","1×15 bajo"],mic:["Centro","Borde","Fuera de eje"]},
   controls:{mode:["Canal",0,3,0],preamp:["Preamp",0,36,12,.5," dB"],gain:["Ganancia",0,100,29,1," %"],
    low:["Graves",-12,12,0,.5," dB"],mid:["Medios",-12,12,0,.5," dB"],high:["Agudos",-12,12,0,.5," dB"],
    presence:["Presencia",-9,9,1,.5," dB"],master:["Máster",-24,6,-3,.5," dB"],volume:["Volumen",-30,9,0,.5," dB"],
    cab:["Caja",0,3,1],mic:["Micrófono",0,2,0]}},
  drive:{title:"Larp Overdrive / Distortion",allowed:["guitar","electric","bass"],choices:{bands:["Pedal","Tres bandas"]},controls:{bands:["Procesamiento",0,1,0],drive:["Drive",0,100,36],tone:["Tono",0,100,58],color:["Color OD → DS",0,100,0],mix:["Mezcla",0,100,85],level:["Nivel",0,120,88]}},
  fuzz:{title:"Larp Fuzzy",allowed:["guitar","electric","bass"],choices:{flavor:["Grueso","Sostenido","Transistor","Vintage","Compuerta"],oversample:["1×","2×","4×"]},controls:{fuzz:["Fuzz",0,100,48],bias:["Polarización",-100,100,21],tone:["Tono",0,100,44],flavor:["Carácter",0,4,0],oversample:["Sobremuestreo",0,2,1],mix:["Mezcla",0,100,70],level:["Nivel",0,120,80]}},
  space:{title:"Larp Reverb · Chorus · Dimension",allowed:["guitar","electric","bass"],controls:{reverb:["Reverb",0,100,25],chorus:["Chorus",0,100,23],dimension:["Dimensión",0,100,18],rate:["Velocidad",.15,7,.8,.01],room:["Sala",.25,3,1.3,.01],delay:["Eco",25,900,270],feedback:["Realimentación",0,78,25],density:["Densidad",0,100,32],warp:["Warp",0,100,15],wet:["Mezcla de eco",0,100,12],lowcut:["Corte grave",20,600,100],highcut:["Corte agudo",1500,18000,8400]}},
  sustain:{title:"Larp Sustain Lead",allowed:["guitar","electric"],choices:{latch:["Mientras tocas","Retener al soltar"]},controls:{amount:["Sostenido",32,100,88],attack:["Entrada (ms)",3,180,20],release:["Salida (ms)",40,2100,410],latch:["Modo",0,1,0],level:["Nivel",30,115,85]}},
  padvault:{title:"Larp Pad Vault",allowed:["drums"],pad:true,controls:{volume:["Volumen",0,140,100],filter:["Filtro (Hz)",350,18000,10400],room:["Reverb",0,100,19],...drumControls([["volume","Ganancia",0,150,100],["pan","Balance",-100,100,0],["attack","Ataque añadido (ms)",0,85,0],["tune","Afinación (¢)",-1200,1200,0]])}},
  drumcircuit:{title:"Larp Drum Circuit",allowed:["drums"],pad:true,choices:{sync:["Milisegundos","Al tempo"],delaySide:["Stereo","Ping-pong","Izquierdo","Derecho"]},controls:{room:["Sala",0,100,32],sync:["Sync",0,1,1],delaySide:["Canales de eco",0,3,1],delay:["Tiempo (ms)",40,960,260],division:["División (pulsos)",.125,2,.5,.125],feedback:["Feedback",0,75,24],mix:["Eco",0,100,20],dist:["Distorsión",0,100,19],gain:["Salida",5,145,100],...drumControls([["volume","Ganancia",0,150,100],["pan","Balance",-100,100,0],["tune","Afinación (¢)",-1200,1200,0]])}}
 };
 const noteSpec={
  velocity:["Velocidad",1,127,95],pan:["Pan de nota",-100,100,0],release:["Liberación",.01,2,.21],
  cutoff:["Filtro",80,18000,14000],q:["Resonancia Q",.3,12,.72],fine:["Tono fino (¢)",-100,100,0],repeat:["Repeticiones",1,8,1]
 };
 const groupSpec={vol:["Volumen de canal (dB)",-60,6,0],pan:["Pan de canal",-100,100,0],pitch:["Tono de canal (¢)",-1200,1200,0]};
 const pluginAllowed=(kind,key)=>Boolean(Object.hasOwn(effects,key)&&(!effects[key].allowed||effects[key].allowed.includes(kind)));
 const settings=()=>({pan:0,polarity:false,swap:false,width:0,volume:0,time:0,unit:"ms",mute:false,solo:false,route:"master",sends:[],fx:[]});
 const empty=()=>({format:"larp-workbench",version:1,name:"Proyecto sin título",bpm:120,master:settings(),tracks:[],assets:{}});
 const identifier=()=>uid();
 const finite=(value,min,max,fallback)=>Number.isFinite(Number(value))?clamp(Number(value),min,max):fallback;
 const maxBeat=Number.MAX_SAFE_INTEGER/128;
 const padNames=["Bombo","Caja","Charles cerrado","Charles abierto","Tom bajo","Tom alto","Palmas","Ride"];
 const padKeys=[..."asdfjklh"];
 const padSpec={
  tune:["Afinación (¢)",-1200,1200,0,5],attack:["Ataque (ms)",.5,100,2,.5],
  hold:["Sostén (ms)",0,700,12,1],decay:["Caída (ms)",15,3000,180,1],
  level:["Nivel (%)",0,140,90,1], overhead:["Overhead (%)",0,100,18,1],room:["Sala (%)",0,100,10,1]
 };
 function drumKit(style="studio"){
  return padNames.map((name,i)=>({
   tune:0,attack:[1,1,.5,1,2,2,.5,1][i],hold:[12,7,3,10,8,8,16,14][i],
   decay:[320,170,65,400,290,220,155,520][i]*(style==="dry"?.61:1),
   level:[100,86,59,65,84,78,75,57][i],overhead:[5,18,27,36,17,16,24,45][i],
   room:style==="dry"?0:[7,15,8,12,16,15,17,12][i],sample:""
  }));
 }
 const tempoFx=t=>t.kind==="audio"&&t.mix.fx.some(f=>f.kind==="bpm"&&f.enabled);
 const sourceBpm=(p,c)=>c.sourceBpm||p.assets[c.asset]?.tempo?.bpm||0;
 function audioGrid(p,t,c){
  const bpm=sourceBpm(p,c),rate=bpm?p.bpm/bpm:1;
  const synced=tempoFx(t)&&bpm>0&&rate>=.5&&rate<=2;
  return {synced,rate:synced?rate:1,bpm,scale:synced?60/bpm:60/p.bpm};
 }
 function recalibrate(p,t,c){
  if(!c.asset)return;
  const prev=c.sourceScale||60/p.bpm,next=audioGrid(p,t,c).scale;
  if(prev===next)return;
  const ratio=prev/next;
  c.length*=ratio;c.offset*=ratio;c.sourceScale=next;
  for(const key of ["gain","pan","pitch"])for(const point of c[key])point.beat*=ratio;
 }
 const track=(kind,label)=>({id:identifier(),kind,name:label||types[kind][0],mix:{...settings(),volume:kind==="bus"?0:-11},timbre:50,attack:types[kind][1]??.02,release:types[kind][2]??.2,...(WInstruments.has(kind)?{instrument:WInstruments.defaults(kind),instrumentPreset:-1}:{}),...(kind==="drums"?{kit:drumKit(),kitStyle:"studio"}:{}),clips:[]});
 const clip=(start=0,length=16,asset="")=>({id:identifier(),start,length,offset:0,asset,sourceScale:0,sourceBpm:0,notes:[],gain:[{beat:0,value:0}],pan:[{beat:0,value:0}],pitch:[{beat:0,value:0}],layers:[]});
 const note=(start,pitch,length=1)=>({id:identifier(),start,pitch,length,...Object.fromEntries(Object.entries(noteSpec).map(([key,[,,,value]])=>[key,value]))});
 const plugin=key=>({id:identifier(),kind:key,enabled:true,values:Object.fromEntries(Object.entries(effects[key].controls).map(([id,[,,,value]])=>[id,value]))});
 const nameLimit=(s,n=80)=>typeof s==="string"?s.slice(0,n):"";
 const list=(value,max)=>Array.isArray(value)?value.slice(0,max):[];
 const allowedAudio=type=>/^audio\/[a-z0-9.+-]+$/i.test(type);
 function at(points,beat,fallback=0) {
  let previous;
  for(const next of points){
   if(next.beat>beat){
    if(!previous)return next.value;
    const ratio=(beat-previous.beat)/(next.beat-previous.beat);
    return previous.value+(next.value-previous.value)*ratio;
   }
   previous=next;
  }
  return previous?.value??fallback;
 }
 function points(value,min,max,fallback=0,end=maxBeat){
  const clean=list(value,50000).map(p=>({beat:finite(p?.beat,0,end,0),value:finite(p?.value,min,max,fallback)})).sort((a,b)=>a.beat-b.beat);
  return clean.length?clean.filter((p,i)=>i===0||p.beat!==clean[i-1].beat):[{beat:0,value:fallback}];
 }
 function trim(section,start,end){
  const oldStart=section.start,oldEnd=oldStart+section.length;
  const left=start-oldStart,right=end-oldStart;
  if(left<0||right-left<.03125-1e-9||start>=oldEnd||start===oldStart&&end===oldEnd)return false;
  section.start=start;section.length=end-start;section.offset+=left;
  section.notes=section.notes.filter(n=>n.start<right&&n.start+n.length>left).map(n=>{
   const first=Math.max(n.start,left);
   return {...n,start:first-left,length:Math.min(n.start+n.length,right)-first};
  });
  section.layers=section.layers.filter(step=>step.beat>=left&&step.beat<right).map(step=>({...step,beat:step.beat-left}));
  for(const key of ["gain","pan","pitch"]){
   const old=section[key];
   const points=old.filter(p=>p.beat>=left&&p.beat<=right).map(p=>({beat:p.beat-left,value:p.value}));
   if(left>0&&points[0]?.beat!==0)points.unshift({beat:0,value:at(old,left)});
   if(end<oldEnd&&points.at(-1)?.beat!==section.length)points.push({beat:section.length,value:at(old,right)});
   section[key]=points;
  }
  return true;
 }
 function split(section,cut){
  const start=section.start,end=start+section.length;
  if(cut-start<.03125||end-cut<.03125)return null;
  const other=structuredClone(section);
  other.id=identifier();
  trim(section,start,cut);trim(other,cut,end);
  for(const note of other.notes)note.id=identifier();
  return other;
 }
 const mixId=(project,id)=>id==="master"?project.master:project.tracks.find(track=>track.id===id)?.mix;
 const outputs=(project,id)=>{
  if(id==="master")return [];
  const m=mixId(project,id);
  return m?[m.route,...m.sends.map(send=>send.to)]:[];
 };
 function mayRoute(project,from,to){
  if(from==="master"||from===to)return false;
  if(to==="master")return true;
  if(!project.tracks.some(t=>t.id===to&&t.kind==="bus"))return false;
  const visited=new Set();
  const walk=id=>{
   if(id===from)return true;
   if(visited.has(id))return false;
   visited.add(id);
   return outputs(project,id).some(walk);
  };
  return !walk(to);
 }
 function manualMs(m,bpm,sr){
  return clamp(m.unit==="samples"?m.time/sr*1000:m.unit==="beats"?m.time*60000/bpm:m.time,-500,500);
 }
 function matrix({width,swap,polarity,pan}){
  const side=1+width/100,mid=(1+side)/2,cross=(1-side)/2,sgn=polarity?-1:1;
  const l=sgn*(1-Math.max(0,pan)/100),r=sgn*(1+Math.min(0,pan)/100);
  return swap?[l*cross,l*mid,r*mid,r*cross]:[l*mid,l*cross,r*cross,r*mid];
 }
 function readProject(raw) {
  if(raw?.format!=="larp-workbench"||raw.version!==1||!Array.isArray(raw.tracks)||raw.tracks.length>20)
    throw new Error("Elige un proyecto .larp.json de este Estudio con hasta 20 pistas.");
  const project=empty(),used=new Set(),links=[];
  const validId=id=>typeof id==="string"&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
  const idFor=value=>{
   if(!validId(value)||used.has(value)||value==="master")return identifier();
   used.add(value);return value;
  };
  project.name=nameLimit(raw.name)||project.name;
  project.bpm=finite(raw.bpm,30,300,120);
  let size=0;
  const imported=Object.entries(raw.assets||{});
  if(imported.length>120)throw new Error("El proyecto supera el número de muestras manejable por el navegador.");
  for(const [id,a] of imported){
   if(!validId(id)||!allowedAudio(a?.type)||typeof a.base64!=="string"||(a.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)))continue;
   size+=a.base64.length;
   if(size>120*1024*1024)throw new Error("El proyecto supera el tamaño de audio que esta demo puede abrir.");
   project.assets[id]={name:nameLimit(a.name,160),type:a.type,base64:a.base64,duration:finite(a.duration,.01,86400,1),peaks:list(a.peaks,192).map(v=>finite(v,0,1,0)),tempo:a.tempo?{bpm:finite(a.tempo.bpm,0,300,0),candidate:finite(a.tempo.candidate,0,300,0),confidence:finite(a.tempo.confidence,0,1,0)}:null};
  }
  function mix(raw,kind,id) {
   const s=settings();
   for(const key of ["polarity","swap","mute","solo"])s[key]=raw?.[key]===true;
   for(const [key,min,max] of [["pan",-100,100],["width",-100,100],["volume",-80,6]])s[key]=finite(raw?.[key],min,max,s[key]);
   if(["ms","samples","beats"].includes(raw?.unit))s.unit=raw.unit;
   const cap=s.unit==="samples"?500000:s.unit==="beats"?2.5:500;
   s.time=finite(raw?.time,id==="master"?0:-cap,cap,0);
   s.fx=list(raw?.fx,32).filter(f=>pluginAllowed(kind,f?.kind)).map(f=>{
    const result=plugin(f.kind);
    result.id=idFor(f.id);result.enabled=f.enabled!==false;
    const definition=effects[f.kind];
    for(const [key,[,min,max,value]] of Object.entries(definition.controls)){
     const saved=finite(f.values?.[key],min,max,value);
     result.values[key]=definition.choices?.[key]?Math.round(saved):saved;
    }
    if(f.kind==="drive"&&f.values?.color===undefined)result.values.color=100*finite(f.values?.mode,0,1,0);
    return result;
   });
   if(kind==="audio"){let seen=false;s.fx=s.fx.filter(f=>f.kind!=="bpm"||!seen&&(seen=true));}
   links.push([id,s,raw?.route,list(raw?.sends,20)]);
   return s;
  }
  project.master=mix(raw.master,"bus","master");
  for(const input of raw.tracks){
   if(!input||!Object.hasOwn(types,input.kind))throw new Error("El proyecto tiene una pista inválida.");
   const tr=track(input.kind,nameLimit(input.name));
   tr.id=idFor(input.id);tr.mix=mix(input.mix,tr.kind,tr.id);
   if(WInstruments.has(tr.kind)){
    tr.instrument=WInstruments.read(tr.kind,input.instrument);
    tr.instrumentPreset=Math.floor(finite(input.instrumentPreset,-1,WInstruments.defs[tr.kind].presets.length-1,-1));
    if(tr.kind==="rhodes"&&!input.instrument){
     const legacy=list(input.mix?.fx,32).find(f=>f?.kind==="rhodes"&&f.enabled!==false);
     if(legacy?.values)tr.instrument=WInstruments.read("rhodes",{bell:legacy.values.bell,drive:legacy.values.drive,tremolo:legacy.values.tremolo,
      speed:legacy.values.speed,high:((legacy.values.tone??50)-50)*.21,chorus:0});
    }
   }
   tr.timbre=finite(input.timbre,0,100,50);tr.attack=finite(input.attack,.001,.45,.02);tr.release=finite(input.release,.01,2,.24);
   if(tr.kind==="drums"){
    tr.kitStyle=input.kitStyle==="dry"?"dry":"studio";
    tr.kit=drumKit(tr.kitStyle).map((pad,i)=>{
     const saved=input.kit?.[i];
     for(const [key,[,min,max]] of Object.entries(padSpec))pad[key]=finite(saved?.[key],min,max,pad[key]);
     if(saved?.sample&&Object.hasOwn(project.assets,saved.sample))pad.sample=saved.sample;
     return pad;
    });
   }
   tr.clips=tr.kind==="bus"?[]:list(input.clips,7000).map(c=>{
    const keep=c?.asset&&Object.hasOwn(project.assets,c.asset)?c.asset:"";
    const part=clip(finite(c?.start,0,maxBeat,0),finite(c?.length,.03125,maxBeat,16),keep);
    part.id=idFor(c?.id);part.offset=finite(c?.offset,0,maxBeat,0);
    part.sourceScale=keep?finite(c?.sourceScale,.2,2,60/project.bpm):0;
    if(keep&&!c?.sourceScale)part.sourceScale=60/project.bpm;
    part.sourceBpm=c?.sourceBpm?finite(c.sourceBpm,30,300,0):0;
    for(const [k,min,max] of [["gain",-60,12],["pan",-100,100],["pitch",-1200,1200]])part[k]=points(c?.[k],min,max,0,part.length);
    part.notes=list(c?.notes,300000).map(n=>{
     const event=note(finite(n?.start,0,maxBeat,0),Math.round(finite(n?.pitch,0,127,60)),finite(n?.length,.03125,maxBeat,1));
     event.id=idFor(n?.id);
     for(const [k,[,min,max,val]] of Object.entries(noteSpec))event[k]=finite(n?.[k],min,max,val);
     return event;
    }).filter(n=>n.start<part.length).map(n=>({...n,length:Math.min(n.length,part.length-n.start)}));
    part.layers=list(c?.layers,150000).filter(r=>r&&Number.isFinite(r.beat)&&r.beat>=0&&r.beat<part.length)
      .map(r=>({beat:r.beat,pad:Math.floor(finite(r.pad,0,7,0)),velocity:finite(r.velocity,0,1,.86)}));
    return part;
   });
   project.tracks.push(tr);
  }
  for(const [id,m,to,sends] of links){
   if(mayRoute(project,id,to))m.route=to;
   for(const send of sends)if(mayRoute(project,id,send?.to)&&send.to!=="master"&&send.to!==m.route&&!m.sends.some(s=>s.to===send.to))
     m.sends.push({to:send.to,level:finite(send.level,-60,0,-16)});
  }
  return project;
 }
 return {keymap,types,effects,padNames,padKeys,padSpec,drumKit,tempoFx,sourceBpm,audioGrid,recalibrate,pluginAllowed,noteSpec,groupSpec,matrix,settings,empty,track,clip,note,plugin,at,trim,split,mayRoute,outputs,mixId,manualMs,readProject};
})();

export { WModel };
