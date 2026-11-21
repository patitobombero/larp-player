import { $, esc, limit, toast } from "../common.js";
import { api, bindForm, task } from "../client.js";
import { addLibraryFile } from "../library.js";
import { AUDIO_EXT, djHooks, session, studioHooks } from "../state.js";
import { downloadFile, downloadJSON, encodeWav } from "../wav.js";
import { barPhase, beatAt, configData, CUE_COLORS, DECKS, mixerSettings, mod, PRESETS, readRekordbox, settings, trackData } from "./data.js";
import { DDMixer } from "./engine.js";
import { controllerBody, controllerRange, createControllers } from "./controllers.js";
import { collectDDJSettings, ddjSettingsBody, readSettingsFile } from "./settings-view.js";
import { deckControls, drawDeck, mixerControls, paintDeck, paintHarmony } from "./view.js";
import { drawLiveWave, drawOverviewWave } from "./waveform.js";

const mixer=new DDMixer();
const records=new Map(),summaries=new Map();
let libraryPage=0,librarySort="name";
const importedLocal=[];
const loadingChoices=Object.fromEntries(DECKS.map(id=>[id,0]));
let config=configData();
let storageScope="";
let selected="";
let filter="";
let source="all";
let active="A";
let chosenView="auto";
try {chosenView=localStorage.getItem("larp:ddj-view")||"auto";} catch {}
let lastMix=null;
let mixRecorder=null;
let transportTimer=0;
let accountEpoch=0;
const deckNodes=()=>document.querySelectorAll("#ddj [data-deck]");
const allDecks=()=>Object.values(mixer.decks);
const storageKey=()=> "larp:ddj:" + (session.user?.id||"device");
const fileKey=track=>track.local ? [track.name,track.size,track.file?.lastModified||0].join("|").slice(0,120) : track.id;
const available=()=>[...session.tracks,...importedLocal];
const owns=track=>!track.local&&session.user&&session.savedTracks.some(item=>item.id===track.id);
const currentDeck=()=>mixer.decks[active];
const listFormat=new Intl.ListFormat("es");
const controllers=createControllers({storageKey,present:()=>session.page==="ddj",operate:operateController});

function operateController({deck:id,action},value,continuous){
  const deck=mixer.decks[id];
  if(!deck||!Number.isFinite(value))return;
  if(continuous){
    if(action==="tempo"){deck.manualPitch((value*2-1)*deck.opts.tempoRange);return;}
    const range=controllerRange(action);
    if(!range?.length)return;
    const [min,max,step]=range;
    const next=Math.max(min,Math.min(max,Math.round((min+(max-min)*value)/step)*step));
    if(action==="cross")mixer.config.cross=next;
    else if(action==="master-volume")mixer.config.master=next;
    else mixer.config[id][action]=next;
    mixer.apply();paintMixControls();localConfig();
    return;
  }
  if(!deck.track)return;
  if(action==="cue"){
    Promise.resolve(value>.5?deck.cuePress():deck.cueRelease()).catch(error=>toast(error.message));
    return;
  }
  const panel=$("#ddj")?.querySelector(`[data-deck="${id}"]`);
  const key=action.startsWith("loop")?`[data-beats="${action.slice(4)}"]`:
    action.startsWith("cue")?`[data-ddj-action="hot"][data-index="${action.slice(3)}"]`:`[data-ddj-action="${action}"]`;
  const button=panel?.querySelector(key);
  if(button)task(button,()=>dispatch(button,deck));
}

function stateFromLocal(){
  try{return JSON.parse(localStorage.getItem(storageKey()))||{};}catch{return {};}
}

function useConfig(payload){
  config=configData(payload);
  mixer.config=mixerSettings(config.mix);
  for(const deck of allDecks()){
    deck.opts=settings(config.decks[deck.id]);
    if(!deck.sync&&Math.abs(deck.pitch)>deck.opts.tempoRange)deck.manualPitch(deck.pitch);
    if(!deck.opts.slip)deck.slipClock=null;
    deck.updatePitch();
  }
  mixer.apply();
}

function resetDDJ(){
  controllers.disconnect();
  accountEpoch++;
  if(mixRecorder?.state==="recording")mixRecorder.stop();
  mixRecorder=null;
  lastMix=null;
  mixer.reset();
  records.clear();summaries.clear();libraryPage=0;
  for(const track of importedLocal.splice(0))URL.revokeObjectURL(track.url);
  active="A";selected="";filter="";source="all";storageScope="";
  updateTimer();
}

function accountPreferences(raw){
  const key=storageKey();
  if(storageScope&&storageScope!==key)resetDDJ();
  storageScope=key;
  useConfig(raw||stateFromLocal());
  redraw();
}

function snapshot(){
  config.decks=Object.fromEntries(allDecks().map(deck=>[deck.id,settings(deck.opts)]));
  config.mix=mixerSettings(mixer.config);
  return configData(config);
}
function localConfig(){
  try{localStorage.setItem(storageKey(),JSON.stringify(snapshot()));}catch{}
}
async function saveConfig(){
  localConfig();
  if(session.user){
    const owner=session.user.id;
    const payload=snapshot();
    await api("preferences/ddj",{method:"PUT",data:payload});
    if(session.user?.id===owner)session.ddjPreferences=payload;
  }
}

function localRecord(track){
  try{return JSON.parse(localStorage.getItem(storageKey()+":track:"+fileKey(track)))||{};}catch{return {};}
}
async function getTrackRecord(track){
  if(!track)return {};
  const key=fileKey(track);
  if(records.has(key))return records.get(key);
  const saved=trackData(owns(track)?await api("dj-tracks/"+track.id):localRecord(track));
  records.set(key,saved);
  return saved;
}
async function saveTrackRecord(track,data){
  if(!track)return;
  const clean=trackData(data);
  if(owns(track))await api("dj-tracks/"+track.id,{method:"PUT",data:clean});
  else{
    try{localStorage.setItem(storageKey()+":track:"+fileKey(track),JSON.stringify(clean));}
    catch{throw new Error("El navegador no pudo conservar los marcadores en este dispositivo.");}
  }
  records.set(fileKey(track),clean);
}

function applyTrackUpdate(deck,data){
  const saved=trackData(data);
  for(const item of allDecks().filter(item=>item.track?.id===deck.track?.id)){
    item.metadata=structuredClone(saved);
    item.cues=structuredClone(saved.cues);
    if(saved.memory!==null)item.cue=item.bounded(saved.memory);
  }
}
async function storeDeck(deck){
  const track=deck.track;
  if(!track)return;
  const data=trackData(deck.metadata);
  await saveTrackRecord(track,data);
  if(deck.track===track)applyTrackUpdate(deck,data);
  redraw();
}

function filteredTracks(){
  const normalized=text=>String(text).normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase();
  const include=source==="tags" ? track=>config.tags.includes(fileKey(track)) :
    source==="device" ? track=>track.local : source.startsWith("playlist:") ?
      track=>session.playlists.find(list=>list.id===source.slice(9))?.tracks.includes(track.id) : ()=>true;
  let list=available().filter(track=>include(track)&&normalized([track.title,track.artist,track.name].filter(Boolean).join(" ")).includes(normalized(filter)));
  if(source.startsWith("playlist:")){
    const order=session.playlists.find(list=>list.id===source.slice(9))?.tracks||[];
    list=list.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  }
  return list;
}

