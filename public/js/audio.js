import { createEqGraph, createLimiterSlot } from "./eq-dsp.js";
import { readArtwork } from "./artwork.js";
import { task } from "./client.js";
import { $, DB, limit, permitted, toast } from "./common.js";
import { djHooks, session, studioHooks } from "./state.js";

const FILTERS = ["peaking","lowshelf","highshelf","lowpass","highpass","bandpass","notch","allpass"];
const RATES = [44100,48000,88200,96000,176400,192000];
const BAND_DEFAULTS = [40,100,250,630,1600,4000,10000,16000].map((frequency,i) => ({
  type:i === 0 ? "lowshelf" : i === 7 ? "highshelf" : "peaking", frequency, gain:0, q:i === 0 || i === 7 ? .7 : 1, on:true
}));
const AUDIO_DEFAULTS = {
  bands:BAND_DEFAULTS, pre:0, trim:0, balance:0, highpass:20, lowpass:20000, hp:false, lp:false,
  compressor:false, threshold:-24, ratio:4, knee:18, attack:15, release:120,
  limiter:true, ceiling:-1, tuning:440, rate:0, volume:80, repeat:"off", shuffle:false
};

const sound = { settings:normalizeAudio(), profiles:[], a:null, bypass:false, route:"dsp" };
let dspPlayer = new Audio();
const directPlayer = new Audio();
let au = dspPlayer;
let ctx, chain, studioInput, recorderInput;
let testSignal;
let activeSink = "";
let silence = false;
let playOrder = null;
let shuffled = [];
let queued = [];
let restoredOwner;
let savedAt=0;
let changingRate = false;
let changingRoute = false;
const fallbackCover="/assets/larp-disc.webp";
let artLoad=null,artUrl="",artTrack="";
const artKey=item=>item?.url||"";
function resetArtwork(){
  artLoad?.abort();artLoad=null;artTrack="";
  if(artUrl)URL.revokeObjectURL(artUrl);
  artUrl="";
  const image=$("#disc-cover");
  image.onerror=null;
  image.src=fallbackCover;
}
function setMediaArtwork(item,source){
  if(navigator.mediaSession&&typeof MediaMetadata==="function")navigator.mediaSession.metadata=new MediaMetadata({
    title:item.title||item.name,artist:item.artist||"",album:item.album||"",artwork:[{src:new URL(source,location.href).href}]
  });
}
function showArtwork(item){
  if(artTrack===artKey(item)){setMediaArtwork(item,artUrl||fallbackCover);return;}
  resetArtwork();
  artTrack=artKey(item);
  setMediaArtwork(item,fallbackCover);
  const owner=artLoad=new AbortController();
  readArtwork(item,owner.signal).then(blob=>{
    if(!blob||owner.signal.aborted||artKey(session.tracks[session.trackIndex])!==artTrack)return;
    const image=$("#disc-cover");
    artUrl=URL.createObjectURL(blob);
    image.onerror=()=>{
      if(owner.signal.aborted)return;
      image.onerror=null;URL.revokeObjectURL(artUrl);artUrl="";image.src=fallbackCover;
      setMediaArtwork(item,fallbackCover);
    };
    image.src=artUrl;
    setMediaArtwork(item,artUrl);
  }).catch(()=>{});
}
const outputChanged = () => window.dispatchEvent(new Event("larp-output-changed"));
const trackChanged = () => window.dispatchEvent(new Event("larp-track-changed"));

function normalizeAudio(value = {}) {
  const defaults = AUDIO_DEFAULTS;
  const result = {...defaults};
  value = value && typeof value === "object" ? value : {};
  const ranges = {pre:[-24,18],trim:[-24,12],balance:[-100,100],highpass:[20,4000],lowpass:[400,22000],
    threshold:[-60,0],ratio:[1,20],knee:[0,40],attack:[0,200],release:[10,1200],ceiling:[-12,0],tuning:[415,466],volume:[0,100]};
  for (const [key,[min,max]] of Object.entries(ranges)) result[key] = limit(value[key],min,max,defaults[key]);
  for (const key of ["hp","lp","compressor","limiter","shuffle"]) result[key] = typeof value[key] === "boolean" ? value[key] : defaults[key];
  result.rate = permitted(value.rate,[0,...RATES],0);
  result.repeat = permitted(value.repeat,["off","all","one"],"off");
  result.bands = BAND_DEFAULTS.map((band,i) => {
    const stored = value.bands?.[i] || {};
    return {
      type:permitted(stored.type,FILTERS,band.type),
      frequency:limit(stored.frequency,20,22000,band.frequency),
      gain:limit(stored.gain,-24,24,0), q:limit(stored.q,.1,25,band.q), on:stored.on !== false
    };
  });
  return result;
}

