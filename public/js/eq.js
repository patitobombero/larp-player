import { mountOutputCheck, outputCheckMarkup } from "./output-check.js";
import { measureResponse, usesQ } from "./eq-dsp.js";
import { exportWithEq } from "./eq-render.js";
import { addLibraryFile } from "./library.js";
import { downloadFile } from "./wav.js";
import { BAND_DEFAULTS, FILTERS, RATES, activeSink, applyAudio, canSelectPlayerSink, chain, changeRate, ctx, normalizeAudio, playTone, readyAudio, setPlaybackRoute, setSink, sound, stopTestTone } from "./audio.js";
import { api, bindForm, task } from "./client.js";
import { $, esc, limit, toast } from "./common.js";
import { editableControl, valueControl } from "./controls.js";
import { session } from "./state.js";

const EQ_PRESETS = {
  Plano:[0,0,0,0,0,0,0,0],
  "Graves controlados":[4,3,1,-1,0,0,0,-1],
  Voces:[-3,-1,0,2,4,3,0,-1],
  Brillo:[0,0,0,0,1,2,4,5],
  Loudness:[6,5,2,0,-1,0,3,5],
  "Sin graves":[-12,-8,-5,-2,0,0,0,0],
  "Referencia suave":[1,0,-1,-1,0,1,-2,-3]
};
const FILTER_LABEL = {peaking:"Campana",lowshelf:"Estante grave",highshelf:"Estante agudo",lowpass:"Paso bajo",highpass:"Paso alto",
  bandpass:"Paso banda",notch:"Rechazo",allpass:"Paso todo"};
const EQ_RANGE = [["frequency","Frecuencia",20,22000,1," Hz"],["gain","Ganancia",-24,24,.1," dB"],["q","Factor Q",.1,25,.1,""]];
const EQ_SETTINGS = [
  ["pre","Ganancia de entrada",-24,18,.1," dB"],["trim","Ganancia de salida",-24,12,.1," dB"],
  ["balance","Balance estéreo",-100,100,1,""],["highpass","Corte subsónico",20,4000,1," Hz"],
  ["lowpass","Corte agudo",400,22000,1," Hz"],["threshold","Umbral",-60,0,.1," dB"],
  ["ratio","Relación",1,20,.1,":1"],["knee","Rodilla",0,40,.1," dB"],["attack","Ataque",0,200,1," ms"],
  ["release","Liberación",10,1200,1," ms"],["ceiling","Umbral del limitador",-12,0,.1," dB"],
  ["tuning","La₄ de referencia",415,466,.1," Hz"]
];
let selectedBand = 0;
let spectrumRun = 0;
let peakHold = -90;
let peakAt = 0;

