import { DB, limit, permitted } from "./common.js";

const OCTAVE = ["Do","Do♯","Re","Re♯","Mi","Fa","Fa♯","Sol","Sol♯","La","La♯","Si"];
const NOTES = [...OCTAVE,...OCTAVE,OCTAVE[0]];
const DRUMS = ["Bombo","Caja","Palmas","Hi-hat","Hi-hat abierto","Tom"];
const KEYS = "awsedftgyhujk";
const WAVES = ["sawtooth","square","sine","triangle"];
const INSTRUMENT = {
  t1:"sawtooth",t2:"sawtooth",t3:"sine",oct2:0,oct3:1,det2:7,det3:-7,sub:.2,mix:.5,mix3:0,unison:1,spread:18,ft:"lowpass",cut:3000,res:2,fenv:2000,
  a:.01,d:.2,s:.6,r:.4,lfoR:5,lfoD:0,lfoT:"pitch",dist:0,dly:0,dtm:.3,dfb:.35,rev:0,loop:true,root:0
};
const INSTRUMENT_PRESETS = {
  Osciladores:{description:"Dos osciladores con filtro y envolvente. Un punto de partida para diseñar sonido.",patch:{}},
  Bajo:{description:"Ataque inmediato, alrededor de 700 Hz y una octava grave de apoyo.",patch:{t1:"square",t2:"triangle",oct2:-1,det2:0,sub:.6,mix:.3,cut:700,res:4,fenv:3000,a:.005,d:.25,s:.5,r:.15}},
  Lead:{description:"Onda cuadrada a +9 cents y delay corto para una melodía que destaque.",patch:{t2:"square",det2:9,sub:0,mix:.4,cut:5000,res:3,fenv:3000,s:.7,r:.3,dly:.25,rev:.15,lfoD:.1}},
  Pad:{description:"Entrada de 800 ms y salida de 1,5 s con modulación lenta de filtro.",patch:{det2:14,sub:.1,cut:1800,res:1,fenv:600,a:.8,d:.5,s:.8,r:1.5,rev:.5,lfoD:.2,lfoT:"filtro",lfoR:.4}},
  Pluck:{description:"Ataque de 2 ms y caída corta para arpegios y notas percusivas.",patch:{t1:"triangle",t2:"square",oct2:1,det2:5,mix:.3,cut:2500,fenv:5000,a:.002,d:.25,s:0,r:.2,rev:.25}},
  Piano:{description:"Seno y triángulo con ataque suave y una cola breve.",patch:{t1:"sine",t2:"triangle",oct2:1,det2:0,sub:0,mix:.25,cut:6500,res:.7,fenv:2200,a:.004,d:.44,s:.28,r:.38,rev:.12}},
  Órgano:{description:"Armónicos sostenidos con vibrato y una envolvente muy corta.",patch:{t1:"sine",t2:"square",oct2:1,det2:0,sub:.28,mix:.26,cut:4600,a:.01,d:.08,s:.94,r:.12,lfoD:.08,lfoR:5.4}},
  Unísono:{description:"Tres osciladores y cinco voces con 26 cents de dispersión.",patch:{
    t1:"sawtooth",t2:"triangle",t3:"sine",oct3:-1,unison:5,spread:26,mix3:.23,cut:4600,det2:8,rev:.2
  }},
  Sucio:{description:"Distorsión, osciladores separados 25 cents y delay en paralelo.",patch:{det2:25,dist:.6,cut:2500,fenv:3000,dly:.15}}
};
const TRACK_COLORS = ["#b69aff","#75e7c6","#ffab93","#8cbcff","#e7d87f","#f69cce","#91daa0","#c2a9f8"];
const SOURCE_LIMIT = 32 * 1024 * 1024;
const PATCH_GROUPS = [
  ["Osciladores",[
    ["t1","Onda 1",WAVES],["t2","Onda 2",WAVES],["oct2","Octava osc. 2",-2,2,1," oct"],
    ["det2","Desafinación",-50,50,1," ct"],["mix","Mezcla osc. 1 y 2",0,1,.01,""],["sub","Suboscilador",0,1,.01,""]
  ]],
  ["Oscilador 3 y unísono",[
    ["t3","Onda 3",WAVES],["oct3","Octava osc. 3",-2,2,1," oct"],["det3","Desafinación osc. 3",-50,50,1," ct"],
    ["mix3","Mezcla osc. 3",0,1,.01,""],["unison","Voces unísono",1,7,1,""],["spread","Dispersión",0,40,1," ct"]
  ]],
  ["Filtro",[
    ["ft","Tipo de filtro",["lowpass","highpass","bandpass"]],["cut","Corte",40,16000,10," Hz"],
    ["res","Resonancia Q",.1,20,.1,""],["fenv","Envolvente",0,8000,50," Hz"]
  ]],
  ["Envolvente ADSR",[
    ["a","Ataque",.001,2,.001," s"],["d","Caída",.01,2,.01," s"],["s","Sostén",0,1,.01,""],["r","Liberación",.01,3,.01," s"]
  ]],
  ["Modulación y FX",[
    ["lfoT","Destino LFO",["pitch","filtro"]],["lfoR","Frecuencia LFO",.1,20,.1," Hz"],["lfoD","Profundidad LFO",0,1,.01,""],
    ["dist","Saturación",0,1,.01,""],["dtm","Tiempo de delay",.05,1,.01," s"],["dfb","Realimentación",0,.85,.01,""]
  ]]
];
const MIX_CONTROLS = [
  ["level","Nivel",-60,6,.5," dB"],["pan","Paneo",-100,100,1,""],["dly","Envío delay",0,1,.01,""],["rev","Envío reverb",0,1,.01,""]
];
const PATCH_RANGES = Object.fromEntries(PATCH_GROUPS.flatMap(([,fields]) => fields.map(field => [field[0],field.slice(2)])));
const friendly = {sawtooth:"Diente de sierra",square:"Cuadrada",sine:"Seno",triangle:"Triángulo",lowpass:"Paso bajo",
  highpass:"Paso alto",bandpass:"Paso banda",pitch:"Tono",filtro:"Filtro"};