function setParam(param, value, time = .012) {
  if (time) param.setTargetAtTime(value,ctx.currentTime,time);
  else param.setValueAtTime(value,ctx.currentTime);
}

function engine() {
  if (ctx) return ctx;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) throw new Error("Este navegador no ofrece un motor Web Audio.");
  try { ctx = new AudioEngine(sound.settings.rate ? {sampleRate:sound.settings.rate} : undefined); }
  catch { ctx = new AudioEngine(); }
  const source=ctx.createMediaElementSource(dspPlayer);
  const eq=createEqGraph(ctx,source,BAND_DEFAULTS);
  studioInput = ctx.createGain();
  const mixMeter = ctx.createAnalyser();
  mixMeter.fftSize = 1024;
  studioInput.connect(mixMeter);
  recorderInput = ctx.createMediaStreamDestination();
  studioInput.connect(recorderInput);
  const bus = ctx.createGain();
  const limiter=createLimiterSlot(ctx,bus);
  const monitor=ctx.createGain(),split=ctx.createChannelSplitter(2);
  const meters=[ctx.createAnalyser(),ctx.createAnalyser()];
  meters.forEach((meter,index)=>{
    meter.fftSize=4096;meter.smoothingTimeConstant=.8;
    split.connect(meter,index);
  });
  eq.output.connect(bus);
  studioInput.connect(bus);
  limiter.output.connect(monitor).connect(ctx.destination);
  monitor.connect(split);
  chain={eq,compressor:eq.compressor,bus,limiter,monitor,meters,mixMeter};
  applyAudio(true);
  return ctx;
}

function applyAudio(immediate = false) {
  const volume = $("#vol");
  if (volume) volume.value = sound.settings.volume;
  try { directPlayer.volume=sound.settings.volume/100; } catch {}
  directPlayer.muted=silence;
  $("#vi").setAttribute("aria-pressed",String(silence));
  $("#vi").textContent = silence ? "🔇" : "◖))";
  const shuffle = $("#shuffle");
  if (shuffle) shuffle.setAttribute("aria-pressed",String(sound.settings.shuffle));
  const repeat = $("#repeat");
  if (repeat) {
    repeat.setAttribute("aria-pressed",String(sound.settings.repeat !== "off"));
    repeat.textContent = sound.settings.repeat === "one" ? "↻ 1" : "↻";
    repeat.title = {off:"Repetición desactivada",all:"Repetir cola",one:"Repetir pista"}[sound.settings.repeat];
    repeat.setAttribute("aria-label",repeat.title);
  }
  if (!ctx) return;
  const {eq,limiter,monitor}=chain;
  const settings=sound.settings,t=immediate?0:.012;
  eq.apply(settings,sound.bypass,immediate);
  limiter.apply(settings.limiter,settings.ceiling,immediate);
  setParam(monitor.gain,silence ? 0 : settings.volume/100,t);
}

async function readyAudio() {
  engine();
  await Promise.all([ctx.state==="running"?null:ctx.resume(),chain.limiter.ready]);
  outputChanged();
  return ctx;
}

async function applySink(output,sink) {
  if (typeof output.setSinkId!=="function") {
    if (sink) throw new Error("Este navegador usa la salida que selecciones en el sistema.");
    return;
  }
  if (output.sinkId!==sink) await output.setSinkId(sink);
}

async function setSink(sink) {
  const destination=sound.route==="direct" ? directPlayer : engine();
  await applySink(destination,sink);
  activeSink=sink;
  const secondary=sound.route==="direct" ? ctx : directPlayer;
  if (secondary && typeof secondary.setSinkId==="function") await applySink(secondary,sink).catch(()=>{});
  outputChanged();
}

