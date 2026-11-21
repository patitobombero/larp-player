import { studioDraft } from "./studio-draft.js";
import { bindPiano, pianoMarkup } from "./piano.js";
import { downloadJSON, encodeWav } from "./wav.js";
import { applyAudio, chain, changeRate, ctx, engine, normalizeAudio, readyAudio, recorderInput, sound, studioInput } from "./audio.js";
import { api, bindForm, task } from "./client.js";
import { $, esc, limit, toast } from "./common.js";
import { editableControl, valueControl } from "./controls.js";
import { DRUMS, INSTRUMENT, INSTRUMENT_PRESETS, KEYS, MIX_CONTROLS, NOTES, PATCH_GROUPS, SOURCE_LIMIT, TRACK_COLORS, createChannel, disconnectChannel, friendly, hitDrum, legacyGrid, newArrangement, newLane, noiseBuffer, pattern, playClip, playStep, safeArrangement, synthNote, totalSteps, updateChannel } from "./instruments.js";
import { addLibraryFile } from "./library.js";
import { AUDIO_EXT, navigation, session, studioHooks } from "./state.js";

let arrangement = newArrangement();
let selectedTrack = arrangement.tracks.find(track=>track.kind==="synth")?.id||arrangement.tracks[0].id;
let studioPanel = "pattern";
let currentProject = "";
let recording = null;
let rendered = null;
let renderUrl = "";
let studioRun = null;
let studioWork = 0;
let liveChannels = new Map();
const heldNotes = new Map();
const decodedSounds = new Map();
const localSamples = new Map();

const undoStack=[];
const redoStack=[];
let lastCheckpoint;
let draftOwner;
let draftStatus="Guardado local preparado";
let draftTimer;
let draftLoad;
let completedWrite=Promise.resolve();
let restoringStudio=false;
let recordingNotes=false;
let midiAccess;
let midiInputs=[];
const scopeKey=()=>session.user?.id||"dispositivo";

function studioSnapshot() {
  return {data:JSON.stringify(arrangement),files:[...localSamples],selected:selectedTrack,project:currentProject};
}
function sameSnapshot(a,b) {
  return a?.data===b.data&&a.files.length===b.files.length&&a.files.every(([key,file],index)=>
    key===b.files[index][0]&&file===b.files[index][1]);
}
function updateHistoryUI() {
  if (!$("#studio-undo"))return;
  $("#studio").inert=restoringStudio;
  $("#studio-undo").disabled=!undoStack.length||restoringStudio;
  $("#studio-redo").disabled=!redoStack.length||restoringStudio;
  $("#studio-draft-status").textContent=draftStatus;
}
function persistStudioDraft() {
  if (draftOwner!==scopeKey()||restoringStudio||!lastCheckpoint) return completedWrite;
  clearTimeout(draftTimer);
  const key=draftOwner;
  const snapshot=studioSnapshot();
  completedWrite=completedWrite.then(()=>studioDraft(key,snapshot)).then(()=>{
    if(key===draftOwner){draftStatus="Borrador guardado en este dispositivo";updateHistoryUI();}
  },()=>{
    if(key===draftOwner){draftStatus="El navegador no pudo guardar el borrador local";updateHistoryUI();}
  });
  return completedWrite;
}
function checkpointStudio() {
  if (restoringStudio||draftOwner!==scopeKey()) return;
  const snapshot=studioSnapshot();
  if (sameSnapshot(lastCheckpoint,snapshot)) return;
  if(lastCheckpoint)undoStack.push(lastCheckpoint);
  if(undoStack.length>32)undoStack.shift();
  redoStack.length=0;
  lastCheckpoint=snapshot;
  draftStatus="Guardando borrador…";
  updateHistoryUI();
  clearTimeout(draftTimer);
  draftTimer=setTimeout(persistStudioDraft,200);
}
window.addEventListener("visibilitychange",()=>{if(document.hidden&&draftTimer)persistStudioDraft();});

async function applyStudioSnapshot(snapshot) {
  const scope=++studioWork;
  const owner=scopeKey();
  stopStudio();
  const next=safeArrangement({studio:JSON.parse(snapshot.data)});
  const files=new Map(snapshot.files);
  const decoded=new Map();
  let missing=0;
  for(const lane of next.tracks) {
    if (!lane.sample && !files.has(lane.id))continue;
    try {
      const previous=arrangement.tracks.find(track=>track.id===lane.id);
      const file=files.get(lane.id);
      const already=previous?.sample===lane.sample&&file===localSamples.get(lane.id)&&decodedSounds.get(lane.id);
      const audio=already||(file ? await engine().decodeAudioData(await file.arrayBuffer()) :
        (await loadSampleById(lane,lane.sample)).audio);
      decoded.set(lane.id,audio);
    } catch { missing++; }
    if(scope!==studioWork||owner!==scopeKey())return false;
  }
  if(scope!==studioWork||owner!==scopeKey())return false;
  arrangement=next;
  selectedTrack=next.tracks.some(track=>track.id===snapshot.selected)?snapshot.selected:next.tracks[0].id;
  currentProject=snapshot.project||"";
  decodedSounds.clear();localSamples.clear();
  for(const [key,file] of files)localSamples.set(key,file);
  for(const [key,audio] of decoded)decodedSounds.set(key,audio);
  lastCheckpoint=studioSnapshot();
  if(session.page==="syn-legacy")vSyn();
  if(missing)toast("Revisa las muestras que ya no están disponibles.");
  return true;
}

function initDraft() {
  const owner=scopeKey();
  if(draftOwner===owner)return draftLoad;
  draftOwner=owner;
  const start=lastCheckpoint=studioSnapshot();
  draftLoad=(async()=>{
    try {
      const saved=await studioDraft(owner);
      if(!saved||owner!==scopeKey()||lastCheckpoint!==start)return;
      restoringStudio=true;
      updateHistoryUI();
      if(await applyStudioSnapshot(saved))draftStatus="Borrador recuperado de este dispositivo";
    } catch {
      if(owner===scopeKey())draftStatus="Guardado local no disponible";
    } finally {
      if(owner===scopeKey()) {restoringStudio=false;updateHistoryUI();}
    }
  })();
  return draftLoad;
}

async function restoreHistory(direction) {
  if(restoringStudio||studioRecording())return;
  checkpointStudio();
  const from=direction==="undo"?undoStack:redoStack;
  const to=direction==="undo"?redoStack:undoStack;
  const snapshot=from.pop();
  if (!snapshot)return;
  const before=studioSnapshot();
  restoringStudio=true;
  updateHistoryUI();
  try {
    if(await applyStudioSnapshot(snapshot))to.push(before);
  } finally {
    restoringStudio=false;
    updateHistoryUI();
    persistStudioDraft();
  }
}

function noteAtPlayhead(key) {
  if(!recordingNotes||!studioRun||!ctx)return;
  const lane=activeLane();
  if(lane.kind==="clip"||!lane.grid[key])return;
  const now=ctx.currentTime;
  let nearest;
  for(const entry of studioRun.schedule) {
    if(!nearest||Math.abs(entry.time-now)<Math.abs(nearest.time-now))nearest=entry;
  }
  const step=(nearest?.step??0)%arrangement.steps;
  if(lane.grid[key][step])return;
  lane.grid[key][step]=1;
  $(`#studio-editor [data-note="${key}"][data-step="${step}"]`)?.setAttribute("aria-pressed","true");
  paintTracks();
  checkpointStudio();
}