function vEq() {
  $("#main").innerHTML = `<section class="page eq-page" id="eq-page">
    <header class="page-heading"><div><h1>EQ y DAC</h1><p>Calibra la escucha con ocho filtros paramétricos, dinámica y medición en vivo.</p></div>
      <div class="toolbar"><button class="g" id="bypass-eq" aria-pressed="${sound.bypass}">Omitir EQ</button>
        <button class="g" id="open-eq-ab">Comparar A/B</button>
        <button class="b" id="save-audio" ${session.user?"":"disabled"}>Guardar en mi cuenta</button></div>
    </header>
    <div class="card eq-route-strip"><div><i aria-hidden="true"></i><strong id="eq-route-label"></strong><span id="eq-route-detail"></span></div>
      <label class="toolbar">Ruta <select id="eq-route-quick" aria-label="Ruta del reproductor">
      <option value="dsp">Web Audio</option><option value="direct">Directa</option></select></label></div>
    <section class="card meter-card">
      <div class="section-line"><div><h2>Ecualizador paramétrico</h2><p class="muted" id="eq-spectrum-state">Espectro en vivo · en espera</p></div>
        <div class="toolbar"><select id="eq-preset" aria-label="Preset de ecualización"><option value="">Presets de EQ</option>${Object.keys(EQ_PRESETS).map(name=>`<option>${esc(name)}</option>`).join("")}</select>
          <button class="g" id="eq-headroom" title="Compensa el realce máximo de la curva de EQ">Ajustar margen</button><button class="g" id="eq-reset">Restaurar</button></div></div>
      <div class="meter-values"><span>Pico <strong id="meter-peak">−∞ dBFS</strong></span><span>Compresión <strong id="meter-gr">0.0 dB</strong></span></div>
      <canvas id="spectrum" width="1050" height="310" aria-label="Curva de ecualización y espectro. Usa los botones B1 a B8 para editar las bandas."></canvas>
      <div class="peak-meter" aria-hidden="true"><div id="peak-bar"></div></div>
      <div id="eq-bands" class="band-tabs"></div><div id="band-editor"></div>
    </section>
    <details class="card eq-fold"><summary>Dinámica y ruta de señal</summary><div class="eq-controls">
      <section id="eq-signal"><h2>Ruta de señal</h2>
        <label class="toggle"><input data-audio-check="hp" type="checkbox" ${sound.settings.hp?"checked":""}> Activar paso alto</label>
        <label class="toggle"><input data-audio-check="lp" type="checkbox" ${sound.settings.lp?"checked":""}> Activar paso bajo</label>
        ${EQ_SETTINGS.slice(0,5).map(x=>valueControl(x,sound.settings[x[0]],"data-audio")).join("")}</section>
      <section id="eq-dynamics"><h2>Dinámica</h2>
        <label class="toggle"><input data-audio-check="compressor" type="checkbox" ${sound.settings.compressor?"checked":""}> Compresor</label>
        <label class="toggle"><input data-audio-check="limiter" type="checkbox" ${sound.settings.limiter?"checked":""}> Limitador de monitor</label>
        <p class="muted">Anticipación de 4 ms y estimación de picos entre muestras.</p>
        ${EQ_SETTINGS.slice(5,11).map(x=>valueControl(x,sound.settings[x[0]],"data-audio")).join("")}</section>
    </div></details>
    <details class="card eq-fold"><summary>Dispositivo y resolución</summary>
      ${outputCheckMarkup()}
      <section id="eq-device"><h2>Dispositivo de salida</h2>
        <div class="toolbar"><select id="sink" aria-label="Salida de audio"><option value="">Salida del sistema</option></select>
          <button class="g" id="choose-output">Elegir salida</button></div>
        <label class="field">Frecuencia del motor Web Audio<select id="audio-rate"><option value="0">Automática</option>${RATES.map(rate=>`<option value="${rate}" ${sound.settings.rate===rate?"selected":""}>${rate/1000} kHz</option>`).join("")}</select></label>
        <p class="muted" id="audio-actual">Activa la medición para ver la frecuencia y la latencia del motor.</p>
        <div class="toolbar"><button class="g" id="start-monitor">Activar medición</button>
          <button class="g" id="test-rates">Evaluar frecuencias</button></div>
        <p class="muted" id="rate-result"></p>
        <p class="muted">La frecuencia del motor y la selección de salida dependen del navegador. El sistema puede remuestrear antes del DAC.</p>
      </section>
    </details>
    <details class="card eq-fold"><summary>Referencia, perfiles y exportación</summary>
      <section id="eq-reference"><h2>Referencia y escucha A/B</h2>
        ${valueControl(EQ_SETTINGS.at(-1),sound.settings.tuning,"data-audio")}
        <div class="toolbar"><label>Prueba <input id="tone-frequency" type="number" min="20" max="20000" value="440" step=".1"> Hz</label>
          <button class="g" id="play-tone">Tono</button><button class="g" id="play-sweep">Barrido</button><button class="g" id="stop-tone">Silenciar prueba</button></div>
        <p class="muted">Tono de tres segundos y barrido a −30 dBFS antes del volumen de monitor.</p>
        <div class="toolbar"><button class="g" id="ab-mark">Capturar A</button><button class="g" id="ab-switch" ${sound.a?"":"disabled"}>Intercambiar A/B</button></div>
        <div class="audio-profiles" id="audio-profiles"></div>
      </section>
    <details class="card" id="eq-export"><summary>Exportar audio con EQ aplicado</summary>
      <p class="muted">Genera un WAV de 48 kHz y 24 bits con tu EQ, dinámica y balance. Hasta 48 MiB y cuatro minutos.</p>
      <form><div class="toolbar"><select aria-label="Pista para exportar con EQ" name="track"></select><button class="b" type="submit">Procesar WAV</button></div>
      <div class="error" role="alert"></div></form><div data-eq-export></div></details>
    </details>
  </section>`;
  const page = $("#eq-page");
  $("#eq-headroom").onclick=()=>{
    const range=Float32Array.from({length:1800},(_,i)=>20*1100**(i/1799));
    const response=eqResponse(range)();
    const ceiling=sound.settings.limiter?sound.settings.ceiling:-1;
    const pre=Math.floor((ceiling-Math.max(0,...response)-sound.settings.trim)*10)/10;
    sound.settings.pre=limit(Math.min(sound.settings.pre,pre),-24,18,0);
    applyAudio();vEq();
    toast("Ganancia de entrada: "+sound.settings.pre.toFixed(1)+" dB");
  };
  paintBands();
  paintAudioProfiles();
  for (const id of ["#eq-signal","#eq-dynamics","#eq-reference"]) {
    editableControl($(id),"data-audio",(key,value) => {sound.settings[key]=value; applyAudio();});
  }
  page.querySelectorAll("[data-audio-check]").forEach(input=>{
    input.onchange = () => { sound.settings[input.dataset.audioCheck]=input.checked; applyAudio(); };
  });
  $("#bypass-eq").onclick = event => {
    sound.bypass=!sound.bypass;
    event.target.setAttribute("aria-pressed",String(sound.bypass));
    applyAudio();
    eqRouteDetails();
  };
  $("#eq-preset").onchange = event => {
    const preset=EQ_PRESETS[event.target.value];
    if (!preset) return;
    sound.settings.bands=BAND_DEFAULTS.map((row,i)=>({...row,gain:preset[i]}));
    applyAudio(); paintBands();
  };
  $("#eq-reset").onclick = () => {
    const {rate,volume,shuffle,repeat} = sound.settings;
    sound.settings=normalizeAudio({rate,volume,shuffle,repeat});
    sound.bypass=false;
    applyAudio(); vEq();
  };
  $("#eq-route-quick").onchange=event=>task(event.currentTarget,async()=>{
    try {await setPlaybackRoute(event.currentTarget.value);} finally {eqRouteDetails();}
  });
  $("#open-eq-ab").onclick=()=>{
    const reference=$("#eq-reference");
    reference.parentElement.open=true;
    $("#ab-mark").scrollIntoView({block:"center"});
    $("#ab-mark").focus({preventScroll:true});
  };
  eqRouteDetails();
  $("#save-audio").onclick = event => task(event.currentTarget,saveAudio);
  $("#audio-rate").onchange = event => task(event.currentTarget,async () => {
    const select=event.currentTarget;
    try { await changeRate(Number(select.value)); }
    catch (error) { select.value=sound.settings.rate; throw error; }
    deviceDetails();
  });
  $("#choose-output").onclick = event => task(event.currentTarget,chooseOutput);
  $("#sink").onchange = event => task(event.currentTarget,async () => {
    const select=event.currentTarget;
    try { await setSink(select.value); }
    catch (error) { select.value=activeSink; throw error; }
    deviceDetails();
  });
  $("#test-rates").onclick = event => task(event.currentTarget,async () => {
    const result=$("#rate-result");
    const supported=[];
    const AudioEngine=window.AudioContext||window.webkitAudioContext;
    if (!AudioEngine) throw new Error("El navegador no ofrece Web Audio.");
    for (const sampleRate of RATES) {
      try {
        const test=new AudioEngine({sampleRate});
        if (test.sampleRate===sampleRate) supported.push(sampleRate/1000+" kHz");
        await test.close();
      } catch {}
    }
    result.textContent=supported.length ? "El navegador admite " + supported.join(", ") + "." : "El navegador rechazó las frecuencias de prueba.";
  });
  $("#start-monitor").onclick = event => task(event.currentTarget,async()=>{ await readyAudio(); deviceDetails(); });
  $("#play-tone").onclick = event => task(event.currentTarget,() => playTone(limit(Number($("#tone-frequency").value),20,20000,440)));
  $("#play-sweep").onclick = event => task(event.currentTarget,() => playTone(20,true));
  $("#stop-tone").onclick = stopTestTone;
  $("#ab-mark").onclick = () => {
    sound.a=normalizeAudio(sound.settings); $("#ab-switch").disabled=false; toast("Configuración A capturada");
  };
  $("#ab-switch").onclick = event => task(event.currentTarget,async () => {
    if (!sound.a) return;
    const current=normalizeAudio(sound.settings);
    sound.settings={...sound.a,rate:current.rate};
    await changeRate(sound.a.rate);
    sound.a=current;
    applyAudio(); vEq();
  });
  deviceDetails();
  scanOutputs();
  monitorSpectrum(page);
  mountEqExport(page);
  mountOutputCheck();
}