function canSelectPlayerSink() {
  if (sound.route==="direct") return typeof directPlayer.setSinkId==="function";
  const AudioEngine=window.AudioContext||window.webkitAudioContext;
  return typeof AudioEngine?.prototype.setSinkId==="function";
}

function playbackSnapshot(player) {
  return {source:player.getAttribute("src"), position:player.currentTime, playing:!player.paused&&!player.ended};
}

function clearElement(player) {
  player.pause();
  if (player.getAttribute("src")) {
    player.removeAttribute("src");
    player.load();
  }
}

function restorePlayback(player, snapshot) {
  if (!snapshot.source) return;
  player.src=snapshot.source;
  if (Number.isFinite(snapshot.position) && snapshot.position>0) player.currentTime=snapshot.position;
  $("#tm").textContent=fmt(snapshot.position);
}

async function setPlaybackRoute(route) {
  if (route===sound.route) return;
  if (!["direct","dsp"].includes(route)) throw new Error("Ruta de salida desconocida.");
  if (changingRoute||changingRate) throw new Error("Espera a que termine el cambio de salida.");
  changingRoute=true;
  try {
    const previous=au;
    const next=route==="direct" ? directPlayer : dspPlayer;
    if (route==="direct") {
      await applySink(directPlayer,activeSink);
    } else if (activeSink||ctx||!previous.paused) {
      await applySink(engine(),activeSink);
      if (!previous.paused) await readyAudio();
    }
    const track=playbackSnapshot(previous);
    au=next;
    sound.route=route;
    clearElement(previous);
    applyAudio();
    restorePlayback(next,track);
    paintPlayer();
    outputChanged();
    if (track.playing && au===next) {
      await next.play().catch(error=>{
        if (error.name!=="AbortError") toast("Ruta cambiada. Pulsa Reproducir para continuar.");
      });
    }
  } finally {
    changingRoute=false;
  }
}

async function changeRate(rate) {
  if (changingRate||changingRoute) return;
  if (studioHooks.isRecording() || djHooks.recording()) throw new Error("Detén la grabación antes de cambiar la frecuencia.");
  if (rate === sound.settings.rate && ctx && (!rate || ctx.sampleRate === rate)) return;
  sound.settings.rate = rate;
  changingRate = true;
  try {
    if (!ctx) return;
    const previous=dspPlayer;
    const isActive=au===previous;
    const track=isActive ? playbackSnapshot(previous) : null;
    stopTestTone();
    studioHooks.stop();
    djHooks.rateChange();
    previous.pause();
    await ctx.close();
    ctx=null;
    dspPlayer=new Audio();
    bindPlayer(dspPlayer);
    clearElement(previous);
    if (isActive) au=dspPlayer;
    engine();
    if (activeSink && typeof ctx.setSinkId==="function") {
      await applySink(ctx,activeSink).catch(()=>{
        if (isActive) activeSink="";
      });
    }
    if (track) {
      restorePlayback(dspPlayer,track);
      if (track.playing) {
        await readyAudio();
        await dspPlayer.play();
      }
    }
  } finally {
    changingRate=false;
    outputChanged();
  }
}

function applyAudioPreference(prefs = {}) {
  const oldRate = sound.settings.rate;
  const settings = normalizeAudio(prefs.settings);
  const owner=session.user?.id;
  sound.profiles = Array.isArray(prefs.profiles) ? prefs.profiles.slice(0,15).map(item => ({
    name: typeof item?.name === "string" ? item.name.slice(0,36) : "",
    settings: normalizeAudio(item?.settings)
  })).filter(item => item.name) : [];
  sound.a = null;
  sound.bypass = false;
  sound.settings = {...settings,rate:oldRate};
  if (!ctx) sound.settings.rate = settings.rate;
  applyAudio();
  task(null,async()=>{
    if (ctx&&oldRate!==settings.rate) await changeRate(settings.rate);
    if (session.user?.id===owner) await setPlaybackRoute(prefs.route==="direct"?"direct":"dsp");
  });
}

function stopTestTone() {
  if (testSignal) {
    try { testSignal.stop(); } catch {}
    testSignal.disconnect();
    testSignal = null;
  }
}