function bindMidiInputs() {
  for(const input of midiInputs)input.removeEventListener("midimessage",onMidiMessage);
  midiInputs=[...midiAccess.inputs.values()];
  for(const input of midiInputs)input.addEventListener("midimessage",onMidiMessage);
  const button=$("#studio-midi");
  if(button)button.textContent=midiInputs.length?"MIDI · "+midiInputs.length+" entrada(s)":"MIDI · sin entradas";
}
function onMidiMessage(event) {
  if(session.page!=="syn-legacy")return;
  const [status,note,velocity]=event.data;
  const command=status&240;
  const key=note-60;
  if(key<0||key>=activeLane().grid.length)return;
  if(command===144&&velocity)previewNote(key);
  if(command===128||command===144&&!velocity)releaseKey(key);
}
async function connectMidi() {
  if(!navigator.requestMIDIAccess)throw new Error("Este navegador no ofrece Web MIDI.");
  midiAccess=await navigator.requestMIDIAccess({sysex:false});
  midiAccess.onstatechange=bindMidiInputs;
  bindMidiInputs();
}

function laneChannel(track) {
  let channel = liveChannels.get(track.id);
  if (!channel || channel.context !== ctx) {
    const reverb = ctx.createConvolver();
    reverb.buffer = noiseBuffer(ctx,1.65,true);
    channel = createChannel(ctx,studioInput,reverb);
    liveChannels.set(track.id,channel);
  }
  updateChannel(channel,track,arrangement);
  return channel;
}

async function startStudio() {
  if (studioRun) return stopStudio();
  await readyAudio();
  if (studioRun) return;
  const origin=ctx.currentTime+.04;
  const running = { step:0, next:origin, schedule:[], noise:noiseBuffer(ctx,.4) };
  studioRun = running;
  const tick = () => {
    if (studioRun !== running) return;
    const beat = 60/arrangement.bpm/4;
    if (running.next < ctx.currentTime-.12) running.next = ctx.currentTime+.02;
    while (running.next < ctx.currentTime+.105) {
      const step = running.step;
      const at = running.next+(step%2 ? arrangement.swing*beat : 0);
      running.schedule.push({step,time:at});
      if(running.schedule.length>12)running.schedule.shift();
      playStep(ctx,arrangement,step,running.next,laneChannel,running.noise,sound.settings.tuning,decodedSounds);
      setTimeout(() => { if (studioRun === running) markStudioStep(step); },Math.max(0,(at-ctx.currentTime)*1000));
      running.step = step+1;
      running.next += beat;
      if(running.step>=totalSteps(arrangement)){
        if(arrangement.songBars){
          running.complete=setTimeout(()=>{if(studioRun===running)stopStudio();},
            Math.max(0,(running.next-ctx.currentTime)*1000)+180);
          clearInterval(running.timer);
          return;
        }
        running.step=0;
      }
    }
  };
  running.timer = setInterval(tick,25);
  tick();
  paintStudioTransport();
}

function markStudioStep(step) {
  const root = $("#studio");
  if (!root) return;
  root.querySelectorAll(".step-current").forEach(el => el.classList.remove("step-current"));
  if (step < 0) {
    root.querySelectorAll(".timeline-clip-lane").forEach(lane=>lane.style.removeProperty("--clip-playhead"));
    return;
  }
  root.querySelectorAll(`[data-step="${step%arrangement.steps}"]`).forEach(el => el.classList.add("step-current"));
  root.querySelectorAll(".timeline-clip-lane").forEach(lane=>lane.style.setProperty("--clip-playhead",(step/totalSteps(arrangement)*100)+"%"));
  const summarized=Math.min(arrangement.steps-1,Math.floor(step/totalSteps(arrangement)*arrangement.steps));
  root.querySelectorAll(`[data-timeline-step="${summarized}"]`).forEach(el=>el.classList.add("step-current"));
  const position = $("#studio-position");
  if (position) position.textContent = (Math.floor(step/16)+1) + "." + (Math.floor(step%16/4)+1) + "." + (step%4+1);
}

function paintStudioTransport() {
  const button = $("#studio-play");
  if (button) {
    button.textContent = studioRun ? "■ Detener" : "▶ Reproducir";
    button.setAttribute("aria-pressed",String(Boolean(studioRun)));
  }
}

function stopStudio() {
  if (studioRun) {clearInterval(studioRun.timer);clearTimeout(studioRun.complete);}
  studioRun = null;
  for (const key of heldNotes.keys()) releaseKey(key);
  for (const channel of liveChannels.values()) disconnectChannel(channel);
  liveChannels.clear();
  markStudioStep(-1);
  if ($("#studio-position")) $("#studio-position").textContent = "1.1.1";
  paintStudioTransport();
}

function releaseKey(key) {
  const release = heldNotes.get(key);
  if (release && ctx) release(ctx.currentTime);
  heldNotes.delete(key);
  for(const item of document.querySelectorAll(`[data-key="${key}"],[data-piano-key="${key}"]`)) item.classList.remove("pressed");
}

async function previewNote(key) {
  if (heldNotes.has(key)) return;
  const track = arrangement.tracks.find(item => item.id === selectedTrack);
  if (!track) return;
  noteAtPlayhead(key);
  const marker = () => {};
  heldNotes.set(key,marker);
  try {
    await readyAudio();
    if (heldNotes.get(key)!==marker) return;
    const channel = laneChannel(track);
    if (track.kind === "drums") {
      hitDrum(ctx,key,ctx.currentTime,channel,noiseBuffer(ctx,.4));
      document.querySelector(`[data-piano-key="${key}"]`)?.classList.add("pressed");
      return;
    }
    const sample = decodedSounds.get(track.id);
    if(track.kind==="clip"){
      if(sample)playClip(ctx,channel,sample,ctx.currentTime,0,track.clips[0]);
      else toast("Carga el audio del clip.");
      document.querySelector('[data-piano-key="0"]')?.classList.add("pressed");
      return;
    }
    if (track.kind === "sample" && !sample) toast("Carga una muestra para tocar esta pista.");
    heldNotes.set(key,synthNote(ctx,track,channel,key,ctx.currentTime,0,sound.settings.tuning,sample));
    for(const item of document.querySelectorAll(`[data-key="${key}"],[data-piano-key="${key}"]`))item.classList.add("pressed");
  } catch (error) {
    heldNotes.delete(key);
    toast(error.message);
  }
}