function fillEqSources(){
  const select=$("#eq-export select");
  if(!select)return;
  const previous=select.value;
  select.innerHTML='<option value="">Selecciona una pista…</option>'+session.tracks.map(track=>
    `<option value="${esc(track.id)}">${esc(track.name)}</option>`).join("");
  if(session.tracks.some(item=>item.id===previous))select.value=previous;
}
window.addEventListener("larp-library-updated",fillEqSources);

function mountEqExport(page){
  const box=page.querySelector("#eq-export");
  const form=box.querySelector("form");
  const output=box.querySelector("[data-eq-export]");
  fillEqSources();
  bindForm(form,async fields=>{
    const item=session.tracks.find(track=>track.id===fields.get("track"));
    const file=await exportWithEq(item,normalizeAudio(sound.settings),sound.bypass);
    if(!page.isConnected)return;
    output.innerHTML='<div class="toolbar" style="margin-top:9px"><button class="g" data-eq-download>Descargar WAV</button><button class="g" data-eq-save>Añadir a biblioteca</button></div>';
    output.querySelector("[data-eq-download]").onclick=()=>downloadFile(file);
    const save=output.querySelector("[data-eq-save]");
    save.onclick=()=>task(save,async()=>{await addLibraryFile(file);toast("Audio procesado añadido a la biblioteca");});
  });
}