async function playTone(hz, sweep = false) {
  await readyAudio();
  stopTestTone();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(DB(-30),now);
  oscillator.frequency.setValueAtTime(sweep ? 20 : hz,now);
  if (sweep) oscillator.frequency.exponentialRampToValueAtTime(Math.min(20000,ctx.sampleRate/2-100),now+8);
  oscillator.connect(gain).connect(chain.bus);
  oscillator.start();
  oscillator.stop(now + (sweep ? 8 : 3));
  testSignal = oscillator;
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    if (testSignal === oscillator) testSignal = null;
  };
}

function fmt(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return Math.floor(seconds/60) + ":" + String(Math.floor(seconds%60)).padStart(2,"0");
}

function bindPlayer(element) {
  element.preload = "metadata";
  element.addEventListener("timeupdate",() => {
    if (element !== au) return;
    $("#seek").value = element.duration ? element.currentTime/element.duration*1000 : 0;
    $("#tm").textContent = fmt(element.currentTime);
    savePlayback();
  });
  element.addEventListener("loadedmetadata",() => {
    if (element === au) {
      $("#duration").textContent = fmt(element.duration);
      outputChanged();
    }
  });
  element.addEventListener("volumechange",() => { if (element === au) outputChanged(); });
  element.addEventListener("play",() => { if (element === au) paintPlayer(); });
  element.addEventListener("pause",() => { if (element === au) {paintPlayer();savePlayback(true);} });
  element.addEventListener("ended",() => { if (element === au) nextTrack(1,true); });
  element.addEventListener("error",() => {
    if (element === au && element.getAttribute("src")) toast("El navegador no pudo reproducir esta pista. Puedes descargarla.");
  });
}
bindPlayer(dspPlayer);
bindPlayer(directPlayer);

function playbackKey() {
  return session.user ? "larp:resume:"+session.user.id : "";
}

function savePlayback(force=false) {
  const track=session.tracks[session.trackIndex];
  const key=playbackKey();
  if (!key || !track || track.local || au.getAttribute("src")!==track.url ||
    changingRoute || changingRate || (!force && Date.now()-savedAt<1000)) return;
  savedAt=Date.now();
  try {
    const time=au.ended || (Number.isFinite(au.duration)&&au.duration-au.currentTime<.3) ? 0 : au.currentTime;
    const durable=id=>session.savedTracks.some(track=>track.id===id);
    localStorage.setItem(key,JSON.stringify({id:track.id,time,order:playOrder?.filter(durable)??null,queued:queued.filter(durable)}));
  } catch {}
}
window.addEventListener("pagehide",()=>savePlayback(true));

function showTrack(item) {
  $("#now").textContent=item.title||item.name;
  $("#now").title=item.name;
  $("#player-source").textContent=item.artist||(item.local?"Archivo del dispositivo":"Biblioteca privada");
  $("#duration").textContent=fmt(au.duration);
  showArtwork(item);
}

function restoreLibraryPlayback() {
  const owner=session.user?.id;
  if (!owner || owner===restoredOwner) return;
  restoredOwner=owner;
  if (session.trackIndex>=0) return;
  let saved;
  try { saved=JSON.parse(localStorage.getItem(playbackKey())); } catch {}
  const index=session.tracks.findIndex(track=>track.id===saved?.id&&!track.local);
  if (index<0) return;
  const item=session.tracks[index];
  setPlayOrder(Array.isArray(saved.order)?saved.order:null);
  const ids=new Set(session.savedTracks.map(track=>track.id));
  queued=Array.isArray(saved.queued)?saved.queued.filter(id=>ids.has(id)&&id!==item.id):[];
  session.trackIndex=index;
  restorePlayback(au,{source:item.url,position:Math.max(0,Number(saved.time)||0)});
  showTrack(item);
  paintPlayer();
  trackChanged();
}
function resetPlaybackIdentity() {
  resetArtwork();
  if (navigator.mediaSession) navigator.mediaSession.metadata=null;
  restoredOwner=undefined;
}

function playNext(id) {
  if (!session.tracks.some(track=>track.id===id)) return;
  if (session.tracks[session.trackIndex]?.id===id) return toast("Esta pista ya está en el reproductor.");
  queued=[id,...queued.filter(item=>item!==id)];
  savePlayback(true);
  paintQueue();
  toast("Pista añadida a continuación");
}