window.addEventListener("keydown",event => {
  if(session.page==="syn-legacy"&&(event.ctrlKey||event.metaKey)&&!event.altKey&&
     !["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName)&&["z","y"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    task(null,()=>restoreHistory(event.shiftKey||event.key.toLowerCase()==="y"?"redo":"undo"));
    return;
  }
  if (session.page!=="syn-legacy" || restoringStudio || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
  const key = KEYS.indexOf(event.key.toLowerCase());
  const track = arrangement.tracks.find(item => item.id === selectedTrack);
  if (key >= 0 && track && key < track.grid.length) previewNote(key);
});
window.addEventListener("keyup",event => {
  const key = KEYS.indexOf(event.key.toLowerCase());
  if (key >= 0 && ctx) releaseKey(key);
});
window.addEventListener("blur",() => {
  if (ctx) for (const key of heldNotes.keys()) releaseKey(key);
});

function setRender(file) {
  if (renderUrl) URL.revokeObjectURL(renderUrl);
  rendered = file;
  renderUrl = file ? URL.createObjectURL(file) : "";
  if (session.page==="syn-legacy") paintStudioExport();
}

async function exportStudio(loops,bits,trackId) {
  const scope = studioWork;
  const data = structuredClone(arrangement);
  const sounds = new Map(decodedSounds);
  const chosen=data.tracks.find(track=>track.id===trackId);
  if (chosen) {
    data.tracks=[{...chosen,mute:false,solo:false}];
  }
  const hasSolo=data.tracks.some(track=>track.solo);
  if (data.tracks.some(track=> ["sample","clip"].includes(track.kind) && !track.mute && (!hasSolo||track.solo) && !sounds.get(track.id))) {
    throw new Error("Carga las muestras de las pistas activas antes de exportar.");
  }
  const duration = 60/data.bpm/4;
  const sampleRate = 48000;
  const effectTail = Math.max(3.25,...data.tracks.filter(track=>track.dly>0).map(track=>track.patch.dtm*8));
  const steps=totalSteps(data);
  const repeats=data.songBars?1:loops;
  const frames = Math.ceil((steps*duration*repeats+effectTail)*sampleRate);
  if(frames>15_000_000)throw new Error("La mezcla y la cola de efectos superan el límite WAV. Acorta la canción.");
  const offline = new OfflineAudioContext(2,frames,sampleRate);
  const limiter = offline.createDynamicsCompressor();
  limiter.threshold.value = sound.settings.ceiling;
  limiter.ratio.value = sound.settings.limiter&&!chosen ? 20 : 1;
  limiter.knee.value = 0;
  const tail = offline.createGain();
  tail.gain.setValueAtTime(1,frames/sampleRate-.34);
  tail.gain.linearRampToValueAtTime(0,frames/sampleRate);
  limiter.connect(tail).connect(offline.destination);
  const noise = noiseBuffer(offline,.4);
  const channels = new Map(data.tracks.map(track => {
    const reverb = offline.createConvolver();
    reverb.buffer = noiseBuffer(offline,1.65,true);
    const channel = createChannel(offline,limiter,reverb);
    updateChannel(channel,track,data);
    return [track.id,channel];
  }));
  for (let i=0;i<steps*repeats;i++) playStep(offline,data,i%steps,.04+i*duration,track=>channels.get(track.id),noise,sound.settings.tuning,sounds);
  const buffer = await offline.startRendering();
  if (scope === studioWork) {
    const label=chosen?chosen.name.replace(/[^a-z0-9_-]/giu,"_"):"mezcla";
    setRender(encodeWav(buffer,`larp-${label}-${bits}bit.wav`,bits));
  }
}

function studioRecording() { return Boolean(recording); }

async function toggleStudioRecording() {
  if (recording) {
    if (recording.state==="recording") recording.stop();
    return;
  }
  await readyAudio();
  if (!window.MediaRecorder) throw new Error("Este navegador no permite grabar en vivo. Puedes exportar la secuencia.");
  const scope = studioWork;
  const sourceContext = ctx;
  const record = recording = new MediaRecorder(recorderInput.stream);
  const chunks = [];
  let stopTimer;
  record.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  record.onstop = async () => {
    try {
      const buffer = await sourceContext.decodeAudioData(await new Blob(chunks).arrayBuffer());
      if (scope===studioWork) setRender(encodeWav(buffer));
    } catch {
      if (scope===studioWork) toast("No se pudo procesar la grabación en vivo.");
    } finally {
      clearTimeout(stopTimer);
      if (recording===record) recording = null;
      paintStudioExport();
    }
  };
  record.start(1000);
  stopTimer = setTimeout(() => { if (record.state==="recording") record.stop(); },120_000);
  paintStudioExport();
}

function resetStudio() {
  studioWork++;
  stopStudio();
  if (recording?.state === "recording") recording.stop();
  recording = null;
  setRender(null);
  decodedSounds.clear();
  localSamples.clear();
  arrangement = newArrangement();
  selectedTrack = arrangement.tracks.find(track=>track.kind==="synth")?.id||arrangement.tracks[0].id;
  currentProject = "";
  studioPanel = "pattern";
  draftOwner=undefined;
  draftLoad=undefined;
  lastCheckpoint=undefined;
  restoringStudio=false;
  recordingNotes=false;
  undoStack.length=redoStack.length=0;
  clearTimeout(draftTimer);
}

function vSyn() {
  $("#main").innerHTML = `<section class="page studio-page" id="studio">
  <div class="w-studio-switch"><button class="g" type="button" id="studio-new-editor">Volver al nuevo Estudio</button></div>
    <header class="page-heading studio-heading"><div><h1>Estudio</h1><p>Construye una idea por capas, ajusta la mezcla y llévala a tu biblioteca.</p></div>
      <div class="toolbar"><button class="g" id="studio-undo" disabled>Deshacer</button><button class="g" id="studio-redo" disabled>Rehacer</button>
        <button class="g" id="add-track">＋ Añadir instrumento</button>
        <button class="b" id="studio-play" aria-pressed="false">▶ Reproducir</button></div>
    </header>
    <div class="studio-draft-row">
      <span id="studio-draft-status" class="muted"></span>
      <div class="toolbar"><button class="g" id="studio-midi" type="button">Conectar MIDI</button>
        <button class="g" id="studio-note-record" type="button" aria-pressed="${recordingNotes}">Grabar notas</button></div>
    </div>
    <div class="transport card">
      <div class="transport-position"><small>Compás · tiempo · paso</small><strong id="studio-position">1.1.1</strong></div>
      <label>Tempo <span><input id="studio-bpm" type="number" min="40" max="240" value="${arrangement.bpm}"> BPM</span></label>
      <label>Swing <span><input id="studio-swing" type="number" min="0" max="70" value="${Math.round(arrangement.swing*100)}"> %</span></label>
      <label>Longitud <select id="studio-length"><option value="16">1 compás</option><option value="32" ${arrangement.steps===32?"selected":""}>2 compases</option></select></label>
      <label>Forma de canción <span><input id="studio-song-bars" type="number" min="0" max="512" value="${arrangement.songBars}"> comp.</span></label>
      <label>Máster <span><input id="studio-master" type="number" step=".5" min="-24" max="6" value="${arrangement.master}"> dB</span></label>
    </div>
    <details class="studio-guide"><summary>Primeros pasos</summary>
      <p>Para capturar notas, activa Grabar notas y reproduce el patrón. Toca el piano o conecta MIDI (Do central a Do dos octavas arriba). Las notas se guardan en pasos del patrón.</p>
      <p>Deja Forma de canción en 0 para repetir el patrón. Introduce compases para organizar clips en una canción de hasta cinco minutos.</p>
      <ol><li>Añade un instrumento y selecciónalo en Pistas.</li><li>Activa pasos en el Editor de notas. Usa el teclado para probar el sonido.</li><li>Equilibra niveles en el Mezclador y guarda o exporta la idea.</li></ol>
    </details>
    <section class="card timeline-card"><div class="section-line"><h2>Pistas</h2><span id="track-count"></span></div><div id="studio-tracks"></div></section>
    <nav class="subnav" aria-label="Herramientas del estudio">
      <button data-studio-panel="pattern">Editor de notas</button><button data-studio-panel="instrument">Instrumento</button>
      <button data-studio-panel="mixer">Mezclador</button><button data-studio-panel="export">Exportar</button>
    </nav>
    <section class="card studio-piano-card" id="piano-card"></section>
    <div id="studio-editor"></div>
    <div class="toolbar studio-transfer"><button class="g" id="studio-json">Exportar proyecto JSON</button>
      <label class="g ddj-file-action">Importar proyecto JSON<input class="sr-only" id="studio-import" type="file" accept=".json,application/json"></label></div>
    ${session.user ? '<details class="card" id="projects-card"><summary>Proyectos guardados</summary><div id="project-controls"></div></details>' : '<p class="muted studio-guest">Inicia sesión para guardar tus proyectos y abrirlos en otro dispositivo.</p>'}
    <dialog class="audio-dialog" id="instrument-dialog"></dialog>
  </section>`;
  paintStudioTransport();
  paintTracks();
  paintStudioPanel();
  const root=$("#studio");
  for (const type of ["click","change"]) root.addEventListener(type,checkpointStudio);
  $("#studio-new-editor").onclick=()=>navigation.go("syn");
  $("#studio-undo").onclick=()=>task(null,()=>restoreHistory("undo"));
  $("#studio-redo").onclick=()=>task(null,()=>restoreHistory("redo"));
  $("#studio-note-record").onclick=event=>{
    recordingNotes=!recordingNotes;
    event.currentTarget.setAttribute("aria-pressed",String(recordingNotes));
  };
  $("#studio-midi").onclick=event=>task(event.currentTarget,connectMidi);
  if(midiAccess)bindMidiInputs();
  updateHistoryUI();
  initDraft();
  $("#add-track").onclick = openInstrumentDialog;
  $("#studio-play").onclick = event => task(event.currentTarget,startStudio);
  $("#studio-bpm").onchange = event => {
    arrangement.bpm = limit(Number(event.target.value),40,240,120);
    event.target.value = arrangement.bpm;
  };
  $("#studio-swing").onchange = event => {
    arrangement.swing = limit(Number(event.target.value),0,70,0)/100;
    event.target.value = Math.round(arrangement.swing*100);
  };
  $("#studio-length").onchange = event => {
    if (studioRun) stopStudio();
    arrangement.steps = Number(event.target.value);
    paintTracks();
    paintStudioPanel();
  };
  $("#studio-song-bars").onchange=event=>{
    stopStudio();
    arrangement.songBars=Math.round(limit(Number(event.target.value),0,512,0));
    event.target.value=arrangement.songBars;
    paintTracks();paintStudioPanel();
  };
  $("#studio-json").onclick=()=>downloadJSON("larp-project.json",{format:"larp-studio",version:2,
    state:{studio:arrangement,audio:sound.settings}});
  $("#studio-import").onchange=event=>{
    const input=event.target,file=input.files[0];
    if(file)task(input,async()=>{try{await importStudioFile(file);}finally{input.value="";}});
  };
  $("#studio-master").onchange = event => {
    arrangement.master = limit(Number(event.target.value),-24,6,-4);
    event.target.value = arrangement.master;
    refreshMix();
  };
  $("#studio").querySelector(".subnav").onclick = event => {
    const target = event.target.closest("[data-studio-panel]");
    if (target) {
      studioPanel = target.dataset.studioPanel;
      paintStudioPanel();
    }
  };
  if ($("#projects-card")) {
    $("#projects-card").ontoggle = event => {
      if (event.currentTarget.open) mountStudioProjects($("#project-controls"));
    };
  }
}

function activeLane() {
  return arrangement.tracks.find(item => item.id === selectedTrack) || arrangement.tracks[0];
}

function paintTracks() {
  const target = $("#studio-tracks");
  if (!target) return;
  $("#track-count").textContent = arrangement.tracks.length + " / 8";
  $("#add-track").disabled = arrangement.tracks.length>=8;
  target.style.setProperty("--steps",String(arrangement.steps));
  target.innerHTML = `<div class="timeline"><div class="timeline-lane timeline-ruler"><span>Instrumento</span>
    <div class="timeline-steps">${Array.from({length:arrangement.steps},(_,i)=>`<span class="${i%4===0?"beat":""}">${i%4===0 ? Math.floor(i/4)+1 : ""}</span>`).join("")}</div>
    <span class="lane-controls-title">Mezcla</span></div>
    ${arrangement.tracks.map((lane,i) => `<div class="timeline-lane ${selectedTrack===lane.id?"selected":""}" style="--lane:${TRACK_COLORS[i]}">
      <button class="track-title" data-lane="${lane.id}" aria-pressed="${selectedTrack===lane.id}"><i></i><span><b>${esc(lane.name)}</b>
        <small>${lane.kind === "drums" ? "Percusión" : lane.kind === "sample" ? "Sampler" : lane.kind==="clip" ? "Clip de audio" : esc(lane.preset)}</small></span></button>
      ${lane.kind==="clip"?clipLane(lane):`<button class="timeline-steps clip-strip" data-lane="${lane.id}" aria-label="Editar notas de ${esc(lane.name)}">
        ${Array.from({length:arrangement.steps},(_,step)=>`<span data-timeline-step="${step}" class="${step%4===0?"beat ":""}${timelineHasNote(lane,step)?"has-note":""}"></span>`).join("")}
      </button>`}
      <div class="lane-quick"><button class="g" data-mute="${lane.id}" aria-label="Silenciar ${esc(lane.name)}" aria-pressed="${lane.mute}">M</button>
        <button class="g" data-solo="${lane.id}" aria-label="Solo ${esc(lane.name)}" aria-pressed="${lane.solo}">S</button></div>
    </div>`).join("")}</div>`;
  bindTimelineClips(target);
  target.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.lane) {
      selectedTrack = button.dataset.lane;
      paintTracks();
      paintStudioPanel();
      return;
    }
    const lane = arrangement.tracks.find(item => item.id === (button.dataset.mute || button.dataset.solo));
    if (!lane) return;
    const key = button.dataset.mute ? "mute" : "solo";
    lane[key] = !lane[key];
    refreshMix();
    paintTracks();
    if (studioPanel === "mixer") paintStudioPanel();
  };
}