function pattern(rows) {
  return Array.from({ length:rows },() => Array(32).fill(0));
}

function newLane(kind,preset,name) {
  return { id:crypto.randomUUID(),name,kind,preset,patch:{...INSTRUMENT,...INSTRUMENT_PRESETS[preset]?.patch},
    grid:pattern(kind === "drums" ? DRUMS.length : kind==="clip" ? 1 : NOTES.length), clips:[], level:-10,pan:0,dly:0,rev:0,
    mute:false,solo:false,octave:0,sample:"",sampleName:"" };
}

function newArrangement() {
  const percussion = newLane("drums","Osciladores","Batería");
  const lead = newLane("synth","Osciladores","Sintetizador");
  for (const i of [0,4,8,12]) percussion.grid[0][i] = 1;
  for (const i of [4,12]) percussion.grid[1][i] = 1;
  for (let i=0; i<16; i+=2) percussion.grid[3][i] = 1;
  for (const [note,step] of [[0,0],[2,3],[5,7],[7,10],[9,12]]) lead.grid[note][step] = 1;
  return { bpm:120,swing:0,steps:16,songBars:0,master:-4,tracks:[percussion,lead] };
}

function safePatch(input = {}) {
  const patch = {...INSTRUMENT};
  for (const [key,range] of Object.entries(PATCH_RANGES)) {
    patch[key] = Array.isArray(range[0]) ? permitted(input[key],range[0],patch[key]) : limit(input[key],range[0],range[1],patch[key]);
  }
  patch.loop = input.loop !== false;
  patch.root = limit(input.root,-12,12,0);
  return patch;
}