function playQueued(id) {
  const currently=session.tracks[session.trackIndex]?.id;
  const order=currentOrder().filter(item=>item!==id);
  order.splice(order.indexOf(currently)+1,0,id);
  playOrder=order;
  if(sound.settings.shuffle)shuffled=[...order];
  return play(session.tracks.findIndex(track=>track.id===id));
}

function forwardOrder() {
  const id=session.tracks[session.trackIndex]?.id;
  const order=currentOrder();
  const index=order.indexOf(id);
  const forward=order.slice(index+1);
  if (sound.settings.repeat==="all" && index>=0) forward.push(...order.slice(0,index));
  const tracks=new Map(session.tracks.map(track=>[track.id,track]));
  return [...new Set([...queued,...forward])].filter(key=>key!==id&&tracks.has(key)).map(key=>tracks.get(key));
}

function paintQueue() {
  const dialog=$("#player-queue");
  if (!dialog.open) return;
  const track=session.tracks[session.trackIndex];
  $("#queue-current").textContent=track?"Sonando o en pausa · "+(track.title||track.name):"Elige una pista para empezar";
  const list=$("#queue-items");
  const active=document.activeElement?.dataset.queuePlay;
  list.replaceChildren(...forwardOrder().map(track=>{
    const li=document.createElement("li");
    const button=document.createElement("button");
    button.className="g";
    button.dataset.queuePlay=track.id;
    button.textContent=track.title||track.name;
    button.onclick=()=>queued.includes(track.id)?playQueued(track.id):play(session.tracks.findIndex(item=>item.id===track.id));
    li.append(button);
    if (queued.includes(track.id)) {
      const remove=document.createElement("button");
      remove.className="g";
      remove.textContent="Quitar";
      remove.setAttribute("aria-label","Quitar "+button.textContent+" de la cola manual");
      remove.onclick=()=>{queued=queued.filter(id=>id!==track.id);savePlayback(true);paintQueue();};
      li.append(remove);
    }
    return li;
  }));
  if (!list.children.length) $("#queue-current").textContent+=" · Cola vacía";
  if (active) [...list.querySelectorAll("[data-queue-play]")].find(button=>button.dataset.queuePlay===active)?.focus();
}

$("#record-toggle").onclick=()=>$("#pp").click();
$("#open-queue").onclick=()=>{$("#player-queue").showModal();paintQueue();};
window.addEventListener("larp-library-updated",paintQueue);

function paintPlayer() {
  if(session.trackIndex<0&&artTrack)resetArtwork();
  if (navigator.mediaSession) navigator.mediaSession.playbackState=session.trackIndex<0?"none":au.paused?"paused":"playing";
  paintQueue();
  $("#bar").classList.toggle("is-playing",!au.paused&&!au.ended);
  $("#pp").classList.toggle("is-playing",!au.paused);
  const action=au.paused ? "Reproducir" : "Pausar";
  $("#pp").setAttribute("aria-label",action);
  $("#record-toggle").setAttribute("aria-label",action);
  for (const button of document.querySelectorAll("[data-play]")) {
    const active = button.dataset.play === session.tracks[session.trackIndex]?.id;
    button.closest(".song")?.classList.toggle("on",active);
    button.classList.toggle("is-playing",active && !au.paused);
  }
}

function currentOrder() {
  const storedIds = new Set(session.tracks.map(track => track.id));
  const ids = (playOrder || [...storedIds]).filter(id => storedIds.has(id));
  if (!sound.settings.shuffle) return ids;
  const known = new Set(shuffled);
  const fresh = ids.filter(id => !known.has(id));
  for (let i = fresh.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [fresh[i],fresh[j]] = [fresh[j],fresh[i]];
  }
  shuffled = shuffled.filter(id => ids.includes(id)).concat(fresh);
  return shuffled;
}

function setPlayOrder(ids) {
  queued=[];
  playOrder = ids ? [...new Set(ids)] : null;
  shuffled = [];
}