function paintBands() {
  const deck=$("#eq-bands");
  if (!deck) return;
  deck.innerHTML=sound.settings.bands.map((band,index)=>`<button class="band-tab ${!band.on?"unset":""}" data-band="${index}" aria-pressed="${index===selectedBand}">
    <b>B${index+1}</b><span>${band.frequency} Hz</span><small>${band.gain>0?"+":""}${band.gain.toFixed(1)} dB</small></button>`).join("");
  deck.onclick=event=>{
    const button=event.target.closest("[data-band]");
    if (!button) return;
    selectedBand=Number(button.dataset.band);
    paintBands();
  };
  const band=sound.settings.bands[selectedBand];
  const editor=$("#band-editor");
  editor.innerHTML=`<div class="band-edit"><label class="field">Tipo de filtro<select id="band-type">
    ${FILTERS.map(type=>`<option value="${type}" ${type===band.type?"selected":""}>${FILTER_LABEL[type]}</option>`).join("")}
    </select></label><label class="toggle"><input id="band-enable" type="checkbox" ${band.on?"checked":""}> Banda activa</label>
    ${EQ_RANGE.filter(([key])=>key!=="q"||usesQ(band.type)).map(field=>valueControl(field,band[field[0]],"data-band-field")).join("")}</div>`;
  const updateLabel=()=>{
    const active=deck.querySelector(`[data-band="${selectedBand}"]`);
    active.querySelector("span").textContent=band.frequency + " Hz";
    active.querySelector("small").textContent=(band.gain>0?"+":"")+band.gain.toFixed(1)+" dB";
    active.classList.toggle("unset",!band.on);
    applyAudio();
  };
  $("#band-type").onchange=event=>{band.type=event.target.value;applyAudio();paintBands();$("#band-type").focus();};
  $("#band-enable").onchange=event=>{band.on=event.target.checked;updateLabel();};
  editableControl(editor.firstElementChild,"data-band-field",(field,value)=>{band[field]=value;updateLabel();});
}