function openInstrumentDialog() {
  const dialog = $("#instrument-dialog");
  const entries = [["clip","Osciladores","Clip de audio","Coloca y recorta audio en la línea de tiempo."],["drums","Osciladores","Batería","Seis voces de percusión electrónica."],
    ["sample","Osciladores","Sampler","Toca una muestra propia a distintas notas."],
    ...Object.entries(INSTRUMENT_PRESETS).map(([preset,data])=>["synth",preset,preset,data.description])];
  dialog.innerHTML = `<form method="dialog" class="section-line"><h2>Añadir instrumento</h2><button class="g">Cerrar</button></form>
    <div class="instrument-choices">${entries.map((entry,index)=>`<button class="g" data-instrument="${index}"><b>${esc(entry[2])}</b><span>${esc(entry[3])}</span></button>`).join("")}</div>`;
  dialog.querySelector(".instrument-choices").onclick = event => {
    const button = event.target.closest("[data-instrument]");
    if (!button || arrangement.tracks.length>=8) return;
    const [kind,preset,name] = entries[Number(button.dataset.instrument)];
    const track = newLane(kind,preset,name);
    if (kind === "synth") {
      track.dly = INSTRUMENT_PRESETS[preset].patch.dly || 0;
      track.rev = INSTRUMENT_PRESETS[preset].patch.rev || 0;
    }
    arrangement.tracks.push(track);
    selectedTrack = track.id;
    dialog.close();
    studioPanel = ["sample","clip"].includes(kind) ? "instrument" : "pattern";
    paintTracks();
    paintStudioPanel();
  };
  dialog.showModal();
}

function paintStudioPanel() {
  paintManualPiano();
  const controls = $("#studio")?.querySelectorAll("[data-studio-panel]") || [];
  for (const control of controls) control.setAttribute("aria-pressed",String(control.dataset.studioPanel===studioPanel));
  if (studioPanel==="pattern") paintPattern();
  else if (studioPanel==="instrument") paintInstrument();
  else if (studioPanel==="mixer") paintMixer();
  else paintStudioExport();
}