async function play(index) {
  const item = session.tracks[index];
  if (!item || changingRoute || changingRate) return;
  try {
    if (sound.route==="dsp") await readyAudio();
    if (session.tracks[index] !== item) return;
    session.trackIndex = index;
    if (au.getAttribute("src") !== item.url) au.src = item.url;
    queued=queued.filter(id=>id!==item.id);
    showTrack(item);
    trackChanged();
    await au.play();
    savePlayback(true);
    paintPlayer();
  } catch (error) {
    if (error.name !== "AbortError") toast("No se pudo reproducir esta pista en el navegador.");
  }
}

function nextTrack(direction, automatic = false) {
  const order = currentOrder();
  const active = order.indexOf(session.tracks[session.trackIndex]?.id);
  if (automatic && sound.settings.repeat === "one" && active !== -1) {
    au.currentTime = 0;
    play(session.trackIndex);
    return;
  }
  if (direction>0) {
    const next=queued.find(id=>session.tracks.some(track=>track.id===id));
    if (next) return playQueued(next);
  }
  if (!order.length) return;
  if (direction < 0 && au.currentTime > 3) {
    au.currentTime = 0;
    return;
  }
  let next = active === -1 && direction < 0 ? order.length-1 : active + direction;
  if (next < 0 || next >= order.length) {
    if (automatic && sound.settings.repeat === "off") {
      paintPlayer();
      return;
    }
    next = (next + order.length) % order.length;
  }
  play(session.tracks.findIndex(file => file.id === order[next]));
}

$("#pp").onclick = () => {
  if (session.trackIndex < 0) return nextTrack(1);
  if (au.paused) play(session.trackIndex);
  else au.pause();
};
$("#prev").onclick = () => nextTrack(-1);
$("#next").onclick = () => nextTrack(1);
$("#seek").oninput = event => {
  if (Number.isFinite(au.duration)) au.currentTime = Number(event.currentTarget.value)/1000*au.duration;
};
$("#vol").oninput = event => {
  sound.settings.volume = Number(event.currentTarget.value);
  silence = false;
  applyAudio();
  outputChanged();
};
$("#vi").onclick = () => { silence = !silence; applyAudio(); outputChanged(); };
$("#shuffle").onclick = () => {
  sound.settings.shuffle = !sound.settings.shuffle;
  shuffled = [];
  applyAudio();
  paintQueue();
};
$("#repeat").onclick = () => {
  sound.settings.repeat = {off:"all",all:"one",one:"off"}[sound.settings.repeat];
  applyAudio();
  paintQueue();
};

if (navigator.mediaSession) {
  for (const [action,handler] of Object.entries({
    play:()=>$("#pp").click(),pause:()=>au.pause(),
    previoustrack:()=>nextTrack(-1),nexttrack:()=>nextTrack(1),
    seekto:({seekTime})=>{if (Number.isFinite(au.duration)) au.currentTime=seekTime;}
  })) {
    try {navigator.mediaSession.setActionHandler(action,handler);} catch {}
  }
}

const playerFooter=$("#bar");
const collapsePlayer=$("#collapse-player");
function compactPlayer(yes){
  playerFooter.classList.toggle("player-collapsed",yes);
  collapsePlayer.textContent=yes?"⌃":"⌄";
  collapsePlayer.title=yes?"Mostrar barra y volumen":"Recoger reproductor";
  collapsePlayer.setAttribute("aria-label",collapsePlayer.title);
  collapsePlayer.setAttribute("aria-expanded",String(!yes));
}
try{compactPlayer(localStorage.getItem("larp:player-compact")==="true");}catch{}
collapsePlayer.onclick=()=>{
  const yes=!playerFooter.classList.contains("player-collapsed");
  compactPlayer(yes);
  try{localStorage.setItem("larp:player-compact",String(yes));}catch{}
};

export { BAND_DEFAULTS, FILTERS, RATES, activeSink, applyAudio, applyAudioPreference, au, chain, changeRate, ctx, engine, canSelectPlayerSink, normalizeAudio, paintPlayer, play, playNext, resetPlaybackIdentity, restoreLibraryPlayback, savePlayback, playTone, readyAudio, recorderInput, setPlayOrder, setPlaybackRoute, setSink, sound, trackChanged, stopTestTone, studioInput };