function paintSource(){
  const root=$("#ddj");
  if(!root)return;
  root.style.setProperty("--source-color",config.defaults.sourceColor);
  const list=filteredTracks();
  if(!list.some(track=>track.id===selected))selected=list[0]?.id||"";
  const rows=root.querySelector("[data-ddj-table]");
  const entries=list.map(track=>{
    const record=allDecks().find(deck=>deck.track?.id===track.id)?.metadata||records.get(fileKey(track));
    const summary=summaries.get(track.id);
    return [track.id,track.title||track.name,!!track.local,record?.grid?.[0]?.bpm||summary?.bpm||0,
      record?.key||summary?.key||"",record?.loudness??summary?.loudness??null];
  });
  if(!source.startsWith("playlist:"))entries.sort((a,b)=>librarySort==="bpm"?(a[3]||Infinity)-(b[3]||Infinity)||a[1].localeCompare(b[1]):
    a[1].localeCompare(b[1],undefined,{numeric:true,sensitivity:"base"}));
  const pages=Math.max(1,Math.ceil(entries.length/80));
  libraryPage=Math.min(libraryPage,pages-1);
  const visible=entries.slice(libraryPage*80,(libraryPage+1)*80);
  if(!visible.some(([id])=>id===selected))selected=visible[0]?.[0]||"";
  root.querySelector("[data-ddj-pages]").hidden=pages===1;
  root.querySelector("[data-ddj-page]").textContent=(libraryPage+1)+" / "+pages;
  root.querySelector("[data-ddj-prev]").disabled=libraryPage===0;
  root.querySelector("[data-ddj-next]").disabled=libraryPage+1===pages;
  const signature=JSON.stringify(visible);
  if(rows.dataset.signature!==signature){
    rows.dataset.signature=signature;
    rows.innerHTML=visible.map(([id,title,local,bpm,key,loudness])=>`<tr><th scope="row"><button type="button" data-select-track="${esc(id)}" title="${esc(title)}">${esc(title)}</button></th>
      <td>${bpm?bpm.toFixed(2):"—"}</td><td>${esc(key||"—")}</td><td>${loudness===null?"—":loudness.toFixed(1)}</td><td>${local?"Dispositivo":"Biblioteca"}</td></tr>`).join("")||
      '<tr><td colspan="5">No hay pistas en esta vista. Abre un archivo de audio para mezclar.</td></tr>';
  }
  for(const row of rows.querySelectorAll("[data-select-track]"))row.setAttribute("aria-pressed",String(row.dataset.selectTrack===selected));
  const sources=root.querySelector("[data-ddj-source]");
  sources.innerHTML='<option value="all">Biblioteca y archivos</option><option value="tags">Tag List</option><option value="device">Dispositivo</option>'+
    session.playlists.map(list=>`<option value="playlist:${esc(list.id)}">${esc(list.name)}</option>`).join("");
  sources.value=source;
  if(!sources.value){source="all";sources.value=source;paintSource();return;}
  const count=root.querySelector("[data-ddj-count]");
  count.textContent=list.length+(list.length===1?" pista":" pistas");
  for(const key of DECKS)root.querySelector(`[data-load="${key}"]`).disabled=!selected||Boolean(mixer.decks[key].loading);
}

function addLocalFiles(files){
  for(const file of files){
    const acceptable=file.type.startsWith("audio/")||AUDIO_EXT.split(",").some(ext=>file.name.toLowerCase().endsWith(ext));
    if(!acceptable||!file.size)continue;
    const track={id:crypto.randomUUID(),name:file.name,size:file.size,file,local:true,url:URL.createObjectURL(file)};
    importedLocal.push(track);
    selected=track.id;
  }
  filter="";
  $("#ddj-search").value="";
  source="device";libraryPage=0;
  paintSource();
}

async function loadTrack(deck,track){
  if(deck.playing&&deck.opts.loadLock)throw new Error("Load Lock está activo. Pausa el deck antes de cargar otra pista.");
  if(!track)throw new Error("Selecciona una pista en la fuente.");
  const token=++loadingChoices[deck.id];
  const scope=accountEpoch;
  const data=await getTrackRecord(track);
  if(scope!==accountEpoch||token!==loadingChoices[deck.id])return;
  active=deck.id;
  if ($("#ddj")) $("#ddj").dataset.activeDeck=active;
  const pending=deck.load(track,data);
  paintSource();redraw();
  await pending;
  if(scope!==accountEpoch||token!==loadingChoices[deck.id]||deck.track!==track)return;
  mixer.apply();
  if(deck.analysis&&(!data.grid.length||data.loudness===null||data.loudness===undefined)){
    const metadata=trackData(deck.metadata);
    records.set(fileKey(track),metadata);
    if(owns(track))saveTrackRecord(track,metadata).catch(()=>{});
  }
  paintSource();redraw();
  if(!deck.canAnalyze())toast("Pista lista para streaming. Usa un beatgrid importado o introduce el BPM.");
}

async function continuous(deck){
  const list=filteredTracks();
  const index=list.findIndex(track=>track.id===deck.track?.id);
  const track=index>=0?list[index+1]:null;
  if(!track)return;
  await loadTrack(deck,track);
  if(deck.track===track)await deck.start(deck.cue);
}
for(const deck of allDecks()){
  deck.onNotice=toast;
  deck.onNext=deck=>continuous(deck).catch(error=>toast(error.message));
  deck.onChanged=()=>{
    redrawDeck(deck);
    updateTimer();
  };
}

function updateTimer(){
  const live=allDecks().some(deck=>deck.playing);
  mixer.tickSync();
  mixer.applySpace(true);
  if(live&&!transportTimer){
    transportTimer=setInterval(()=>{
      for(const deck of allDecks())deck.tick();
      mixer.tickSync();
      mixer.applySpace();
    },25);
  }
  if(!live&&transportTimer){clearInterval(transportTimer);transportTimer=0;}
}

function redrawDeck(deck){
  const root=$("#ddj")?.querySelector(`[data-deck="${deck.id}"]`);
  if(!root)return;
  drawDeck(root,deck);
  drawOverviewWave(root.querySelector("[data-wave-box] canvas"),root.querySelector("[data-wave-overview]"),deck,mixer);
  paintDeck(root,deck,mixer,deck.track&&config.tags.includes(fileKey(deck.track)));
  paintHarmony(root,deck,tonalReference());
}

function paintKnob(input){
  if(!input.matches("[data-knob]"))return;
  const value=Number(input.value),percent=(value-Number(input.min))/(Number(input.max)-Number(input.min));
  input.parentElement.style.setProperty("--knob-angle",(-138+276*percent)+"deg");
  const label=input.nextElementSibling;
  const text=input.dataset.mix==="pan"?(value?`${Math.round(Math.abs(value)*100)} % ${value<0?"izq.":"der."}`:"Centro"):
    Number(value.toFixed(2))+input.dataset.unit;
  label.textContent=text;
  input.setAttribute("aria-valuetext",text);
}