function safeArrangement(state = {}) {
  if (!Array.isArray(state.studio?.tracks) || !state.studio.tracks.length) {
    const model = newArrangement();
    const legacy = state.synth || {};
    model.bpm = limit(legacy.bpm,40,240,120);
    model.swing = limit(legacy.sw,0,.7,0);
    model.tracks[0].grid = legacyGrid(state.drums,model.tracks[0].grid);
    model.tracks[1].grid = legacyGrid(Array.isArray(state.melody) ? state.melody.slice().reverse() : null,model.tracks[1].grid);
    if (state.synth) {
      Object.assign(model.tracks[0],{ level:Math.max(-60,20*Math.log10(limit(legacy.dv,0,1,.8))) });
      Object.assign(model.tracks[1],{ patch:safePatch(legacy), dly:limit(legacy.dly,0,1,0),rev:limit(legacy.rev,0,1,0),
        octave:limit(state.oct,-2,2,0),level:Math.max(-60,20*Math.log10(limit(legacy.vol,0,1,.7))),
        kind:state.sample && legacy.smp ? "sample" : "synth",sample:typeof state.sample === "string" ? state.sample : "" });
    }
    return model;
  }
  const saved = state.studio;
  const seen = new Set();
  const tracks = saved.tracks.slice(0,8).map((entry,i) => {
    const track = entry && typeof entry === "object" ? entry : {};
    const kind = permitted(track.kind,["synth","sample","drums","clip"],"synth");
    const preset = permitted(track.preset,Object.keys(INSTRUMENT_PRESETS),"Osciladores");
    const result = newLane(kind,preset,typeof track.name === "string" ? track.name.slice(0,36) || "Pista " + (i+1) : "Pista " + (i+1));
    if (typeof track.id === "string" && /^[a-f0-9-]{36}$/u.test(track.id) && !seen.has(track.id)) result.id = track.id;
    seen.add(result.id);
    return {...result,patch:safePatch(track.patch||result.patch),grid:legacyGrid(track.grid,pattern(result.grid.length)),
      mute:track.mute === true,solo:track.solo === true,octave:limit(track.octave,-2,2,0),
      level:limit(track.level,-60,6,-10),pan:limit(track.pan,-100,100,0),
      dly:limit(track.dly,0,1,0),rev:limit(track.rev,0,1,0),
      clips:cleanClips(track.clips),
      sample:typeof track.sample === "string" && /^[a-f0-9-]{36}$/u.test(track.sample) ? track.sample : "",
      sampleName:typeof track.sampleName === "string" ? track.sampleName.slice(0,240) : ""};
  });
  return { bpm:limit(saved.bpm,40,240,120),swing:limit(saved.swing,0,.7,0),steps:saved.steps === 32 ? 32 : 16,
    songBars:Math.round(limit(saved.songBars,0,512,0)),
    master:limit(saved.master,-24,6,-4),tracks };
}

function cleanClips(clips){
  return (Array.isArray(clips)?clips:[]).slice(0,32).map(clip=>({
    start:Math.round(limit(clip?.start,0,2400,0)),
    steps:Math.round(limit(clip?.steps,1,2400,16)),
    from:limit(clip?.from,0,1200,0),
    to:clip?.to==null ? null : limit(clip.to,0,1200,0)
  }));
}

function totalSteps(data){
  const lead=60/data.bpm/4;
  return data.songBars ? Math.max(1,Math.min(data.songBars*16,Math.floor(300/lead))) : data.steps;
}

function playClip(context,channel,sample,when,seconds,clip){
  if(!sample)return;
  const from=Math.max(0,Math.min(sample.duration-.01,clip?.from||0));
  const to=Math.min(sample.duration,clip?.to??sample.duration);
  if(to-from<.01)return;
  const source=context.createBufferSource(),gain=context.createGain();
  const duration=Math.max(.008,seconds||to-from);
  source.buffer=sample;
  source.playbackRate.value=(to-from)/duration;
  gain.gain.setValueAtTime(0,when);
  gain.gain.linearRampToValueAtTime(.82,when+Math.min(.016,duration/4));
  gain.gain.setValueAtTime(.82,when+duration-Math.min(.022,duration/4));
  gain.gain.linearRampToValueAtTime(0,when+duration);
  source.connect(gain).connect(channel.input);
  source.start(when,from);
  source.stop(when+duration);
  source.onended=()=>{source.disconnect();gain.disconnect();};
}

function legacyGrid(source, fallback) {
  if (!Array.isArray(source)) return fallback;
  return fallback.map((row,y) => row.map((_,x) => source[y]?.[x] ? 1 : 0));
}

function noiseBuffer(context, duration, impulse = false) {
  const buffer = context.createBuffer(impulse ? 2 : 1,Math.ceil(context.sampleRate*duration),context.sampleRate);
  for (let channel=0; channel<buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1)*(impulse ? (1-i/data.length)**3 : 1);
  }
  return buffer;
}