async function saveAudio() {
  if (!session.user) return;
  const result=await api("preferences/audio",{method:"PUT",data:{settings:normalizeAudio(sound.settings),profiles:sound.profiles,route:sound.route}});
  if (session.user) toast("Configuración de audio guardada");
  return result;
}

function paintAudioProfiles() {
  const root=$("#audio-profiles");
  root.innerHTML=`<h3>Perfiles personales</h3>
    ${session.user?'<div class="toolbar"><input id="audio-profile-name" placeholder="Nombre para este perfil" aria-label="Nombre para este perfil" maxlength="36"><button class="g" id="new-audio-profile">Guardar perfil</button></div>':
      '<p class="muted">Inicia sesión para guardar tus calibraciones.</p>'}
    ${sound.profiles.map((profile,index)=>`<div class="profile-row"><span>${esc(profile.name)}</span><button class="g" data-load-audio="${index}">Aplicar</button>
      <button class="g" data-drop-audio="${index}" aria-label="Borrar ${esc(profile.name)}">Quitar</button></div>`).join("")}`;
  if (!session.user) return;
  $("#new-audio-profile").onclick=event=>task(event.currentTarget,async()=>{
    const name=$("#audio-profile-name").value.trim();
    if (!name) throw new Error("Ponle un nombre a la calibración.");
    const old=sound.profiles;
    const profiles=[{name,settings:normalizeAudio(sound.settings)},...old.filter(item=>item.name.toLowerCase()!==name.toLowerCase())];
    if (profiles.length>15) throw new Error("Puedes guardar hasta 15 perfiles de audio.");
    sound.profiles=profiles;
    try { await saveAudio(); } catch(error) {sound.profiles=old;throw error;}
    if (root.isConnected) paintAudioProfiles();
  });
  root.querySelectorAll("[data-load-audio]").forEach(button=>{
    button.onclick=()=>task(button,async()=>{
      const settings=normalizeAudio(sound.profiles[Number(button.dataset.loadAudio)].settings);
      const {rate}=sound.settings;
      sound.settings={...settings,rate};
      await changeRate(settings.rate);
      sound.bypass=false;
      applyAudio();
      if (root.isConnected) vEq();
    });
  });
  root.querySelectorAll("[data-drop-audio]").forEach(button=>{
    button.onclick=()=>task(button,async()=>{
      const old=sound.profiles;
      sound.profiles=old.filter((_,i)=>i!==Number(button.dataset.dropAudio));
      try { await saveAudio(); } catch(error) {sound.profiles=old;throw error;}
      if (root.isConnected) paintAudioProfiles();
    });
  });
}

async function scanOutputs() {
  const select=$("#sink");
  if (!select) return;
  const outputs=(await navigator.mediaDevices?.enumerateDevices().catch(()=>[]) || []).filter(item=>item.kind==="audiooutput" && item.deviceId && item.deviceId!=="default");
  if (!select.isConnected) return;
  select.replaceChildren(new Option("Salida del sistema",""),...outputs.map((item,index)=>new Option(item.label||"Salida "+(index+1),item.deviceId)));
  if (activeSink && !outputs.some(item=>item.deviceId===activeSink)) select.add(new Option("Salida elegida",activeSink));
  select.value=activeSink;
}

async function chooseOutput() {
  if (navigator.mediaDevices?.selectAudioOutput) {
    const device=await navigator.mediaDevices.selectAudioOutput();
    await setSink(device.deviceId);
  } else {
    if (!canSelectPlayerSink()) toast("En este navegador la salida del reproductor se configura en el sistema.");
  }
  await scanOutputs();
  deviceDetails();
}

function deviceDetails() {
  const readout=$("#audio-actual");
  if (!readout) return;
  if (!ctx) {
    readout.textContent="Activa la medición para ver la frecuencia del motor y su latencia.";
    return;
  }
  const format=value=>Number.isFinite(value)?(value*1000).toFixed(1)+" ms":"sin medida";
  readout.textContent=`Motor Web Audio a ${ctx.sampleRate.toLocaleString()} Hz · latencia base ${format(ctx.baseLatency)} · salida ${format(ctx.outputLatency)}`;
}