function paintPattern() {
  const lane = activeLane();
  if(lane.kind==="clip")return paintClipEditor(lane);
  const names = lane.kind === "drums" ? DRUMS : NOTES;
  const editor = $("#studio-editor");
  editor.innerHTML = `<section class="card">
    <div class="section-line"><div><h2>${esc(lane.name)}</h2><p class="muted">Activa casillas para colocar notas en pasos de semicorchea.</p></div>
      <div class="toolbar"><button class="g" id="studio-duplicate">Duplicar pista</button><button class="g" id="studio-clear">Limpiar patrón</button></div>
    </div>
    <div class="pattern-scroll">
      <div class="pattern-grid" style="--steps:${arrangement.steps}">
        <span class="pattern-label">Paso</span>${Array.from({length:arrangement.steps},(_,i)=>`<span class="step-index ${i%4===0?"beat":""}">${i+1}</span>`).join("")}
        ${[...names].reverse().map((name,ordinal)=> {
          const key = names.length - ordinal - 1;
          const label=lane.kind==="drums"?name:name+Math.floor(key/12+4+lane.octave);
          return `<button class="pattern-label note-key" data-key="${key}" type="button">${esc(label)} ${KEYS[key]?`<small>${KEYS[key].toUpperCase()}</small>`:""}</button>
            ${lane.grid[key].slice(0,arrangement.steps).map((value,i)=>`<button class="step ${i%4===0?"beat":""}" data-note="${key}" data-step="${i}" aria-label="${esc(label)}, paso ${i+1}" aria-pressed="${Boolean(value)}"></button>`).join("")}`;
        }).join("")}
      </div>
    </div>
    <p class="muted studio-key-help">Haz clic en el nombre de una nota para escucharla. También puedes tocar con las teclas indicadas.</p>
  </section>`;
  const grid = editor.querySelector(".pattern-grid");
  grid.onclick = event => {
    const button = event.target.closest("[data-note]");
    if (!button) return;
    const note = Number(button.dataset.note);
    const step = Number(button.dataset.step);
    lane.grid[note][step] ^= 1;
    button.setAttribute("aria-pressed",String(Boolean(lane.grid[note][step])));
    paintTracks();
  };
  grid.querySelectorAll("[data-key]").forEach(button => {
    const note = Number(button.dataset.key);
    button.onpointerdown = event => {
      button.setPointerCapture(event.pointerId);
      previewNote(note);
    };
    button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => releaseKey(note);
    button.onclick = event => {
      if (event.detail===0) {
        previewNote(note);
        setTimeout(() => releaseKey(note),210);
      }
    };
  });
  $("#studio-duplicate").disabled = arrangement.tracks.length>=8;
  $("#studio-duplicate").onclick = () => {
    const copy = {...structuredClone(lane),id:crypto.randomUUID(),name:(lane.name.slice(0,30)+" copia"),solo:false};
    if (decodedSounds.has(lane.id)) decodedSounds.set(copy.id,decodedSounds.get(lane.id));
    if (localSamples.has(lane.id)) localSamples.set(copy.id,localSamples.get(lane.id));
    arrangement.tracks.push(copy);
    selectedTrack = copy.id;
    paintTracks();
    paintPattern();
  };
  $("#studio-clear").onclick = () => {
    lane.grid = pattern(names.length);
    paintTracks();
    paintPattern();
  };
}

function patchSelect(field,value) {
  const [key,label,options] = field;
  return `<label class="field"><span>${esc(label)}</span><select data-patch="${key}">
    ${options.map(option=>`<option value="${option}" ${value===option?"selected":""}>${esc(friendly[option]||option)}</option>`).join("")}
  </select></label>`;
}

async function loadSampleFromFile(lane,file) {
  if (!file || !file.size || file.size>SOURCE_LIMIT) throw new Error("Selecciona una muestra de hasta 32 MiB para tocarla.");
  const owner = session.user?.id;
  const scope = studioWork;
  const context = engine();
  const decoded = await context.decodeAudioData(await file.arrayBuffer()).catch(() => {
    throw new Error("El navegador no puede decodificar esta muestra.");
  });
  if (scope !== studioWork || !arrangement.tracks.includes(lane)) return;
  if (owner && session.user?.id===owner) {
    const saved = await addLibraryFile(file);
    if (scope!==studioWork || !arrangement.tracks.includes(lane)) return;
    lane.sample = saved.id;
    localSamples.delete(lane.id);
  } else {
    localSamples.set(lane.id,file);
    lane.sample = "";
  }
  decodedSounds.set(lane.id,decoded);
  lane.sampleName = file.name;
  if(lane.kind==="clip")mountClipIfEmpty(lane,decoded);
  else lane.kind = "sample";
  if (session.page==="syn-legacy") {
    paintTracks();
    paintStudioPanel();
  }
  checkpointStudio();
  toast("Muestra lista para tocar");
}

async function loadSampleById(lane,id) {
  const owner=session.user?.id;
  let item=session.savedTracks.find(file=>file.id===id);
  if(!item&&owner&&session.libraryLoadedOwner!==owner) item=(await api("library")).find(file=>file.id===id);
  if(owner!==session.user?.id) throw new DOMException("Cuenta cambiada","AbortError");
  if (!item || item.size>SOURCE_LIMIT) throw new Error("Usa una muestra guardada de hasta 32 MiB.");
  const res = await api("media/" + id,{raw:true});
  const audio = await engine().decodeAudioData(await res.arrayBuffer()).catch(() => {
    throw new Error("El navegador no puede decodificar esta muestra.");
  });
  return {audio,name:item.name};
}