function bindKnob(input){
  if(!input.matches("[data-knob]"))return;
  let drag;
  input.addEventListener("pointerdown",event=>{
    if(event.button!==0)return;
    event.preventDefault();
    input.focus({preventScroll:true});
    input.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,start:Number(input.value)};
  });
  input.addEventListener("pointermove",event=>{
    if(event.pointerId!==drag?.id)return;
    const travel=event.clientX-drag.x+drag.y-event.clientY;
    const min=Number(input.min),max=Number(input.max),step=Number(input.step);
    const delta=travel*(max-min)/(event.shiftKey?720:145);
    const value=Math.round((drag.start+delta-min)/step)*step+min;
    input.value=String(Math.max(min,Math.min(max,value)));
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  input.addEventListener("lostpointercapture",()=>{
    drag=null;
    input.dispatchEvent(new Event("change",{bubbles:true}));
  });
}

function paintMixControls(){
  const root=$("#ddj");
  if(!root)return;
  for(const input of root.querySelectorAll("[data-mix]")){
    const channel=input.closest("[data-channel]")?.dataset.channel;
    const data=channel?mixer.config[channel]:mixer.config;
    const value=data[input.dataset.mix];
    if(input.type==="checkbox")input.checked=value;
    else input.value=value;
    paintKnob(input);
  }
  for(const button of root.querySelectorAll("[data-fx][data-target]")){
    button.setAttribute("aria-pressed",String(mixer.config[button.dataset.target].fx===button.dataset.fx));
  }
  paintSpaceControls(root);
}

function paintSpaceControls(root){
  const panel=root.querySelector("[data-space-panel]:not([hidden])");
  if(!panel)return;
  const id=panel.dataset.channel,mix=mixer.config[id], current=mixer.spaceApplied[id];
  const auto=mix.spaceMode==="auto";
  const values=auto&&current?{pan:current.pan,spaceWidth:current.width*100,spaceWet:current.wet*100,
    spaceTone:current.tone,spaceFocus:current.focus*100}:mix;
  for(const input of panel.querySelectorAll("[data-knob]")){
    const key=input.dataset.mix;
    input.disabled=auto||(mix.spaceMode==="off"&&key!=="pan");
    if(input.disabled||document.activeElement!==input){input.value=values[key];paintKnob(input);}
  }
  const output=panel.querySelector("[data-space-status]");
  const label=!auto?"":current?.low<-.15||current?.mid<-.15?
    `Graves ${current.low.toFixed(1)} dB · cuerpo ${current.mid.toFixed(1)} dB`:
    current?.wet>0?"Espacio adaptado a la mezcla":"En espera de señal";
  if(output.textContent!==label)output.textContent=label;
}
function redraw(){
  for(const deck of allDecks())redrawDeck(deck);
  paintSource();paintMixControls();
}

function tonalReference(){
  const selected=mixer.decks[mixer.master];
  return mixer.decks[mixer.syncSource]||(selected?.track&&selected.playing?selected:null)||
    allDecks().find(deck=>deck.track&&deck.playing)||allDecks().find(deck=>deck.track);
}

const silence={peak:0,clip:false};
const dBFS=peak=>peak>.0001?(20*Math.log10(peak)).toFixed(1)+" dBFS":"−∞ dBFS";

function drawFrame(root){
  let last=0,lastHarmony=-Infinity;
  const tick=time=>{
    if(!root.isConnected)return;
    requestAnimationFrame(tick);
    if(time-last<30)return;
    last=time;
    if(root.dataset.activeDeck!==active)root.dataset.activeDeck=active;
    const reference=tonalReference();
    const analyzeHarmony=time-lastHarmony>=180;
    if(analyzeHarmony){lastHarmony=time;paintSpaceControls(root);}
    for(const node of deckNodes()){
      const deck=mixer.decks[node.dataset.deck];
      paintDeck(node,deck,mixer,deck.track&&config.tags.includes(fileKey(deck.track)));
      if(analyzeHarmony)paintHarmony(node,deck,reference);
      node.classList.toggle("ddj-selected",deck.id===active);
      const tab=root.querySelector(`[data-focus-deck="${deck.id}"]`);
      tab.setAttribute("aria-pressed",String(deck.id===active));
      const name=tab.querySelector("span");
      const label=deck.track?.title||deck.track?.name||"Sin pista";
      if(name.textContent!==label)name.textContent=label;
    }
    const {syncClock,syncMode}=mixer, leader=mixer.decks[mixer.syncSource];
    const bpmInput=root.querySelector("[data-sync-tempo]");
    const clockMode=root.querySelector("[data-clock-mode]");
    clockMode.disabled=syncMode==="off";
    clockMode.value=mixer.syncDynamic?"dynamic":"fixed";
    bpmInput.disabled=syncMode==="off";
    const freeClock=syncMode==="off"&&reference?.readyGrid&&reference.clockReady?reference:null;
    const clockBpm=syncClock.bpm||(freeClock?freeClock.baseBpm()*freeClock.rate:0);
    if(document.activeElement!==bpmInput)bpmInput.value=clockBpm?clockBpm.toFixed(2):"";
    const status=root.querySelector("[data-sync-group]");
    const synced=allDecks().filter(deck=>deck.sync&&deck.readyGrid);
    const state=syncMode==="off"?"Sync libre":
      leader?`Deck ${leader.id} · reloj compartido`:
      synced.length>1?listFormat.format(synced.map(deck=>deck.id))+" · reloj compartido":synced[0]?.id+" · reloj interno";
    if(status.textContent!==state)status.textContent=state;
    const clockReadout=root.querySelector("[data-sync-position]");
    const clockTrack=leader||freeClock;
    const clockBeat=freeClock?beatAt(freeClock.grid(),freeClock.position()):syncClock.read(mixer.context?.currentTime||0);
    const phase=clockTrack?barPhase(clockTrack.grid(),clockTrack.position()):{beat:Math.floor(mod(clockBeat,4)),meter:4};
    const clockText=clockBpm?`${Math.max(1,Math.floor(clockBeat/phase.meter)+1)}.${phase.beat+1}`:"—";
    if(clockReadout.textContent!==clockText)clockReadout.textContent=clockText;
    clockReadout.dataset.running=String(syncClock.running||Boolean(freeClock));
    const zoom=syncClock.bpm||(reference?.baseBpm()||120)*(reference?.rate||1);
    for(const deck of allDecks()){
      const lane=root.querySelector(`[data-live-lane="${deck.id}"]`);
      const title=lane.querySelector("[data-live-title]");
      const name=deck.track?.title||deck.track?.name||"Sin pista";
      if(title.textContent!==name)title.textContent=name;
      const channel=mixer.channels?.[deck.id], panel=root.querySelector(`[data-channel="${deck.id}"]`);
      const before=channel?.readBeforeFader()??silence, after=channel?.readAfterFader()??silence;
      const source=deck.analysis?.clipped?.[Math.floor(deck.position()*(deck.analysis?.detailRate||0))]===1;
      deck.clipActive=Boolean(deck.track&&(before.clip||after.clip));
      lane.dataset.loaded=String(Boolean(deck.track));
      lane.dataset.level=deck.clipActive||source?"clip":after.peak>.71?"hot":"normal";
      const stage=lane.querySelector("[data-live-level]");
      const gain=deck.track?dBFS(after.peak)+(deck.clipActive?" · Pico":source?" · Recorte":""):"";
      if(stage.textContent!==gain)stage.textContent=gain;
      stage.title=before.clip?"Sobrecarga antes del fader":after.clip?"Pico de salida ≥ 0 dBFS":source?"Posible recorte en el archivo":"Pico después del fader y crossfader";
      const meter=panel.querySelector("meter");
      meter.value=Math.min(1,before.peak);panel.dataset.clip=String(deck.clipActive);
      meter.title=`Antes del fader ${dBFS(before.peak)} · salida ${dBFS(after.peak)}`;
      const pfl=panel.querySelector("[data-ddj-action=prelisten]");
      if(pfl.getAttribute("aria-pressed")!==String(mixer.prelisten[deck.id]))pfl.setAttribute("aria-pressed",String(mixer.prelisten[deck.id]));
      drawLiveWave(lane.querySelector("canvas"),deck,mixer,zoom);
      const overview=root.querySelector(`[data-deck="${deck.id}"]`);
      if(overview.clientWidth)drawOverviewWave(overview.querySelector("[data-wave-box] canvas"),overview.querySelector("[data-wave-overview]"),deck,mixer);
    }
    const master=mixer.readMaster?.()??silence;
    root.querySelector("[data-ddj-master-meter]").value=Math.min(1,master.peak);
    const readout=root.querySelector("[data-ddj-master-level]"), text=dBFS(master.peak)+(master.clip?" · Pico":"");
    if(readout.textContent!==text)readout.textContent=text;
    readout.parentElement.parentElement.dataset.clip=String(master.clip);
  };
  requestAnimationFrame(tick);
}

export function showDDJ(){
  if(storageScope!==storageKey())accountPreferences(session.ddjPreferences);
  $("#main").innerHTML=`<section class="page ddj-page" id="ddj">
    <header class="ddj-plugin-head"><div class="ddj-wordmark"><span aria-hidden="true">◈</span><h1>Larp DDJ</h1></div>
      <label class="ddj-view-choice">Vista <select data-ddj-view aria-label="Vista del plugin">
        <option value="auto">Automática</option><option value="booth">Cabina</option><option value="focus">Deck ampliado</option></select></label>
      <div class="toolbar"><button class="g" type="button" data-source-jump>Fuente</button><button class="g" type="button" data-space-jump>Estéreo</button>
        <button class="g" data-ddj-action="settings">Mis ajustes</button>
        <button class="b ddj-record-head" data-ddj-action="record">Grabar mezcla</button></div></header>
    <section class="ddj-wave-rail" aria-label="Formas de onda y reloj de sincronización">
      <div class="ddj-wave-rail-head"><h2>Formas de onda</h2><span data-sync-group>Sync libre</span>
        <div class="ddj-clock"><output aria-label="Compás y pulso del reloj" data-sync-position>—</output>
        <label>Reloj BPM <input type="number" min="35" max="260" step=".01" inputmode="decimal" placeholder="—" data-sync-tempo disabled></label>
        <select data-clock-mode aria-label="Modo del reloj Sync" disabled><option value="fixed">Fijo</option>
          <option value="dynamic">Seguir deck</option></select></div></div>
      ${DECKS.map(id=>`<div class="ddj-wave-lane" data-live-lane="${id}">
        <button type="button" class="ddj-wave-label" data-jump-deck="${id}" aria-label="Ir al deck ${id}"><b>${id}</b><span class="ddj-wave-caption"><span data-live-title>Sin pista</span><output data-live-level></output></span></button>
        <div class="ddj-wave-display"><canvas width="930" height="92" aria-label="Forma de onda en vivo del deck ${id}"></canvas></div>
      </div>`).join("")}
    </section>
    <div class="ddj-focus-decks" role="group" aria-label="Deck ampliado">
      ${DECKS.map(id=>`<button class="g" data-focus-deck="${id}" aria-pressed="${id===active}"><b>${id}</b><span>Sin pista</span></button>`).join("")}
      <button class="g ddj-jump-mix" data-jump-mix>Mezclador</button></div>
    <div class="ddj-booth">${DECKS.map(deckControls).join("")}${mixerControls()}</div>
    <section class="card ddj-source">
      <div class="section-line"><h2 tabindex="-1">Fuente <span data-ddj-count></span></h2>
       <div class="toolbar"><label class="g ddj-file-action">Abrir archivos<input class="sr-only" data-ddj-files type="file" accept="${AUDIO_EXT}" multiple></label>
        <label class="g ddj-file-action">Importar rekordbox XML<input class="sr-only" data-ddj-xml type="file" accept=".xml,application/xml,text/xml"></label></div></div>
      <div class="ddj-source-controls"><select data-ddj-source aria-label="Fuente del deck"></select>
       <input type="search" id="ddj-search" placeholder="Buscar pista" aria-label="Buscar pista para mezclar" value="${esc(filter)}">
        <div class="ddj-load-buttons">${DECKS.map(id=>`<button class="g" data-ddj-action="load" data-load="${id}">Cargar ${id}</button>`).join("")}</div></div>
      <div class="ddj-table-scroll"><table><thead><tr><th scope="col"><button type="button" data-ddj-sort="name">Pista</button></th><th scope="col"><button type="button" data-ddj-sort="bpm">BPM</button></th><th scope="col">Tonalidad</th><th scope="col">LUFS</th><th scope="col">Origen</th></tr></thead>
        <tbody data-ddj-table></tbody></table></div>
      <div class="ddj-pages" data-ddj-pages hidden><button class="g" data-ddj-prev aria-label="Página anterior">‹</button>
       <output data-ddj-page></output><button class="g" data-ddj-next aria-label="Página siguiente">›</button></div>
      <p class="muted" data-ddj-import-result></p>
    </section>
    ${controllerBody()}
    <section class="card ddj-capture" hidden><h2>Grabación de la mezcla</h2><div data-capture-output></div></section>
    <details class="card"><summary>Controles y compatibilidad</summary>
      <p class="muted">Espacio reproduce el deck seleccionado y 1–8 activa sus pads. En el jog puedes arrastrar o usar las flechas.</p>
      <p class="muted">Para importar cues y cuadrículas, carga los audios y luego el XML de colección. El JSON de My Settings guarda ajustes de Larp DDJ. La expulsión y el aro corresponden a la fuente virtual.</p>
      <p class="muted">Las pistas grandes se reproducen por streaming. El análisis, Vinyl, reverse, brake y backspin necesitan audio decodificado de hasta 64 MiB y 12 min. Para sincronizar pistas mayores, importa su cuadrícula o marca BPM y primer pulso.</p>
    </details><dialog id="ddj-dialog" class="ddj-dialog"></dialog>
  </section>`;
  const root=$("#ddj");
  const view=root.querySelector("[data-ddj-view]");
  view.value=["focus","booth"].includes(chosenView)?chosenView:"auto";
  const applyView=()=>{
    root.dataset.layout=view.value;root.dataset.activeDeck=active;
    for(const node of deckNodes())node.classList.toggle("ddj-selected",node.dataset.deck===active);
  };
  applyView();
  view.onchange=()=>{
    chosenView=view.value;
    try {localStorage.setItem("larp:ddj-view",chosenView);} catch {}
    applyView();
  };
  root.querySelectorAll("[data-focus-deck],[data-jump-deck]").forEach(button=>button.onclick=()=>{
    active=button.dataset.focusDeck||button.dataset.jumpDeck;
    applyView();
    root.querySelector(`[data-deck="${active}"]`).scrollIntoView({block:"start"});
  });
  root.querySelector("[data-jump-mix]").onclick=()=>{
    const heading=root.querySelector(".ddj-mixer h2");
    heading.scrollIntoView({block:"center"});
    heading.focus({preventScroll:true});
  };
  mountHeadphones(root);
  controllers.mount(root);
  root.addEventListener("click",event=>{
    const button=event.target.closest("[data-ddj-action]");
    if(!button||button.disabled)return;
    if(button.dataset.ddjAction==="cue"&&event.detail>0)return;
    const target=button.closest("[data-deck]")?.dataset.deck||button.dataset.target||button.dataset.load;
    const deck=mixer.decks[target]||currentDeck();
    if(target&&!["prelisten","channel-fx"].includes(button.dataset.ddjAction)){active=target;applyView();}
    task(button,()=>dispatch(button,deck));
  });
  root.addEventListener("contextmenu",event=>{
    const pad=event.target.closest('[data-ddj-action="hot"]');
    if(!pad)return;
    event.preventDefault();
    const deck=mixer.decks[pad.closest("[data-deck]").dataset.deck];
    if(!deck.track)return;
    deck.cues[Number(pad.dataset.index)]=null;
    deck.metadata.cues[Number(pad.dataset.index)]=null;
    task(pad,()=>storeDeck(deck));
  });
  root.querySelector("[data-ddj-source]").onchange=event=>{source=event.target.value;libraryPage=0;paintSource();};
  $("#ddj-search").oninput=event=>{filter=event.target.value;libraryPage=0;paintSource();};
  root.querySelector("[data-ddj-prev]").onclick=()=>{libraryPage=Math.max(0,libraryPage-1);paintSource();};
  root.querySelector("[data-ddj-next]").onclick=()=>{libraryPage++;paintSource();};
  root.querySelectorAll("[data-ddj-sort]").forEach(button=>button.onclick=()=>{
    librarySort=button.dataset.ddjSort;libraryPage=0;paintSource();
  });
  if(session.user){
    const owner=session.user.id;
    api("dj-tracks").then(items=>{
      if(session.user?.id!==owner)return;
      for(const item of items)summaries.set(item.id,item);
      paintSource();
    }).catch(()=>{});
  }
  root.querySelector("[data-ddj-files]").onchange=event=>{addLocalFiles([...event.target.files]);event.target.value="";};
  root.querySelector("[data-ddj-xml]").onchange=event=>{
    const input=event.target,file=input.files[0];
    if(file)task(input,async()=>{try{await importXML(root,file);}finally{input.value="";}});
  };
  const sourcePanel=root.querySelector(".ddj-source");
  root.querySelector("[data-source-jump]").onclick=()=>{
    sourcePanel.scrollIntoView({block:"nearest"});
    sourcePanel.querySelector("h2").focus({preventScroll:true});
  };
  const tempo=root.querySelector("[data-sync-tempo]");
  tempo.onchange=()=>{if(tempo.value&&tempo.checkValidity())mixer.setSyncTempo(Number(tempo.value));};
  tempo.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();tempo.blur();}};
  root.querySelector("[data-clock-mode]").onchange=event=>mixer.setDynamicTempo(event.target.value==="dynamic");
  const tracks=root.querySelector("[data-ddj-table]");
  tracks.onclick=event=>{
    const row=event.target.closest("[data-select-track]");
    if(row){selected=row.dataset.selectTrack;paintSource();}
  };
  tracks.ondblclick=event=>{
    if(event.target.closest("[data-select-track]"))root.querySelector(`[data-load="${active}"]`).click();
  };
  sourcePanel.ondragover=event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();};
  sourcePanel.ondrop=event=>{event.preventDefault();addLocalFiles([...event.dataTransfer.files]);};
  root.querySelectorAll("[data-mix]").forEach(input=>{
    bindKnob(input);
    input.addEventListener("input",()=>{
      const channel=input.closest("[data-channel]")?.dataset.channel;
      const data=channel?mixer.config[channel]:mixer.config;
      data[input.dataset.mix]=input.type==="checkbox"?input.checked:input.type==="range"?Number(input.value):input.value;
      mixer.apply();
      paintKnob(input);
      if(input.dataset.mix==="spaceMode")paintSpaceControls(root);
      input.title=typeof data[input.dataset.mix]==="number"?String(data[input.dataset.mix]):input.title;
    });
    input.addEventListener("change",localConfig);
  });
  const spaceButtons=Array.from(root.querySelectorAll("[data-space-deck]"));
  const spacePanels=Array.from(root.querySelectorAll("[data-space-panel]"));
  for(const button of spaceButtons)button.onclick=()=>{
    const id=button.dataset.spaceDeck;
    for(const item of spaceButtons)item.setAttribute("aria-pressed",String(item===button));
    for(const panel of spacePanels)panel.hidden=panel.dataset.channel!==id;
    paintSpaceControls(root);
  };
  root.querySelector("[data-space-jump]").onclick=()=>{
    const space=root.querySelector(".ddj-space");
    space.scrollIntoView({block:"center"});
    space.querySelector("h3").focus({preventScroll:true});
  };
  for(const node of deckNodes())bindDeck(node,mixer.decks[node.dataset.deck]);
  redraw();
  paintCapture();
  drawFrame(root);
  updateTimer();
}