function createChannel(context, output, reverb) {
  const input = context.createGain();
  const shape = context.createWaveShaper();
  const mix = context.createGain();
  const pan = context.createStereoPanner();
  const level = context.createGain();
  const delay = context.createDelay(1.1);
  const feedback = context.createGain();
  const send = context.createGain();
  const wet = context.createGain();
  const ambience = context.createGain();
  const effects = context.createGain();
  const dry = context.createGain();
  input.connect(shape).connect(mix).connect(pan).connect(level).connect(output);
  pan.connect(send).connect(delay).connect(wet).connect(level);
  delay.connect(feedback).connect(delay);
  pan.connect(ambience).connect(reverb).connect(effects).connect(output);
  // Reverb tail remains parallel to the channel and follows its mute/solo.
  input.connect(dry).connect(mix);
  return { context,input,shape,mix,pan,level,delay,feedback,send,wet,ambience,effects,dry,reverb };
}

function updateChannel(channel, track, arrangementSettings) {
  const {context} = channel;
  const active = !track.mute && (!arrangementSettings.tracks.some(item => item.solo) || track.solo);
  const gain = active ? DB(track.level + arrangementSettings.master) : 0;
  const time = Math.max(0,context.currentTime);
  const set = (param,value) => param.setTargetAtTime(value,time,.01);
  set(channel.level.gain,gain);
  set(channel.effects.gain,gain);
  set(channel.pan.pan,track.pan/100);
  set(channel.delay.delayTime,track.patch.dtm);
  set(channel.feedback.gain,track.patch.dfb);
  set(channel.send.gain,track.dly);
  set(channel.ambience.gain,track.rev);
  set(channel.mix.gain,1);
  set(channel.dry.gain,track.patch.dist ? 0 : 1);
  const shape = channel.shape;
  const drive = track.patch.dist;
  if (channel.drive !== drive) {
    channel.drive = drive;
    if (drive) {
      const k = 1 + drive*14;
      shape.curve = Float32Array.from({ length:1024 },(_,i) => Math.tanh((i/511.5-1)*k)/Math.tanh(k));
    } else shape.curve = new Float32Array([0,0,0]);
  }
}

function disconnectChannel(channel) {
  for (const node of Object.values(channel)) if (node && typeof node.disconnect === "function") node.disconnect();
}

function noteFrequency(note,octave,tuning) {
  return tuning * 2 ** ((note + octave*12 - 9)/12);
}

function synthNote(context, track, channel, note, start, length, tuning, sample) {
  const patch = track.patch;
  if (track.kind === "sample" && !sample) return () => {};
  const pitch = noteFrequency(note,track.octave,tuning);
  const envelope = context.createGain();
  const filter = context.createBiquadFilter();
  const sources = [];
  const nodes = [filter,envelope];
  filter.type = patch.ft;
  filter.Q.value = patch.res;
  filter.frequency.setValueAtTime(Math.min(context.sampleRate/2-1,patch.cut + patch.fenv),start);
  filter.frequency.exponentialRampToValueAtTime(Math.min(context.sampleRate/2-1,patch.cut),start+patch.a+patch.d);
  filter.connect(envelope).connect(channel.input);
  const addOsc = (type,frequency,volume,detune = 0) => {
    if (!volume) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    gain.gain.value = volume;
    osc.connect(gain).connect(filter);
    osc.start(start);
    sources.push(osc);
    nodes.push(gain);
  };
  if (track.kind === "sample") {
    const source = context.createBufferSource();
    source.buffer = sample;
    source.loop = patch.loop;
    source.playbackRate.value = pitch/noteFrequency(patch.root,0,tuning);
    source.connect(filter);
    source.start(start);
    sources.push(source);
  } else {
    const count=Math.round(patch.unison||1);
    const third=patch.mix3||0;
    const sum=Math.max(1,patch.mix+third);
    for(let i=0;i<count;i++){
      const spread=count>1?(i/(count-1)-.5)*patch.spread:0;
      const attenuation=1/Math.sqrt(count);
      addOsc(patch.t1,pitch,Math.max(0,1-patch.mix-third)*attenuation,spread);
      addOsc(patch.t2,pitch*2**patch.oct2,patch.mix/sum*attenuation,patch.det2+spread);
      addOsc(patch.t3,pitch*2**patch.oct3,third/sum*attenuation,patch.det3+spread);
    }
    addOsc("sine",pitch/2,patch.sub);
  }
  if (patch.lfoD) {
    const lfo = context.createOscillator();
    const amount = context.createGain();
    lfo.frequency.value = patch.lfoR;
    amount.gain.value = patch.lfoD*(patch.lfoT === "pitch" ? 90 : 1300);
    lfo.connect(amount);
    if (patch.lfoT === "pitch") sources.forEach(source => amount.connect(source.detune));
    else amount.connect(filter.detune);
    lfo.start(start);
    sources.push(lfo);
    nodes.push(amount);
  }
  envelope.gain.setValueAtTime(0,start);
  envelope.gain.linearRampToValueAtTime(.32,start+patch.a);
  envelope.gain.linearRampToValueAtTime(.32*patch.s,start+patch.a+patch.d);
  let remaining = sources.length;
  for (const source of sources) source.onended = () => {
    source.disconnect();
    if (--remaining === 0) for (const node of nodes) node.disconnect();
  };
  let released = false;
  const release = time => {
    if (released) return;
    released = true;
    const at = Math.max(start,time);
    if (envelope.gain.cancelAndHoldAtTime) envelope.gain.cancelAndHoldAtTime(at);
    else envelope.gain.cancelScheduledValues(at);
    envelope.gain.setTargetAtTime(0,at,Math.max(.008,patch.r/5));
    sources.forEach(source => { try { source.stop(at+patch.r+.04); } catch {} });
  };
  if (length) release(start+length);
  return release;
}