function paintInstrument() {
  const lane = activeLane();
  const preset = INSTRUMENT_PRESETS[lane.preset];
  const editor = $("#studio-editor");
  editor.innerHTML = `<section class="card">
    <div class="section-line"><div><h2>Instrumento</h2><p class="muted">${lane.kind==="drums"?"Batería electrónica de seis voces.":esc(preset.description)}</p></div>
      <button class="g" id="remove-lane" ${arrangement.tracks.length===1?"disabled":""}>Quitar pista</button>
    </div>
    <div class="instrument-fields">
      <label class="field">Nombre<input id="lane-name" maxlength="36" value="${esc(lane.name)}"></label>
      <label class="field">Fuente<select id="lane-kind"><option value="synth" ${lane.kind==="synth"?"selected":""}>Osciladores</option>
        <option value="sample" ${lane.kind==="sample"?"selected":""}>Sampler</option><option value="clip" ${lane.kind==="clip"?"selected":""}>Clip de audio</option><option value="drums" ${lane.kind==="drums"?"selected":""}>Batería</option></select></label>
      ${lane.kind==="synth"||lane.kind==="sample"?`<label class="field">Preset<select id="lane-preset">${Object.keys(INSTRUMENT_PRESETS).map(name=>`<option ${lane.preset===name?"selected":""}>${esc(name)}</option>`).join("")}</select></label>
      <label class="field">Octava<input id="lane-octave" type="number" min="-2" max="2" value="${lane.octave}"></label>`:""}
    </div>
    ${["sample","clip"].includes(lane.kind)?`<div class="sample-box">
      <div><strong>${esc(lane.sampleName || "Sin muestra")}</strong>
        <p class="muted">Se admite audio de hasta 32 MiB. ${lane.kind==="clip"?"Coloca y recorta el clip en el editor.":"El piano cambia su tono desde la nota original."}</p></div>
      <label class="field">Cargar muestra<input id="studio-sample" type="file" accept="${AUDIO_EXT}"></label>
      ${session.user?`<label class="field">Usar desde la biblioteca<select id="sample-library"><option value="">Elegir pista</option>${session.savedTracks.filter(file=>file.size<=SOURCE_LIMIT).map(file=>`<option value="${file.id}" ${file.id===lane.sample?"selected":""}>${esc(file.name)}</option>`).join("")}</select></label>`:""}
      <canvas id="studio-wave" width="630" height="90" aria-label="Forma de onda de la muestra"></canvas>
      ${lane.kind==="sample"?`<label class="toggle"><input id="sample-loop" type="checkbox" ${lane.patch.loop?"checked":""}> Repetir muestra al sostener la nota</label>
      ${valueControl(["root","Nota original desde Do",-12,12,1," st"],lane.patch.root,"data-patch")}`:""}
    </div>`:""}
    ${lane.kind==="synth"||lane.kind==="sample"?`<div class="patch-grid">${PATCH_GROUPS.map(([name,fields])=>`<fieldset><legend>${esc(name)}</legend>
      ${fields.map(field=>Array.isArray(field[2])?patchSelect(field,lane.patch[field[0]]):valueControl(field,lane.patch[field[0]],"data-patch")).join("")}</fieldset>`).join("")}</div>`:""}
  </section>`;
  $("#lane-name").onchange = event => {
    lane.name = event.target.value.trim().slice(0,36) || "Pista";
    event.target.value = lane.name;
    paintTracks();
  };
  $("#lane-kind").onchange = event => {
    lane.kind = event.target.value;
    lane.grid = legacyGrid(lane.grid,pattern(lane.kind==="drums"?DRUMS.length:lane.kind==="clip"?1:NOTES.length));
    if(lane.kind==="clip"&&decodedSounds.has(lane.id))mountClipIfEmpty(lane,decodedSounds.get(lane.id));
    paintTracks();
    paintStudioPanel();
  };
  $("#remove-lane").onclick = () => {
    if (arrangement.tracks.length<2 || !confirm("¿Quitar esta pista y su patrón?")) return;
    const channel = liveChannels.get(lane.id);
    if (channel) disconnectChannel(channel);
    liveChannels.delete(lane.id); decodedSounds.delete(lane.id); localSamples.delete(lane.id);
    arrangement.tracks = arrangement.tracks.filter(track => track !== lane);
    selectedTrack = arrangement.tracks[0].id;
    refreshMix();
    paintTracks();
    paintInstrument();
  };
  if ($("#lane-preset")) {
    $("#lane-preset").onchange = event => {
      lane.preset = event.target.value;
      const preset = INSTRUMENT_PRESETS[lane.preset];
      lane.patch = {...INSTRUMENT,...preset.patch};
      lane.dly = preset.patch.dly || 0;
      lane.rev = preset.patch.rev || 0;
      refreshMix(); paintTracks(); paintInstrument();
    };
    $("#lane-octave").onchange = event => {
      lane.octave = limit(Number(event.target.value),-2,2,0);
      event.target.value = lane.octave;
    };
  }
  if ($("#studio-sample")) {
    $("#studio-sample").onchange = event => {
      const file = event.target.files[0];
      if (file) task(event.target,() => loadSampleFromFile(lane,file));
    };
    if($("#sample-loop"))$("#sample-loop").onchange = event => {lane.patch.loop=event.target.checked;};
    if(decodedSounds.has(lane.id))drawStudioWave($("#studio-wave"), decodedSounds.get(lane.id));
  }
  if ($("#sample-library")) $("#sample-library").onchange = event => {
    const id = event.target.value;
    if (!id) return;
    task(event.target,async () => {
      const {audio,name} = await loadSampleById(lane,id);
      if (!arrangement.tracks.includes(lane)) return;
      decodedSounds.set(lane.id,audio); localSamples.delete(lane.id);
      lane.sample = id; lane.sampleName = name;
      if(lane.kind==="clip")mountClipIfEmpty(lane,audio);
      if (session.page==="syn-legacy") {
        paintTracks();
        if(activeLane()===lane&&studioPanel==="instrument")paintInstrument();
      }
      checkpointStudio();
    });
  };
  editor.querySelectorAll("select[data-patch]").forEach(select => {
    select.onchange = () => { lane.patch[select.dataset.patch] = select.value; };
  });
  editableControl(editor.firstElementChild,"data-patch",(key,value) => { lane.patch[key] = value; refreshMix(); });
}

function refreshMix() {
  for (const track of arrangement.tracks) if (liveChannels.has(track.id)) laneChannel(track);
}

function paintMixer() {
  const editor = $("#studio-editor");
  editor.innerHTML = `<section class="card"><div class="section-line"><div><h2>Mezclador</h2>
    <p class="muted">Ajusta niveles, estéreo y efectos de cada pista. Los niveles también se aplican al exportar.</p></div>
    <div class="mix-readout"><small>Pico de mezcla</small><strong id="mix-peak">−∞ dBFS</strong></div></div>
    <div class="mixer-grid">${arrangement.tracks.map((track,i)=>`<fieldset style="--lane:${TRACK_COLORS[i]}"><legend>${esc(track.name)}</legend>
      ${MIX_CONTROLS.map(field=>valueControl(field,track[field[0]],"data-mix",track.id)).join("")}
      <div class="toolbar"><label class="toggle"><input type="checkbox" data-mix-mute="${track.id}" ${track.mute?"checked":""}> Silencio</label>
        <label class="toggle"><input type="checkbox" data-mix-solo="${track.id}" ${track.solo?"checked":""}> Solo</label></div>
    </fieldset>`).join("")}</div></section>`;
  watchMixPeak(editor.querySelector("#mix-peak"));
  editableControl(editor.firstElementChild,"data-mix",(target,value) => {
    const [id,field] = target.split("/");
    const lane = arrangement.tracks.find(track=>track.id===id);
    lane[field] = value; refreshMix();
  });
  editor.querySelectorAll("[data-mix-mute],[data-mix-solo]").forEach(element => {
    element.onchange = () => {
      const property=element.dataset.mixMute ? "mute" : "solo";
      const track = arrangement.tracks.find(item=>item.id===(element.dataset.mixMute||element.dataset.mixSolo));
      track[property]=element.checked;
      refreshMix(); paintTracks();
    };
  });
}