function syncHeadphoneStatus(root) {
  const label=root?.querySelector("[data-pfl-status]");
  if(label)label.textContent=mixer.cueSink
    ? (mixer.cueAudio ? "PFL dirigido a la salida elegida." : "PFL pendiente. Selecciona la salida de nuevo.")
    : "PFL comparte la salida principal.";
}

function mountHeadphones(root) {
  const picker=root.querySelector("[data-pfl-output]");
  const choose=root.querySelector("[data-pfl-choose]");
  const supported=typeof HTMLMediaElement.prototype.setSinkId==="function";
  picker.disabled=choose.disabled=!supported;
  async function outputs() {
    const devices=(await navigator.mediaDevices?.enumerateDevices().catch(()=>[])||[])
      .filter(device=>device.kind==="audiooutput" && device.deviceId&&!["default","communications"].includes(device.deviceId));
    if (!root.isConnected)return;
    picker.replaceChildren(new Option("Salida principal",""),...devices.map((device,index)=>
      new Option(device.label||"Salida "+(index+1),device.deviceId)));
    if (mixer.cueSink&&!devices.some(device=>device.deviceId===mixer.cueSink)) picker.add(new Option("Salida elegida",mixer.cueSink));
    picker.value=mixer.cueSink;
  }
  async function set(sink) {
    try {await mixer.setCueSink(sink);} finally {await outputs();syncHeadphoneStatus(root);}
  }
  picker.onchange=()=>task(picker,()=>set(picker.value));
  choose.onclick=()=>task(choose,async()=>{
    if (navigator.mediaDevices?.selectAudioOutput) {
      const device=await navigator.mediaDevices.selectAudioOutput();
      if (!["default","communications"].includes(device.deviceId)) await set(device.deviceId);
    } else {
      await outputs();
      picker.focus();
      if(picker.options.length<2)toast("El navegador aún no ofrece salidas de audio adicionales.");
    }
  });
  syncHeadphoneStatus(root);
  if(!supported) root.querySelector("[data-pfl-status]").textContent="Este navegador comparte PFL y máster en la misma salida.";
  if(supported)outputs();
}