function eqRouteDetails() {
  const strip=$("#eq-route-label");
  if (!strip) return;
  const direct=sound.route==="direct";
  const mode=direct?"Vista previa":sound.bypass?"EQ omitido":"EQ activo";
  strip.textContent=mode;
  strip.parentElement.dataset.active=String(!direct&&!sound.bypass);
  $("#eq-route-detail").textContent=direct?"La ruta directa reproduce fuera del EQ":"Ruta Web Audio";
  $("#eq-route-quick").value=sound.route;
}
window.addEventListener("larp-output-changed",()=>{
  deviceDetails();
  eqRouteDetails();
});

function eqResponse(frequencies) {
  const curve=new Float32Array(frequencies.length);
  let filter;
  let configuredRate;
  let previous;
  return () => {
    const {bands,hp,lp,highpass,lowpass,rate}=sound.settings;
    const sampleRate=ctx?.sampleRate||rate||48000;
    const settings=sound.bypass ? [] : [
      ...bands.filter(band=>band.on),
      ...(hp?[{type:"highpass",frequency:highpass}]:[]),
      ...(lp?[{type:"lowpass",frequency:lowpass}]:[])
    ];
    const key=JSON.stringify([sampleRate,settings]);
    if (key===previous) return curve;
    previous=key;
    curve.fill(0);
    if (!settings.length) return curve;

    if (sampleRate!==configuredRate) {
      // Calculating a filter response needs neither real-time playback nor an output device.
      const OfflineEngine=window.OfflineAudioContext||window.webkitOfflineAudioContext;
      let preview;
      try { preview=new OfflineEngine(1,1,sampleRate); }
      catch { preview=new OfflineEngine(1,1,48000); }
      filter=preview.createBiquadFilter();
      configuredRate=sampleRate;
    }
    curve.set(measureResponse(filter,sound.settings,sound.bypass,frequencies));
    return curve;
  };
}