function watchMixPeak(readout) {
  const values = new Float32Array(1024);
  let last = 0;
  function tick(time) {
    if (!readout.isConnected) return;
    if (chain?.mixMeter && time-last>100) {
      last=time;
      chain.mixMeter.getFloatTimeDomainData(values);
      let peak=0;
      for (const value of values) peak=Math.max(peak,Math.abs(value));
      readout.textContent = peak>0.000032 ? (20*Math.log10(peak)).toFixed(1)+" dBFS" : "−∞ dBFS";
      readout.classList.toggle("clip",peak>=1);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function paintStudioExport() {
  if (studioPanel!=="export" || !$("#studio-editor")) return;
  const editor = $("#studio-editor");
  editor.innerHTML = `<section class="card export-card"><div class="section-line"><div><h2>Exportar mezcla</h2>
    <p class="muted">Genera la mezcla o una pista por separado en WAV estéreo a 48 kHz. La captura en vivo conserva su formato habitual.</p></div></div>
    <div class="toolbar"><label>Repeticiones <select id="render-loops"><option>1</option><option>2</option><option>4</option></select></label>
      <label>Resolución <select id="render-bits"><option value="16">16 bits</option><option value="24">24 bits</option></select></label>
      <label>Salida <select id="render-track"><option value="">Mezcla completa</option>${arrangement.tracks.map(track=>
        `<option value="${track.id}">${esc(track.name)}</option>`).join("")}</select></label>
      <button class="b" id="render-wav">Generar WAV</button>
      <button class="g" id="live-record">${recording ? "■ Detener grabación" : "● Grabar en vivo"}</button></div>
    ${rendered?`<div class="render-output"><audio controls preload="metadata" src="${renderUrl}"></audio>
      <a class="button-link" href="${renderUrl}" download="${esc(rendered.name)}">Descargar WAV</a>
      <button class="g" id="keep-mix">Añadir a biblioteca</button></div>`:""}
    </section>`;
  $("#render-wav").onclick = event => task(event.currentTarget,() => exportStudio(Number($("#render-loops").value),Number($("#render-bits").value),$("#render-track").value));
  $("#live-record").onclick = event => task(event.currentTarget,toggleStudioRecording);
  if ($("#keep-mix")) $("#keep-mix").onclick = event => task(event.currentTarget,async () => {
    await addLibraryFile(rendered);
    toast("Mezcla añadida a la biblioteca");
  });
}

function legacyAudio(state) {
  if (state.audio) return normalizeAudio(state.audio);
  if (!state.eq && !state.comp && !state.tune) return sound.settings;
  return normalizeAudio({...sound.settings,tuning:state.tune,bands:Array.isArray(state.eq) ? state.eq.map(row=>({
    type:row?.[0],frequency:row?.[1],gain:row?.[2],q:row?.[3]
  })) : sound.settings.bands,pre:state.comp?.pre,compressor:state.comp?.on,threshold:state.comp?.th,ratio:state.comp?.ra});
}

async function openProject(project) {
  await initDraft();
  stopStudio();
  const scope = ++studioWork;
  const next = safeArrangement(project.state);
  const missing = [];
  const samples = new Map();
  for (const track of next.tracks.filter(track => track.sample)) {
    try {
      const {audio,name} = await loadSampleById(track,track.sample);
      samples.set(track.id,audio);
      track.sampleName = name;
    } catch { missing.push(track.name); }
  }
  if (scope!==studioWork) return;
  localSamples.clear();
  decodedSounds.clear();
  for (const [key,sample] of samples) decodedSounds.set(key,sample);
  const settings = legacyAudio(project.state);
  const rate = sound.settings.rate;
  sound.settings = {...settings,rate};
  applyAudio();
  if (settings.rate!==rate) await changeRate(settings.rate);
  if(scope!==studioWork)return;
  arrangement = next;
  selectedTrack = next.tracks.find(track=>track.kind==="synth")?.id||next.tracks[0].id;
  currentProject = project.id;
  studioPanel = "pattern";
  undoStack.length=redoStack.length=0;
  lastCheckpoint=studioSnapshot();
  persistStudioDraft();
  if (session.page==="syn-legacy") vSyn();
  toast(missing.length ? "Proyecto abierto. Revisa las muestras de " + missing.join(", ") : "Proyecto abierto");
}

async function mountStudioProjects(root) {
  if (root.dataset.ready) return;
  root.dataset.ready = "true";
  const owner = session.user.id;
  root.innerHTML = '<p class="muted">Cargando proyectos…</p>';
  await task(null, async () => {
    const projects = await api("projects");
    if (!root.isConnected || session.user?.id!==owner) return;
    root.innerHTML = `<form class="project-form">
      <label class="field">Proyecto<select name="project"><option value="">Nuevo proyecto</option>${projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field">Nombre<input name="name" maxlength="60" required></label><div class="error" role="alert"></div>
      <div class="toolbar"><button class="b" type="submit">Guardar proyecto</button><button class="g" type="button" id="open-project">Abrir</button>
        <button class="g" type="button" id="delete-project">Borrar</button></div></form>`;
    const form = root.querySelector("form");
    const select = form.elements.project;
    const name = form.elements.name;
    select.value = currentProject;
    const selectProject = () => {
      const project = projects.find(item=>item.id===select.value);
      name.value = project?.name || "";
      $("#open-project").disabled = !project;
      $("#delete-project").disabled = !project;
    };
    select.onchange = selectProject;
    selectProject();
    $("#open-project").onclick = event => task(event.currentTarget,() => openProject(projects.find(p=>p.id===select.value)));
    $("#delete-project").onclick = event => {
      if (!confirm("¿Borrar este proyecto guardado?")) return;
      task(event.currentTarget,async () => {
        await api("projects/" + select.value,{method:"DELETE"});
        if (currentProject===select.value) currentProject="";
        if (root.isConnected) { root.dataset.ready = ""; mountStudioProjects(root); }
      });
    };
    bindForm(form,async fields => {
      const scope = studioWork;
      const copy = structuredClone(arrangement);
      for (const lane of copy.tracks) {
        const local = localSamples.get(lane.id);
        if (!local) continue;
        const sample = await addLibraryFile(local);
        if (scope!==studioWork || session.user?.id!==owner) return;
        lane.sample = sample.id;
        const current = arrangement.tracks.find(track=>track.id===lane.id);
        if (current && localSamples.get(lane.id)===local) {
          current.sample = sample.id;
          localSamples.delete(lane.id);
        }
      }
      const chosen = fields.get("project");
      const result = await api(chosen ? "projects/" + chosen : "projects",{method:chosen ? "PUT" : "POST",
        data:{name:fields.get("name"),state:{studio:copy,audio:sound.settings}}});
      if (scope!==studioWork || session.user?.id!==owner) return;
      currentProject = result.id;
      lastCheckpoint=studioSnapshot();
      persistStudioDraft();
      toast("Proyecto guardado en tu cuenta");
      if (root.isConnected) { root.dataset.ready = ""; mountStudioProjects(root); }
    });
  });
  if (!root.querySelector("form")) root.dataset.ready = "";
}

function timelineHasNote(lane,column) {
  return lane.grid.some(row=>row[column]);
}

function clipLane(lane) {
  const length=totalSteps(arrangement);
  const visible=lane.clips.map((clip,index)=>({clip,index})).filter(item=>item.clip.start<length);
  return `<div class="timeline-clip-lane" data-clip-lane="${lane.id}" role="group"
    aria-label="Regiones de ${esc(lane.name)}">${visible.map(({clip,index})=>
      `<button type="button" class="timeline-region" data-region="${index}" title="Arrastra o usa las flechas"
        style="--start:${100*clip.start/length}%;--length:${100*Math.min(clip.steps,length-clip.start)/length}%"
        aria-label="Región ${index+1}, paso ${clip.start+1}. Mover con flechas">Región ${index+1}</button>`).join("")||
      '<span>Abre la pista para colocar una región</span>'}</div>`;
}

function bindTimelineClips(root) {
  for(const surface of root.querySelectorAll("[data-clip-lane]")) {
    const lane=arrangement.tracks.find(track=>track.id===surface.dataset.clipLane);
    for(const button of surface.querySelectorAll("[data-region]")) {
      const index=Number(button.dataset.region);
      const clip=lane.clips[index];
      let drag;
      const total=totalSteps(arrangement);
      const maximum=Math.max(0,total-Math.min(total,clip.steps));
      const clamp=step=>Math.min(maximum,Math.max(0,step));
      const write=(step,restoreFocus)=>{
        if(clip.start===step)return;
        clip.start=step;
        checkpointStudio();
        paintTracks();
        if(activeLane()===lane&&studioPanel==="pattern")paintStudioPanel();
        if(restoreFocus)$(`[data-clip-lane="${lane.id}"] [data-region="${index}"]`)?.focus();
      };
      button.onpointerdown=event=>{
        if(event.button!==0)return;
        drag={x:event.clientX,pointer:event.pointerId,step:clip.start};
        button.setPointerCapture(event.pointerId);
      };
      button.onpointermove=event=>{
        if(drag?.pointer!==event.pointerId)return;
        drag.step=clamp(clip.start+Math.round((event.clientX-drag.x)*total/surface.clientWidth));
        button.style.setProperty("--start",100*drag.step/total+"%");
      };
      button.onpointerup=event=>{
        if(drag?.pointer!==event.pointerId)return;
        const {step}=drag;drag=null;
        write(step,true);
      };
      button.onpointercancel=button.onlostpointercapture=()=>{
        if(!drag)return;
        drag=null;
        button.style.setProperty("--start",100*clip.start/total+"%");
      };
      button.onkeydown=event=>{
        const delta={ArrowLeft:-1,ArrowRight:1}[event.key];
        if(!delta)return;
        event.preventDefault();
        write(clamp(clip.start+delta*(event.shiftKey?4:1)),true);
      };
    }
  }
}

function paintManualPiano(){
  const root=$("#piano-card");
  if(!root)return;
  const lane=activeLane();
  root.innerHTML=pianoMarkup(lane,KEYS);
  bindPiano(root,previewNote,releaseKey);
  const octave=root.querySelector("#piano-octave");
  if(octave)octave.onchange=()=>{lane.octave=Number(octave.value);paintManualPiano();};
}

function mountClipIfEmpty(lane,audio){
  if(!lane.clips.length)lane.clips.push({start:0,steps:Math.max(1,Math.ceil(audio.duration*arrangement.bpm/15)),from:0,to:null});
}

function drawStudioWave(canvas,buffer){
  if(!canvas||!buffer)return;
  const context=canvas.getContext("2d"), data=buffer.getChannelData(0);
  const width=canvas.width,height=canvas.height,mid=height/2;
  context.clearRect(0,0,width,height);
  context.fillStyle="#b4a2ff";
  const step=Math.max(1,Math.floor(data.length/width));
  for(let x=0;x<width;x++){
    let low=0,high=0;
    for(let i=x*step;i<Math.min(data.length,(x+1)*step);i+=Math.max(1,Math.floor(step/48))){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}
    context.fillRect(x,mid-high*mid,1,Math.max(1,(high-low)*mid));
  }
}

function paintClipEditor(lane){
  const root=$("#studio-editor");
  const audio=decodedSounds.get(lane.id);
  const seconds=audio?.duration||0;
  const total=totalSteps(arrangement);
  root.innerHTML=`<section class="card clip-editor">
    <div class="section-line"><div><h2>${esc(lane.name)}</h2><p class="muted">Coloca regiones en la línea de tiempo y recorta su fuente. Estirar una región cambia su tono.</p></div>
      <button class="g" id="clip-add" ${lane.clips.length>=32?"disabled":""}>Añadir región</button></div>
    <canvas id="clip-wave" width="600" height="80" aria-label="Forma de onda para recorte"></canvas>
    <div class="clip-regions">${lane.clips.map((clip,i)=>`<fieldset data-clip-row="${i}"><legend>Región ${i+1}</legend>
       <div class="clip-fields"><label class="field">Paso de inicio<input data-clip="start" type="number" min="1" max="2400" value="${clip.start+1}"></label>
       <label class="field">Duración en pasos<input data-clip="steps" type="number" min="1" max="2400" value="${clip.steps}"></label>
       <label class="field">Recorte desde (s)<input data-clip="from" type="number" min="0" max="${seconds||1200}" step=".01" value="${clip.from}"></label>
       <label class="field">Recorte hasta (s)<input data-clip="to" type="number" min="0" max="${seconds||1200}" step=".01" value="${clip.to??""}" placeholder="Final"></label>
       <button class="g" data-drop-clip type="button" aria-label="Quitar región ${i+1}">Quitar</button></div>
       <p class="muted" data-clip-length>${clip.start>=total?"Fuera de los "+total+" pasos de la canción.":""}</p></fieldset>`).join("")}</div>
       ${audio?`<p class="muted">${seconds.toFixed(2)} s · ${audio.sampleRate} Hz · ${audio.numberOfChannels} canal(es)</p>`:
        '<p class="muted">Añade el audio desde la pestaña Instrumento.</p>'}
    </section>`;
  drawStudioWave($("#clip-wave"),audio);
  $("#clip-add").onclick=()=>{
    const previous=lane.clips.at(-1);
    lane.clips.push({start:Math.min(total-1,previous?previous.start+previous.steps:0),steps:8,from:0,to:null});
    paintTracks();paintClipEditor(lane);
  };
  for(const row of root.querySelectorAll("[data-clip-row]")){
    const index=Number(row.dataset.clipRow);
    const clip=lane.clips[index];
    row.querySelector("[data-drop-clip]").onclick=()=>{lane.clips.splice(index,1);paintTracks();paintClipEditor(lane);};
    row.onchange=event=>{
      const field=event.target.dataset.clip;
      if(!field)return;
      const input=event.target;
      let value=field==="to"&&input.value===""?null:limit(Number(input.value),Number(input.min),Number(input.max),Number(input.min));
      if(field==="start")value=Math.round(value)-1;
      if(field==="steps")value=Math.round(value);
      if((field==="to"&&value!==null&&value<=clip.from)||(field==="from"&&value>=(clip.to??Infinity))){
        toast("El recorte final debe estar después del recorte inicial.");
        input.value=clip[field]??"";return;
      }
      clip[field]=value;
      input.value=(field==="start"?1+value:value)??"";
      row.querySelector("[data-clip-length]").textContent=clip.start>=total?"Fuera de los "+total+" pasos de la canción.":"";
      paintTracks();
    };
  }
}

async function importStudioFile(file){
  if(file.size>220000)throw new Error("El proyecto JSON supera el tamaño admitido.");
  let project;
  try{project=JSON.parse(await file.text());}catch{throw new Error("El proyecto JSON es inválido.");}
  if(project?.format==="larp-studio"&&project.version===2&&project.state?.studio){
    await openProject({id:"",state:project.state});
  }else if(project?.version===1&&project.settings&&Array.isArray(project.pattern)&&Array.isArray(project.melody)){
    await openProject({id:"",state:{synth:project.settings,drums:project.pattern,melody:project.melody}});
  }else throw new Error("Selecciona un proyecto JSON de Larp Player.");
}

async function addStudioClip(track,file){
  await initDraft();
  if(arrangement.tracks.length>=8)throw new Error("Quita una pista del Estudio para añadir la mezcla.");
  if(!file||file.size>SOURCE_LIMIT)throw new Error("El editor de clips admite hasta 32 MiB.");
  const scope=studioWork;
  const buffer=await engine().decodeAudioData(await file.arrayBuffer());
  if(scope!==studioWork)return;
  if(arrangement.tracks.length>=8)throw new Error("Quita una pista del Estudio para añadir la mezcla.");
  const lane=newLane("clip","Osciladores","Mezcla Larp DDJ");
  decodedSounds.set(lane.id,buffer);
  lane.sampleName=file.name;
  if(session.user&&track?.id&&!track.local)lane.sample=track.id;
  else localSamples.set(lane.id,file);
  mountClipIfEmpty(lane,buffer);
  arrangement.tracks.push(lane);
  if(!arrangement.songBars&&buffer.duration>arrangement.steps*15/arrangement.bpm){
    arrangement.songBars=Math.min(512,Math.ceil(buffer.duration*arrangement.bpm/240));
  }
  selectedTrack=lane.id;
  studioPanel="pattern";
  navigation.go("syn-legacy");
  checkpointStudio();
}

studioHooks.isRecording = studioRecording;
studioHooks.stop = stopStudio;
studioHooks.setTempo=async bpm=>{
  await initDraft();
  arrangement.bpm=limit(bpm,40,240,120);
  const input=$("#studio-bpm");
  if(input)input.value=arrangement.bpm.toFixed(2);
  checkpointStudio();
};
studioHooks.addClip=addStudioClip;

export { persistStudioDraft, resetStudio, vSyn };