function bindDeck(node,deck){
  node.addEventListener("pointerdown",()=>{active=deck.id;});
  const pitch=node.querySelector("[data-deck-pitch]");
  pitch.oninput=()=>{deck.manualPitch(Number(pitch.value));mixer.apply();};
  const seek=node.querySelector("[data-deck-seek]");
  seek.onchange=()=>task(null,()=>deck.seek(deck.quantize(Number(seek.value)/1000*deck.duration)));
  bindJog(node.querySelector("[data-jog]"),deck);
  const cue=node.querySelector('[data-ddj-action="cue"]');
  cue.onpointerdown=event=>{
    if(!deck.track||deck.loading)return;
    cue.setPointerCapture(event.pointerId);
    if(deck.playing){task(null,()=>deck.cuePress());return;}
    const stamp=Symbol();
    deck.cueToken=stamp;
    task(null,async()=>{
      await deck.cuePress();
      if(deck.cueToken!==stamp){deck.halt();deck.seek(deck.cue);return;}
      deck.cuePreview=true;
    });
  };
  const cueUp=()=>{deck.cueToken=null;deck.cueRelease();};
  cue.onpointerup=cue.onpointercancel=cue.onlostpointercapture=cueUp;
}

function bindJog(jog,deck){
  let motion;
  const angle=event=>{
    const rect=jog.getBoundingClientRect();
    return Math.atan2(event.clientY-rect.top-rect.height/2,event.clientX-rect.left-rect.width/2)*180/Math.PI;
  };
  jog.onpointerdown=event=>{
    if(!deck.track||deck.loading)return;
    jog.setPointerCapture(event.pointerId);
    const state={angle:angle(event),mode:deck.opts.jog,rate:deck.rate,ready:false};
    motion=state;
    task(null,async()=>{
      await mixer.ensure();
      if(motion!==state)return;
      if(state.mode==="vinyl")deck.beginScratch();
      state.ready=true;
    });
  };
  jog.onpointermove=event=>{
    if(!motion?.ready)return;
    const value=angle(event);
    const delta=((value-motion.angle+540)%360)-180;
    motion.angle=value;
    if(motion.mode==="vinyl")deck.scratchBy(delta);
    else if(deck.playing){deck.bend=1;deck.setRate(motion.rate*(1+limit(delta*.003*(11-deck.opts.jogAdjust)/6,-.12,.12,0)));}
    else deck.seek(deck.position()+delta*.006);
  };
  const stop=()=>{
    const state=motion;motion=null;
    if(!state?.ready)return;
    if(state.mode==="vinyl")task(null,()=>deck.endScratch());
    else{deck.bend=0;deck.setRate(state.rate);}
  };
  jog.onpointerup=jog.onpointercancel=jog.onlostpointercapture=stop;
  jog.onkeydown=event=>{
    if(!deck.track||!["ArrowLeft","ArrowRight"].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    task(null,()=>deck.seek(deck.position()+(event.key==="ArrowLeft"?-.035:.035)));
  };
}

function cueAction(deck,index){
  if(!deck.track||deck.loading)return;
  const cue=deck.cues[index];
  if(!cue){
    const marker={time:deck.quantize(deck.position()),color:CUE_COLORS[index],name:"",end:null};
    deck.metadata.cues[index]=marker;
    deck.cues[index]=marker;
    return storeDeck(deck);
  }
  if(cue.end>cue.time)return deck.setLoop(deck.quantize(cue.time),deck.quantize(cue.end)).then(()=>deck.start(cue.time));
  if(deck.loop.on){deck.loop.on=false;deck.slipClock=null;}
  return deck.start(deck.quantize(cue.time));
}

async function dispatch(button,deck){
  const name=button.dataset.ddjAction;
  const operations={
    settings:()=>showSettings(), load:()=>loadTrack(deck,available().find(track=>track.id===selected)),
    play:()=>deck.togglePlay(), cue:async()=>{await deck.cuePress();if(deck.playing){deck.halt();deck.seek(deck.cue);}},
    master:()=>mixer.setMaster(deck.id),
    sync:()=>deck.sync?deck.disableSync():deck.enableSync(),
    mt:()=>{deck.opts.masterTempo=!deck.opts.masterTempo;deck.updatePitch();localConfig();},
    slip:()=>{deck.opts.slip=!deck.opts.slip;if(!deck.opts.slip)deck.slipClock=null;localConfig();},
    vinyl:()=>{deck.opts.jog=deck.opts.jog==="vinyl"?"cdj":"vinyl";localConfig();},
    quantize:()=>{deck.opts.quantize=!deck.opts.quantize;localConfig();},
    "reset-pitch":()=>deck.manualPitch(0),"jump-back":()=>deck.bump(-1),"jump-next":()=>deck.bump(1),
    "beat-loop":()=>deck.beatLoop(Number(button.dataset.beats)), "loop-in":()=>{deck.loop.in=deck.quantize(deck.position());},
    "loop-out":()=>deck.setLoop(deck.loop.in??deck.quantize(deck.position()),deck.quantize(deck.position())),
    "loop-half":()=>resizeLoop(deck,.5),"loop-double":()=>resizeLoop(deck,2),
    reloop:()=>deck.loop.on?deck.exitLoop():deck.loop.out>deck.loop.in?deck.setLoop(deck.loop.in,deck.loop.out):deck.beatLoop(deck.selectedBeat),
    phrase:()=>deck.seek(Number(button.dataset.time)),
    reverse:()=>deck.toggleReverse(),brake:()=>deck.stunt("brake"),backspin:()=>deck.stunt("backspin"),
    "key-up":()=>deck.setKey(deck.shift+1),"key-down":()=>deck.setKey(deck.shift-1),"key-reset":()=>deck.setKey(0),
    "cue-save":()=>{deck.saveCue();return storeDeck(deck);},
    "hot-load":()=>{deck.cues=structuredClone(deck.metadata.cues);},
    "cue-edit":()=>showCueEditor(deck),
    grid:()=>showGridEditor(deck),hot:()=>cueAction(deck,Number(button.dataset.index)),
    analyze:()=>deck.analyze(),tag:()=>toggleTag(deck), eject:()=>{
      if(deck.opts.ejectLock&&deck.playing)throw new Error("Detén el deck antes de expulsar la fuente.");
      loadingChoices[deck.id]++;deck.reset();
    },
    "channel-fx":()=>{mixer.config[deck.id].fx=button.dataset.fx;localConfig();},
    prelisten:async()=>{
      await mixer.ensure();
      mixer.prelisten[deck.id]=!mixer.prelisten[deck.id];
      button.setAttribute("aria-pressed",String(mixer.prelisten[deck.id]));
      mixer.apply();
      syncHeadphoneStatus($("#ddj"));
      if (mixer.prelisten[deck.id]&&!mixer.cueSink) toast("PFL se escucha en la salida principal.");
    },
    "tempo-to-studio":async()=>{
      const master=mixer.decks[mixer.master];
      const bpm=mixer.syncClock.bpm||master.baseBpm()*master.rate;
      if(!bpm)throw new Error("El deck maestro necesita un beatgrid.");
      await studioHooks.setTempo(bpm);
      toast("BPM enviado al Estudio: "+bpm.toFixed(2));
    },
    record:()=>recordMix(), "save-mix":()=>saveMix(false), "studio-mix":()=>saveMix(true),
    "download-mix":()=>{if(lastMix)downloadFile(lastMix);}
  };
  await operations[name]?.();
  mixer.apply();
  if(!["settings","grid","cue-edit"].includes(name))redraw();
  updateTimer();
}
function resizeLoop(deck,factor){
  if(deck.loop.in==null||deck.loop.out==null)return deck.beatLoop(Math.min(32,Math.max(.25,deck.selectedBeat*factor)));
  const from=deck.loop.in, length=(deck.loop.out-from)*factor;
  return deck.setLoop(from,Math.min(deck.duration,deck.opts.quantize?deck.quantize(from+length):from+length));
}

async function toggleTag(deck){
  if(!deck.track)throw new Error("Carga una pista antes de marcarla.");
  const key=fileKey(deck.track);
  config.tags=config.tags.includes(key)?config.tags.filter(id=>id!==key):[...config.tags,key].slice(-120);
  await saveConfig();
}

async function importXML(root,file){
  if(file.size>5*1024*1024)throw new Error("Selecciona un XML de hasta 5 MiB.");
  const scope=accountEpoch;
  const imported=readRekordbox(await file.text(),available());
  if(scope!==accountEpoch)return;
  if(!imported.items.length)throw new Error("Añade primero los audios con sus nombres de archivo originales a la biblioteca.");
  const entries=[];
  for(const {track,data} of imported.items){
    const previous=await getTrackRecord(track);
    if(scope!==accountEpoch)return;
    const merged=trackData({grid:data.grid.length?data.grid:previous.grid,memory:data.memory??previous.memory,
      cues:data.cues.map((cue,index)=>cue??previous.cues?.[index]),phrases:data.phrases.length?data.phrases:previous.phrases,
      key:data.key||previous.key});
    entries.push({track,data:merged});
  }
  const permanent=entries.filter(item=>owns(item.track));
  for(let offset=0;offset<permanent.length;offset+=25){
    if(scope!==accountEpoch)return;
    const items=permanent.slice(offset,offset+25).map(({track,data})=>({id:track.id,settings:data}));
    await api("dj-tracks",{method:"PUT",data:{items}});
  }
  if(scope!==accountEpoch)return;
  for(const {track,data} of entries){
    if(owns(track))records.set(fileKey(track),data);
    else await saveTrackRecord(track,data);
    for(const deck of allDecks())if(deck.track?.id===track.id){
      deck.setMetadata(data);
      if(!deck.playing)deck.cueStart();
    }
  }
  if(root.isConnected)root.querySelector("[data-ddj-import-result]").textContent=
    "Importadas: "+entries.length+" · sin coincidencia única: "+imported.ignored;
  redraw();
}

function openDialog(html){
  const dialog=$("#ddj-dialog");
  dialog.innerHTML=html;
  dialog.querySelector("[data-close-ddj]").onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();
  return dialog;
}

function showSettings(scope="both",values=scope==="both"?config.defaults:config.decks[scope]){
  const dialog=openDialog(ddjSettingsBody(values,config.profiles,scope));
  const form=dialog.querySelector("form");
  let profileMix=null;
  form.elements.scope.onchange=event=>showSettings(event.target.value);
  form.elements.preset.onchange=event=>{
    const [kind,key]=event.target.value.split(":");
    const chosen=kind==="preset"?{settings:PRESETS[key]}:config.profiles[Number(key)];
    if(!chosen)return;
    for(const [name,value] of Object.entries(chosen.settings)){
      const field=form.elements[name];
      if(field.type==="checkbox")field.checked=value;else field.value=value;
    }
    profileMix=chosen.mix||null;
  };
  bindForm(form,async(fields)=>{
    const value=collectDDJSettings(form);
    const target=fields.get("scope");
    const next=snapshot();
    if(target==="both"){
      next.defaults=value;
      next.decks=Object.fromEntries(DECKS.map(id=>[id,{...value}]));
      if(profileMix)next.mix=profileMix;
    }else next.decks[target]=value;
    const name=fields.get("profileName").trim();
    if(name)next.profiles=[{name,settings:value,mix:next.mix},...next.profiles.filter(item=>item.name.toLowerCase()!==name.toLowerCase())].slice(0,12);
    useConfig(next);
    await saveConfig();
    redraw();dialog.close();toast("Ajustes de Larp DDJ guardados");
  });
  form.querySelector("[data-export-settings]").onclick=()=>downloadJSON("larp-ddj-my-settings.json",{format:"larp-ddj",version:1,settings:snapshot()});
  form.querySelector("[data-import-settings]").onchange=event=>{
    const input=event.target,file=input.files[0];
    if(file)task(input,async()=>{
      useConfig(await readSettingsFile(file));
      await saveConfig();redraw();dialog.close();toast("My Settings importado");
    },form.querySelector(".error"));
  };
}

function showCueEditor(deck){
  if(!deck.track)throw new Error("Carga una pista para editar sus pads.");
  const dialog=openDialog(`<header class="section-line"><div><h2>Hot Cues · ${deck.id}</h2><p class="muted">${esc(deck.track.name)}</p></div>
    <button class="g" data-close-ddj>Cerrar</button></header><form><div class="ddj-cue-edit">${deck.metadata.cues.map((cue,i)=>
    `<fieldset><legend>Pad ${String.fromCharCode(65+i)}</legend><label class="field">Tiempo en segundos<input name="time${i}" type="number" min="0" max="${deck.duration}" step=".001" value="${cue?.time??""}"></label>
      <label class="field">Nombre<input name="name${i}" maxlength="35" value="${esc(cue?.name||"")}"></label>
      <label class="field">Color<input name="color${i}" type="color" value="${cue?.color||CUE_COLORS[i]}"></label></fieldset>`).join("")}</div>
    <p class="muted">Deja vacío el tiempo para quitar un pad. Puedes ajustar el punto sin cambiar su color.</p>
    <div class="error" role="alert"></div><div><button class="b" type="submit">Guardar pads</button></div></form>`);
  const track=deck.track;
  bindForm(dialog.querySelector("form"),async data=>{
    if(deck.track!==track)throw new Error("La pista cambió. Abre otra vez el editor.");
    deck.metadata.cues=Array.from({length:8},(_,i)=>{
      const time=data.get("time"+i);
      return time===""?null:{time:Number(time),name:data.get("name"+i),color:data.get("color"+i),end:deck.metadata.cues[i]?.end};
    });
    await storeDeck(deck);
    dialog.close();toast("Pads guardados para esta pista");
  });
}

function showGridEditor(deck){
  if(!deck.track)throw new Error("Carga una pista antes de editar el beatgrid.");
  const first=deck.metadata.grid[0];
  const phases=deck.metadata.phrases.length?deck.metadata.phrases:deck.analysis?.phrases||[];
  const dialog=openDialog(`<header class="section-line"><div><h2>Beatgrid · ${deck.id}</h2><p class="muted">${esc(deck.track.name)}</p></div>
    <button class="g" data-close-ddj>Cerrar</button></header><form>
    <div class="ddj-settings-short"><label class="field">BPM de origen<input name="bpm" type="number" min="35" max="260" step=".01" value="${first?.bpm.toFixed(2)??""}" required></label>
      <label class="field">Primer pulso (s)<input name="origin" type="number" min="0" max="${deck.duration}" step=".001" value="${first?.time?.toFixed(3)??0}" required></label>
      <label class="field">Pulsos del compás<input name="meter" type="number" min="1" max="12" step="1" value="${first?.meter??4}" required></label></div>
    <div class="toolbar"><button class="g" type="button" data-tap>Tap BPM</button><button class="g" type="button" data-origin>Usar cabezal</button>
      <button class="g" type="button" data-grid-detect>Probar detección</button>
      <label class="toggle"><input name="replace" type="checkbox"> Sustituir todos los cambios de tempo</label></div>
    <output class="muted" data-grid-proposal></output>
    <label class="field">Memory Cue (s)<input name="memory" type="number" min="0" max="${deck.duration}" step=".001" value="${deck.metadata.memory??""}"></label>
    <label class="field">Frases (segundos, nombre)<textarea name="phrases" rows="5" maxlength="1800" placeholder="0, Intro\n16, Verso">${esc(phases.map(item=>item.time.toFixed(3)+", "+item.name).join("\n"))}</textarea></label>
    <p class="muted">La detección propone un nuevo beatgrid. Revisa el BPM y el primer pulso antes de guardarlo.</p>
    <div class="error" role="alert"></div><div><button class="b" type="submit">Guardar beatgrid</button></div>
    </form>`);
  const form=dialog.querySelector("form");
  const track=deck.track;
  let taps=[], detected=null;
  const proposal=form.querySelector("[data-grid-detect]");
  proposal.onclick=()=>task(proposal,async()=>{
    const result=await deck.analyze();
    if(deck.track!==track||!dialog.open)return;
    if(!result?.grid.length)throw new Error("La pista no tiene pulsos con suficiente claridad. Ajusta el beatgrid a mano.");
    detected=result.grid;
    form.elements.bpm.value=detected[0].bpm.toFixed(2);
    form.elements.origin.value=detected[0].time.toFixed(3);
    form.elements.meter.value=detected[0].meter;
    form.elements.replace.checked=false;
    form.querySelector("[data-grid-proposal]").textContent=`Propuesta de ${detected.length} ${detected.length===1?"tramo":"tramos"} lista para guardar`;
  },form.querySelector(".error"));
  form.querySelector("[data-origin]").onclick=()=>{form.elements.origin.value=deck.position().toFixed(3);};
  form.querySelector("[data-tap]").onclick=()=>{
    const now=performance.now();
    if(now-(taps.at(-1)||0)>2200)taps=[];
    taps.push(now);
    taps=taps.slice(-9);
    if(taps.length>1)form.elements.bpm.value=limit(60000*(taps.length-1)/(taps.at(-1)-taps[0]),35,260,120).toFixed(2);
  };
  bindForm(form,async data=>{
    if(deck.track!==track)throw new Error("La pista cambió. Abre otra vez el editor.");
    const origin=Number(data.get("origin"));
    const phrases=data.get("phrases").split("\n").filter(line=>line.trim()).map(line=>{
      const delim=line.indexOf(",");
      const time=Number(line.slice(0,delim));
      const name=line.slice(delim+1).trim();
      if(delim<1||!Number.isFinite(time)||time<0||time>deck.duration||!name)throw new Error("Escribe cada frase como segundos, nombre.");
      return {time,name};
    });
    const retained=data.get("replace")?[]:(detected??deck.metadata.grid).slice(1).filter(mark=>mark.time>origin);
    deck.metadata.grid=[{time:origin,bpm:Number(data.get("bpm")),meter:Number(data.get("meter")),beat:1},...retained];
    deck.metadata.firstBeat=origin;
    deck.metadata.memory=data.get("memory")===""?null:Number(data.get("memory"));
    deck.metadata.phrases=phrases;
    deck.cue=deck.bounded(deck.metadata.memory??origin);
    await storeDeck(deck);
    mixer.apply();dialog.close();toast("Beatgrid guardado");
  });
}

function paintCapture(){
  const root=$("#ddj");
  if(!root)return;
  root.querySelector('[data-ddj-action="record"]').textContent=mixRecorder?"Detener grabación":"Grabar mezcla";
  root.querySelector(".ddj-capture").hidden=!lastMix;
  root.querySelector("[data-capture-output]").innerHTML=lastMix?
    '<div class="toolbar"><button class="g" data-ddj-action="download-mix">Descargar WAV</button><button class="g" data-ddj-action="save-mix">Añadir a biblioteca</button><button class="g" data-ddj-action="studio-mix">Abrir como clip en Estudio</button></div>':"";
}

async function recordMix(){
  if(mixRecorder){
    if(mixRecorder.state==="recording")mixRecorder.stop();
    return;
  }
  await mixer.ensure();
  if(!window.MediaRecorder)throw new Error("El navegador no admite grabación de la mezcla.");
  const recorder=new MediaRecorder(mixer.record.stream);
  const context=mixer.context;
  const started=accountEpoch;
  const chunks=[];
  mixRecorder=recorder;
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  let limitTimer;
  recorder.onstop=async()=>{
    clearTimeout(limitTimer);
    try{
      const buffer=await context.decodeAudioData(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());
      if(started===accountEpoch)lastMix=encodeWav(buffer,"larp-ddj-"+Date.now()+".wav");
    }catch(error){if(started===accountEpoch)toast(error.message||"No se pudo procesar la grabación.");}
    finally{
      if(mixRecorder===recorder)mixRecorder=null;
      paintCapture();
    }
  };
  recorder.start(1000);
  limitTimer=setTimeout(()=>{if(recorder.state==="recording")recorder.stop();},120000);
  paintCapture();
}

async function saveMix(studio){
  if(!lastMix)return;
  const file=lastMix;
  const scope=accountEpoch;
  let track=session.tracks.find(item=>item.name===file.name);
  if(!track)track=await addLibraryFile(file);
  if(scope!==accountEpoch)return;
  if(studio)await studioHooks.addClip(track,file);
  toast(studio?"Mezcla añadida al Estudio":"Mezcla guardada en la biblioteca");
  paintSource();
}

window.addEventListener("keydown",event=>{
  if(session.page!=="ddj"||event.repeat||event.ctrlKey||event.metaKey||event.altKey||
    /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/u.test(event.target.tagName)||$("#ddj-dialog")?.open)return;
  const deck=currentDeck();
  if(event.code==="Space"){event.preventDefault();task(null,()=>deck.togglePlay());}
  if(/^[1-8]$/u.test(event.key))task(null,()=>cueAction(deck,Number(event.key)-1));
});

djHooks.preferences=accountPreferences;
djHooks.reset=resetDDJ;
djHooks.rateChange=()=>mixer.beforeRateChange();
djHooks.recording=()=>Boolean(mixRecorder);
djHooks.refresh=paintSource;