function monitorSpectrum(page) {
  const loop=++spectrumRun;
  const canvas=$("#spectrum");
  const g=canvas.getContext("2d");
  if (!g) return;
  let width=canvas.clientWidth;
  let height=canvas.clientHeight;
  const timeData=new Float32Array(4096);
  const frequencyData=[new Float32Array(2048),new Float32Array(2048)];
  const range=Float32Array.from({length:180},(_,i)=>20*1000**(i/179));
  const readResponse=eqResponse(range);
  const left=43,top=13;
  let right=width-21;
  let bottom=height-23;
  let graph=right-left;
  const xFor=f=>left+Math.log(f/20)/Math.log(1000)*graph;
  const yFor=db=>(bottom+top)/2-db*(bottom-top)/44;
  const spectrumState=$("#eq-spectrum-state");
  canvas.addEventListener("click",event=>{
    const rect=canvas.getBoundingClientRect();
    const at=(event.clientX-rect.left)*width/rect.width;
    const bands=sound.settings.bands.map((band,index)=>({index,distance:Math.abs(xFor(Math.min(20000,band.frequency))-at)}));
    bands.sort((a,b)=>a.distance-b.distance);
    if (bands[0]?.distance<=26) {
      selectedBand=bands[0].index;
      paintBands();
      $(`[data-band="${selectedBand}"]`).focus();
    }
  });
  let last=0;

  const draw=time=>{
    if (loop!==spectrumRun || !page.isConnected) return;
    requestAnimationFrame(draw);
    if (time-last<45) return;
    last=time;
    width=canvas.clientWidth;
    height=canvas.clientHeight;
    if (width<110||height<65) return;
    right=width-21;
    bottom=height-23;
    graph=right-left;
    const scale=Math.min(window.devicePixelRatio||1,2);
    const pixelWidth=Math.floor(width*scale);
    const pixelHeight=Math.floor(height*scale);
    if (canvas.width!==pixelWidth||canvas.height!==pixelHeight) {
      canvas.width=pixelWidth;
      canvas.height=pixelHeight;
    }
    g.setTransform(pixelWidth/width,0,0,pixelHeight/height,0,0);
    const styles=getComputedStyle(document.documentElement);
    const border=styles.getPropertyValue("--bd").trim() || "#2f334d";
    const color=styles.getPropertyValue("--punch").trim() || "#a4aaff";
    const ink=styles.getPropertyValue("--mu").trim() || "#a2a4bc";
    g.clearRect(0,0,width,height);
    g.lineWidth=1;
    g.strokeStyle=border;
    g.font="11px system-ui";
    const labels=width<485?[20,100,500,1000,5000,20000]:[20,50,100,200,500,1000,2000,5000,10000,20000];
    for (const hz of labels) {
      const x=xFor(hz); g.beginPath(); g.moveTo(x,top); g.lineTo(x,bottom); g.stroke();
      g.fillStyle=ink;
      g.textAlign="center";
      g.fillText(hz<1000?hz+" Hz":hz/1000+" kHz",x,height-8);
    }
    for (const value of [-18,-12,-6,0,6,12,18]) {
      const y=yFor(value); g.beginPath(); g.moveTo(left,y); g.lineTo(right,y); g.stroke();
      g.fillStyle=ink; g.textAlign="right"; g.fillText(value+" dB",left-6,y+4);
    }
    const transformValue=readResponse();
    let hasSignal=false;
    if (ctx?.state==="running") {
      let peak=0;
      chain.meters.forEach((meter,index)=>{
        meter.getFloatFrequencyData(frequencyData[index]);
        meter.getFloatTimeDomainData(timeData);
        for(const value of timeData)peak=Math.max(peak,Math.abs(value));
      });
      hasSignal=peak>.00032;
      const db=20*Math.log10(Math.max(peak,.000032));
      if (db>peakHold || time-peakAt>1200) { peakHold=db; peakAt=time; }
      $("#meter-peak").textContent=peakHold<=-89?"−∞ dBFS":peakHold.toFixed(1)+" dBFS";
      $("#meter-gr").textContent=((sound.settings.compressor?chain.compressor.reduction:0)+chain.limiter.reduction).toFixed(1)+" dB";
      $("#peak-bar").style.width=Math.max(0,Math.min(100,(db+60)/60*100))+"%";
      $("#peak-bar").classList.toggle("clip",db>-.25);
      const size=ctx.sampleRate/4096;
      g.fillStyle=color+"4f";
      for (let i=0;i<range.length-1;i++) {
        const bin=Math.min(frequencyData[0].length-1,Math.round(range[i]/size));
        const value=10*Math.log10((10**(frequencyData[0][bin]/10)+10**(frequencyData[1][bin]/10))/2);
        const h=Math.max(0,Math.min(1,(value+95)/93))*(bottom-top);
        g.fillRect(xFor(range[i]),bottom-h,Math.max(1,graph/(range.length-1)-1),h);
      }
    }
    const state=hasSignal?"Espectro en vivo · señal Web Audio":
      sound.route==="direct"?"Espectro en espera · la pista usa salida directa":"Espectro en vivo · en espera";
    if (spectrumState.textContent!==state) spectrumState.textContent=state;
    g.strokeStyle=color; g.lineWidth=2.5; g.beginPath();
    for (let i=0;i<range.length;i++) {
      const y=Math.min(bottom,Math.max(top,yFor(transformValue[i])));
      if (i===0) g.moveTo(left,y); else g.lineTo(left+i*graph/(range.length-1),y);
    }
    g.stroke();
    for (const [index,band] of sound.settings.bands.entries()) {
      const x=xFor(Math.min(20000,band.frequency));
      const point=Math.min(range.length-1,Math.round((x-left)/graph*(range.length-1)));
      const y=Math.min(bottom,Math.max(top,yFor(transformValue[point])));
      const selected=index===selectedBand;
      g.beginPath();g.arc(x,y,selected?8:6,0,Math.PI*2);
      g.fillStyle=selected?color:styles.getPropertyValue("--inset").trim();
      g.fill();g.lineWidth=1;g.stroke();
      g.fillStyle=selected?"#15121f":band.on?color:ink;
      g.font="700 9px system-ui";g.textAlign="center";g.fillText(String(index+1),x,y+3);
    }
  };
  requestAnimationFrame(draw);
}

export { vEq };