function hitDrum(context, index, start, channel, noise) {
  const layer = (source,level,time,seconds,filter) => {
    const gain = context.createGain();
    gain.gain.setValueAtTime(level,time);
    gain.gain.exponentialRampToValueAtTime(.0001,time+seconds);
    source.connect(filter || gain);
    if (filter) filter.connect(gain);
    gain.connect(channel.input);
    source.start(time);
    source.stop(time+seconds);
    source.onended = () => { source.disconnect(); gain.disconnect(); filter?.disconnect(); };
  };
  const tone = (frequency,end,level,seconds) => {
    const osc = context.createOscillator();
    osc.frequency.setValueAtTime(frequency,start);
    osc.frequency.exponentialRampToValueAtTime(end,start+seconds/2);
    layer(osc,level,start,seconds);
  };
  const brush = (type,frequency,level,seconds,offset = 0) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type; filter.frequency.value = frequency;
    layer(source,level,start+offset,seconds,filter);
  };
  if (index === 0) tone(150,39,.92,.34);
  if (index === 1) { tone(185,96,.32,.13); brush("highpass",1400,.7,.19); }
  if (index === 2) for (const offset of [0,.011,.023]) brush("bandpass",1300,.47,offset ? .09 : .18,offset);
  if (index === 3) brush("highpass",7100,.48,.07);
  if (index === 4) brush("highpass",6750,.43,.31);
  if (index === 5) tone(230,72,.54,.26);
}

function playStep(context,data,index,time,channelFor,noise,tuning,sounds) {
  const beat = 60/data.bpm/4;
  const at = time + (index % 2 ? data.swing * beat : 0);
  for (const track of data.tracks) {
    if (track.mute || (data.tracks.some(item => item.solo) && !track.solo)) continue;
    if(track.kind==="clip"){
      for (const clip of track.clips.filter(item=>item.start===index)){
        playClip(context,channelFor(track),sounds.get(track.id),at,(Math.min(clip.steps,totalSteps(data)-index))*beat,clip);
      }
      continue;
    }
    const selected = track.grid.flatMap((row,note) => row[index%data.steps] ? [note] : []);
    if (!selected.length) continue;
    const channel = channelFor(track);
    for (const note of selected) {
      if (track.kind === "drums") hitDrum(context,note,at,channel,noise);
      else synthNote(context,track,channel,note,at,beat*.8,tuning,sounds.get(track.id));
    }
  }
}

export { DRUMS, INSTRUMENT, INSTRUMENT_PRESETS, KEYS, MIX_CONTROLS, NOTES, PATCH_GROUPS, SOURCE_LIMIT, TRACK_COLORS, createChannel, disconnectChannel, friendly, hitDrum, legacyGrid, newArrangement, newLane, noiseBuffer, pattern, playClip, playStep, safeArrangement, synthNote, totalSteps, updateChannel };
