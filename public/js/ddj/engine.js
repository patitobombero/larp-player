import { beatError, gridReading, PhaseLock, startOnBeat, SyncClock, syncRateLimits, tempoScale } from "./sync-controller.js";
import { au as homePlayer, chain, ctx, readyAudio } from "../audio.js";
import { DB, limit } from "../common.js";
import { soundingKey } from "./harmony.js";
import { roomImpulse, spatialPlan, StereoSpace } from "./spatial.js";
import { beatAt, buildGrid, DECKS, markerAt, MAX_ANALYSIS_BYTES, MAX_ANALYSIS_SECONDS, MIX_EQ, mixerSettings, mod,
  quantized, settings, sweepFrequency, timeAt, trackData } from "./data.js";

const floor=(number,max)=>Math.max(0,Math.min(max,number));
const gate=(node,value,context)=>node.setTargetAtTime(value,context.currentTime,.015);
const pitchModules=new WeakMap();
const ANALYSIS_RATE=22050;
const PLAYBACK_RATE=44100;
const CHANGEOVER=.014;

async function analysisBuffer(buffer){
  if(buffer.sampleRate===ANALYSIS_RATE)return buffer;
  const context=new OfflineAudioContext(Math.min(2,buffer.numberOfChannels),Math.ceil(buffer.duration*ANALYSIS_RATE),ANALYSIS_RATE);
  const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();
  return context.startRendering();
}

function waitForMetadata(element,signal){
  if(element.readyState>=1) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error("La pista tardó demasiado en responder.")),20_000);
    const finish=error=>{
      clearTimeout(timer);
      element.removeEventListener("loadedmetadata",loaded);
      element.removeEventListener("error",failed);
      signal.removeEventListener("abort",cancel);
      if(error)reject(error);else resolve();
    };
    const loaded=()=>finish();
    const failed=()=>finish(new Error("El navegador no puede abrir el formato de esta pista."));
    const cancel=()=>finish(new DOMException("Carga cancelada","AbortError"));
    element.addEventListener("loadedmetadata",loaded,{once:true});
    element.addEventListener("error",failed,{once:true});
    signal.addEventListener("abort",cancel,{once:true});
  });
}

function analyzeSignal(buffer,signal){
  const process=new Worker(new URL("./analysis-worker.js",import.meta.url),{type:"module"});
  return new Promise((resolve,reject)=>{
    const finish=(error,value)=>{
      signal?.removeEventListener("abort",abort);
      process.terminate();
      if(error)reject(error);else resolve(value);
    };
    const abort=()=>finish(new DOMException("Análisis cancelado","AbortError"));
    signal?.addEventListener("abort",abort,{once:true});
    process.onerror=()=>finish(new Error("No se pudo iniciar el analizador."));
    process.onmessage=event=>event.data.error ? finish(new Error(event.data.error)) : finish(null,event.data);
    const samples=buffer.getChannelData(0).slice();
    const right=buffer.numberOfChannels>1?buffer.getChannelData(1).slice():null;
    process.postMessage({samples,right,rate:buffer.sampleRate},right?[samples.buffer,right.buffer]:[samples.buffer]);
  });
}

function filter(context,type,frequency){
  const node=context.createBiquadFilter();
  node.type=type;
  node.frequency.value=frequency;
  return node;
}

function stereoMeter(context,input){
  const split=context.createChannelSplitter(2);
  const scratch=new Float32Array(4096);
  input.connect(split);
  const taps=[0,1].map(side=>{
    const meter=context.createAnalyser();
    meter.fftSize=scratch.length;
    split.connect(meter,side);
    return meter;
  });
  let peak=0,clipUntil=-Infinity;
  return ()=>{
    if(context.state!=="running")return {peak:0,clip:false};
    peak=0;
    for(const meter of taps){
      meter.getFloatTimeDomainData(scratch);
      for(const sample of scratch)peak=Math.max(peak,Math.abs(sample));
    }
    if(peak>=1)clipUntil=context.currentTime+.7;
    return {peak,clip:context.currentTime<clipUntil};
  };
}

function impulse(context){
  const buffer=context.createBuffer(2,Math.ceil(context.sampleRate*1.75),context.sampleRate);
  for(let i=0;i<2;i++){
    const channel=buffer.getChannelData(i);
    for(let step=0;step<channel.length;step++) channel[step]=(Math.random()*2-1)*(1-step/channel.length)**3;
  }
  return buffer;
}

class DeckChannel {
  constructor(context,destination,prelisten,ambience,room){
    this.context=context;
    this.input=context.createGain();
    this.pitchBus=context.createGain();
    for(const [name,type,freq] of MIX_EQ)this[name]=filter(context,type,freq);
    this.mid.Q.value=.8;
    this.sweep=filter(context,"lowpass",1000);
    this.filterDry=context.createGain();
    this.filterWet=context.createGain();
    this.filterWet.gain.value=0;
    this.sweep.Q.value=-3.0103;
    this.pan=context.createStereoPanner();
    this.space=new StereoSpace(context,room);
    this.wet=context.createGain();
    this.echo=context.createDelay(2);
    this.feedback=context.createGain();
    this.echoLevel=context.createGain();
    this.echoLevel.gain.value=0;
    this.reverb=context.createConvolver();
    this.reverb.buffer=ambience;
    this.reverbLevel=context.createGain();
    this.reverbLevel.gain.value=0;
    this.sum=context.createGain();
    this.output=context.createGain();
    this.monitor=context.createGain();
    this.input.connect(this.pitchBus).connect(this.low).connect(this.mid).connect(this.high);
    this.high.connect(this.filterDry).connect(this.space.input);
    this.high.connect(this.sweep).connect(this.filterWet).connect(this.space.input);
    this.space.output.connect(this.pan);
    this.pan.connect(this.sum);
    this.pan.connect(this.wet);
    this.wet.connect(this.echo).connect(this.echoLevel).connect(this.sum);
    this.echo.connect(this.feedback).connect(this.echo);
    this.wet.connect(this.reverb).connect(this.reverbLevel).connect(this.sum);
    this.sum.connect(this.output).connect(destination);
    this.readBeforeFader=stereoMeter(context,this.sum);
    this.readAfterFader=stereoMeter(context,this.output);
    this.sum.connect(this.monitor).connect(prelisten);
    this.monitor.gain.value=0;
    this.feedback.gain.value=.33;
  }
  async enablePitch(){
    if(this.shift)return true;
    const context=this.context;
    if(this.pitchFailed||!context.audioWorklet||!window.AudioWorkletNode)return false;
    if(!pitchModules.has(context)) pitchModules.set(context,context.audioWorklet.addModule(new URL("./pitch-worklet.js",import.meta.url)));
    try{
      await pitchModules.get(context);
      if(this.shift)return true;
      if(context.state==="closed")return false;
      const node=new AudioWorkletNode(context,"larp-shift",{outputChannelCount:[2]});
      node.onprocessorerror=()=>{
        if(this.shift!==node)return;
        this.input.disconnect(node);node.disconnect();this.input.connect(this.pitchBus);
        this.shift=null;this.pitchFailed=true;this.onPitchLost?.();
      };
      this.input.disconnect(this.pitchBus);
      this.input.connect(node).connect(this.pitchBus);
      this.shift=node;
      return true;
    }catch{return false;}
  }
  apply(mix,weight,bpm,normalization){
    const c=this.context;
    gate(this.pitchBus.gain,DB(mix.trim+normalization),c);
    gate(this.low.gain,mix.low,c);
    gate(this.mid.gain,mix.mid,c);
    gate(this.high.gain,mix.high,c);
    const filtered=Math.abs(mix.filter)>=.015;
    if(filtered)this.sweep.type=mix.filter<0?"lowpass":"highpass";
    gate(this.filterDry.gain,filtered?0:1,c);
    gate(this.filterWet.gain,filtered?1:0,c);
    gate(this.sweep.frequency,sweepFrequency(mix.filter),c);
    gate(this.wet.gain,mix.fx==="off"?0:mix.wet,c);
    gate(this.echoLevel.gain,mix.fx==="echo"?.8:0,c);
    gate(this.reverbLevel.gain,mix.fx==="reverb"?.75:0,c);
    this.setEchoTempo(bpm);
    gate(this.output.gain,mix.mute?0:mix.level*weight,c);
  }
  applySpace(state,automatic){
    const smooth=automatic?.30:.055;
    this.space.apply(state,smooth);
    this.pan.pan.setTargetAtTime(state.pan,this.context.currentTime,smooth);
  }
  setEchoTempo(bpm){
    if(Math.abs(bpm-(this.echoBpm||0))<.05)return;
    this.echoBpm=bpm;
    gate(this.echo.delayTime,Math.min(1.45,45/bpm),this.context);
  }
  pitch(amount,aligned=false,protect=true){
    if(!this.shift)return;
    if(this.pitchAmount!==amount)gate(this.shift.parameters.get("semitones"),limit(amount,-24,24,0),this.context);
    if(this.pitchAligned!==aligned)this.shift.parameters.get("aligned").setValueAtTime(Number(aligned),this.context.currentTime);
    if(this.protect!==protect)this.shift.parameters.get("protect").setValueAtTime(Number(protect),this.context.currentTime);
    this.protect=protect;
    this.pitchAmount=amount;
    this.pitchAligned=aligned;
  }
}

export class Deck {
  constructor(id,mixer){
    this.id=id;this.mixer=mixer;
    this.opts=settings();
    this.reset();
  }
  reset(){
    this.loading?.abort();
    this.halt();
    this.detach();
    this.track=null;this.metadata=trackData();this.cues=Array(8).fill(null);
    this.duration=0;this.cue=0;this.rate=1;this.pitch=0;this.shift=0;this.manualRate=1;
    this.analysis=null;this.buffer=null;this.reversed=null;this.preparedPlayback=false;
    this.phaseLock=new PhaseLock();
    this.syncScale=0;this.syncState="";this.syncError=null;
    this.loop={in:null,out:null,on:false};this.slipClock=null;this.reverse=false;this.sync=false;
    this.streamPos=0;this.loading=null;this.cuePreview=false;this.cueToken=null;this.selectedBeat=4;
    this.updatePitch();
  }
  detach(){
    this.node?.disconnect();
    this.node=null;
    if(this.media){
      this.media.pause();
      this.media.removeAttribute("src");
      this.media.load();
    }
    this.media=null;
  }
  mediaFor(track){
    const element=new Audio();
    element.preload="metadata";
    element.src=track.url;
    element.addEventListener("ended",()=>{
      if(this.media===element&&this.mode==="media")this.ended();
    });
    return element;
  }
  get playing(){return Boolean(this.mode||this.scratch);}
  grid(){
    if(this.gridInput!==this.metadata.grid){this.gridInput=this.metadata.grid;this.beatGrid=buildGrid(this.gridInput);}
    return this.beatGrid;
  }
  get readyGrid(){return this.metadata.grid.length>0;}
  baseBpm(){return this.readyGrid?markerAt(this.grid(),this.position()).segmentBpm:0;}
  position(){
    if(this.scratch)return this.scratch.at;
    if(this.mode==="media")return this.media.currentTime;
    if(!this.anchor||!this.mode)return this.streamPos||0;
    const elapsed=Math.max(0,this.mixer.context.currentTime-this.anchor.at);
    const distance=this.anchor.curve ?
      elapsed*this.anchor.rate*(1-.45*Math.min(1,elapsed/this.anchor.curve)) : elapsed*this.anchor.rate;
    const absolute=this.anchor.position+distance*this.anchor.direction;
    if(this.mode==="loop"&&this.loop.on){
      const period=this.loop.out-this.loop.in;
      return this.anchor.direction<0 ? this.loop.out-mod(this.loop.out-absolute,period) : this.loop.in+mod(absolute-this.loop.in,period);
    }
    return floor(absolute,this.duration);
  }
  bounded(time){return floor(time,Math.max(0,this.duration-.015));}
  quantize(time){
    return this.opts.quantize&&this.readyGrid?quantized(this.grid(),time,this.opts.quantizeBeat,this.duration):floor(time,this.duration);
  }
  async load(track,data={},analyze=true){
    if(this.playing&&this.opts.loadLock)throw new Error("Load Lock está activo. Detén el deck antes de cargar otra pista.");
    if(!track?.url)throw new Error("Selecciona una pista disponible en tu biblioteca.");
    this.reset();
    const job=new AbortController();
    this.loading=job;
    this.track=track;
    this.media=this.mediaFor(track);
    try{
      await waitForMetadata(this.media,job.signal);
      if(this.loading!==job)return;
      this.duration=this.media.duration;
      if(!Number.isFinite(this.duration)||this.duration<=0)throw new Error("La pista no tiene una duración válida.");
      this.setMetadata(data);
      if(analyze&&this.canAnalyze()){
        try{await this.analyze(job.signal);}
        catch(error){if(error.name==="AbortError")throw error;this.onNotice?.("El análisis automático falló. Puedes editar el BPM o importar un XML.");}
      }
      if(this.loading===job){
        if(!this.preparedPlayback)this.media.preload="auto";
        this.cueStart();
      }
    }catch(error){
      if(this.loading===job){this.reset();throw error;}
    }finally{if(this.loading===job)this.loading=null;}
  }
  canAnalyze(){return this.track&&this.track.size<=MAX_ANALYSIS_BYTES&&this.duration<=MAX_ANALYSIS_SECONDS;}
  async analyze(signal){
    const track=this.track;
    if(!this.canAnalyze())throw new Error("El análisis y el scratch admiten pistas de hasta 64 MiB y 12 minutos. Carga un XML o marca el BPM para sincronizar esta pista.");
    if(this.buffer&&this.analysis)return this.analysis;
    const reader=track.file ? await track.file.arrayBuffer() : await (async()=>{
      const response=await fetch(track.url,{signal});
      if(!response.ok)throw new Error("No se pudo leer el archivo para analizarlo.");
      return response.arrayBuffer();
    })();
    if(signal?.aborted||track!==this.track)return;
    const reservation=this.mixer.reservePlayback(this);
    let analysis;
    try{
      const context=new OfflineAudioContext(1,1,reservation?PLAYBACK_RATE:ANALYSIS_RATE);
      const buffer=await context.decodeAudioData(reader);
      if(signal?.aborted||track!==this.track)return;
      const downsampled=await analysisBuffer(buffer);
      if(signal?.aborted||track!==this.track)return;
      analysis=await analyzeSignal(downsampled,signal);
      if(signal?.aborted||track!==this.track)return;
      this.preparedPlayback=Boolean(reservation&&buffer.numberOfChannels<=2);
      this.buffer=this.preparedPlayback?buffer:downsampled;
    }finally{if(reservation)this.mixer.releasePlayback(reservation);}
    this.analysis=analysis;
    this.metadata.loudness=analysis.loudness;this.metadata.peak=analysis.peak;
    if(!this.metadata.key&&analysis.harmony?.key?.confidence>=.24){
      this.metadata.key=soundingKey(analysis.harmony.key,0).split(" · ")[0];
    }
    if(!this.metadata.grid.length&&analysis.bpm&&analysis.firstBeat!==null){
      this.metadata.grid=analysis.grid;
      this.metadata.firstBeat=analysis.firstBeat;
    }
    this.onChanged?.();
    return analysis;
  }
  setMetadata(data){
    this.metadata=trackData(data);
    this.cues=this.opts.hotLoad?structuredClone(this.metadata.cues):Array(8).fill(null);
    if(this.metadata.memory!==null)this.cue=this.bounded(this.metadata.memory);
  }
  cueStart(){
    let time=0;
    if(this.opts.autoCue){
      const manual=this.opts.cueLevel==="memory"?this.metadata.memory:null;
      const signal=this.analysis?.signals[this.opts.cueFloor]??this.metadata.firstSignal??0;
      const grid=this.metadata.firstBeat??this.analysis?.firstBeat??this.metadata.grid[0]?.time;
      time=manual ?? (grid!=null&&grid>=signal-.03?grid:signal);
    }
    this.cue=this.bounded(time);
    this.seek(this.cue);
  }
  ensureSource(){
    const channel=this.mixer.channels[this.id];
    if(!this.node){
      this.node=this.mixer.context.createMediaElementSource(this.media);
      this.node.connect(channel.input);
    }
    return channel;
  }
  stopSource(fade=0){
    const source=this.source,gain=this.fxGain;
    this.source=null;this.fxGain=null;
    if(!source)return;
    const disconnect=()=>{source.disconnect();gain?.disconnect();};
    if(fade&&gain&&this.mixer.context.state==="running"){
      const now=this.mixer.context.currentTime;
      if(gain.gain.cancelAndHoldAtTime)gain.gain.cancelAndHoldAtTime(now);
      else {const level=gain.gain.value;gain.gain.cancelScheduledValues(now);gain.gain.setValueAtTime(level,now);}
      gain.gain.linearRampToValueAtTime(0,now+fade);
      source.onended=disconnect;
      try{source.stop(now+fade);}catch{disconnect();}
    }else{
      source.onended=null;
      try{source.stop();}catch{}
      disconnect();
    }
  }
  halt(fade=0){
    const position=this.position();
    if(this.media)this.media.pause();
    this.stopSource(fade);
    this.mode=null;
    this.anchor=null;
    this.scratch=null;
    this.streamPos=position;
    this.bend=0;
    this.updatePitch();
    return position;
  }
  async start(time=this.position(),fade=0,align=!this.playing&&!this.cuePreview){
    if(!this.track||!this.duration||this.loading)throw new Error("Carga una pista antes de reproducir.");
    const track=this.track;
    await this.mixer.ensure();
    if(track!==this.track)return;
    const position=this.bounded(this.sync&&align?this.mixer.syncedStart(this,time):time);
    const effects=this.reverse||this.loop.on;
    const useBuffer=this.buffer&&(effects||this.preparedPlayback&&(!this.opts.masterTempo||this.mixer.channels[this.id].shift));
    const overlap=Boolean(useBuffer&&this.source);
    const transition=overlap?Math.max(fade,CHANGEOVER):fade;
    this.halt(transition);
    if(useBuffer){
      const actual=this.loop.on&&(position<this.loop.in||position>=this.loop.out) ?
        (this.reverse?this.loop.out-.004:this.loop.in) : position;
      this.startBuffer(actual,this.reverse?-1:1,this.loop.on?"loop":this.reverse?"reverse":"pcm",transition);
    }else{
      const channel=this.ensureSource();
      this.reverse=false;
      this.mode="media";this.streamPos=position;
      if(Math.abs(this.media.currentTime-position)>.009)this.media.currentTime=position;
      this.media.playbackRate=this.rate;
      this.updatePitch();
      if(fade) {
        channel.input.gain.setValueAtTime(0,this.mixer.context.currentTime);
        channel.input.gain.linearRampToValueAtTime(1,this.mixer.context.currentTime+fade);
      } else channel.input.gain.setValueAtTime(1,this.mixer.context.currentTime);
      try{await this.media.play();}
      catch(error){if(this.track===track&&this.mode==="media")this.halt();if(error.name!=="AbortError")throw error;}
    }
    this.onChanged?.();
  }
  getReverse(){
    if(!this.reversed){
      const source=this.buffer;
      const copy=this.mixer.context.createBuffer(source.numberOfChannels,source.length,source.sampleRate);
      for(let i=0;i<source.numberOfChannels;i++){
        const from=source.getChannelData(i),to=copy.getChannelData(i);
        for(let j=0;j<from.length;j++)to[j]=from[from.length-j-1];
      }
      this.reversed=copy;
    }
    return this.reversed;
  }
  startBuffer(position,direction,mode,fade=0,curve=0,speed=this.rate){
    if(!this.buffer)return;
    const c=this.mixer.context;
    const channel=this.mixer.channels[this.id];
    channel.input.gain.setValueAtTime(1,c.currentTime);
    const source=c.createBufferSource();
    source.buffer=direction<0?this.getReverse():this.buffer;
    source.playbackRate.value=speed;
    const gain=c.createGain();
    const now=c.currentTime;
    gain.gain.setValueAtTime(fade?0:1,now);
    if(fade)gain.gain.linearRampToValueAtTime(1,now+fade);
    source.connect(gain).connect(channel.input);
    if(mode==="loop"){
      source.loop=true;
      source.loopStart=direction<0?this.buffer.duration-this.loop.out:this.loop.in;
      source.loopEnd=direction<0?this.buffer.duration-this.loop.in:this.loop.out;
    }
    this.source=source;this.fxGain=gain;
    this.mode=mode;
    this.anchor={position,at:now,direction,rate:speed,curve};
    this.updatePitch();
    const offset=direction<0?source.buffer.duration-position:position;
    source.start(now,Math.max(0,Math.min(source.buffer.duration-.005,offset)));
    if(curve){
      source.playbackRate.linearRampToValueAtTime(Math.max(.05,speed*.1),now+curve);
      gain.gain.setTargetAtTime(0,now+curve*.87,.045);
      source.stop(now+curve);
    }
    source.onended=()=>{
      if(this.source!==source)return;
      if(mode==="brake"||mode==="backspin"){
        const resume=mode==="backspin"?this.trickReturn:null;
        const at=this.position();
        this.halt();
        if(resume!==null){this.reverse=resume.reverse;this.start(this.slipPosition()??at,this.opts.release).catch(error=>this.onNotice?.(error.message));}
        else{this.streamPos=at;this.slipClock=null;}
      }else this.ended();
      this.onChanged?.();
    };
  }
  ended(){
    const end=this.reverse?0:this.duration;
    this.halt();
    this.streamPos=end;
    this.reverse=false;
    this.slipClock=null;
    this.onChanged?.();
    if(this.opts.playMode==="continue"&&end>0)this.onNext?.(this);
  }
  async togglePlay(){
    if(this.playing){this.halt();this.slipClock=null;this.onChanged?.();return;}
    return this.start(this.position()>=this.duration-.02?this.cue:this.position());
  }
  seek(time){
    this.phaseLock.reset(this.mixer.context?.currentTime);
    if(this.sync)this.syncState="aligning";
    const at=this.bounded(this.sync&&this.clockReady&&this.mixer.syncSource!==this.id?this.mixer.syncedStart(this,time):time);
    this.streamPos=at;
    if(this.playing&&this.mode!=="media"&&!this.scratch)return this.start(at,.009,this.sync&&this.mixer.syncSource!==this.id);
    if(this.media&&this.duration)this.media.currentTime=at;
    this.onChanged?.();
  }
  async cuePress(){
    if(this.playing){this.halt();this.slipClock=null;return this.seek(this.cue);}
    if(this.duration)await this.start(this.cue,0,false);
  }
  cueRelease(){
    if(this.cuePreview){this.cuePreview=false;this.halt();this.seek(this.cue);}
  }
  saveCue(){
    if(!this.track)return;
    this.cue=this.quantize(this.position());
    this.metadata.memory=this.cue;
    this.onChanged?.();
  }
  bump(direction){
    if(!this.readyGrid)throw new Error("Configura el beatgrid para saltar por pulsos.");
    const grid=this.grid();
    let next=timeAt(grid,beatAt(grid,this.position())+direction*this.opts.jump);
    if(this.opts.quantize)next=this.quantize(next);
    return this.seek(next);
  }
  armSlip(){
    if(this.opts.slip&&this.playing&&!this.slipClock)this.slipClock={at:this.mixer.context.currentTime,position:this.position(),rate:this.rate};
  }
  slipPosition(){
    if(!this.slipClock)return null;
    const clock=this.slipClock;this.slipClock=null;
    return this.bounded(clock.position+(this.mixer.context.currentTime-clock.at)*clock.rate);
  }
  async setLoop(from,to){
    if(to-from<.045||!this.duration)throw new Error("Selecciona un inicio y fin válidos para el loop.");
    const current=this.position();
    this.armSlip();
    this.loop={in:from,out:to,on:true};
    const next=current>=from&&current<to?current:from;
    if(this.playing&&this.buffer) await this.start(next);
    else await this.seek(next);
  }
  beatLoop(beats,from=this.quantize(this.position())){
    if(!this.readyGrid)throw new Error("Configura el BPM o importa un beatgrid para hacer un loop por pulsos.");
    const grid=this.grid();
    this.selectedBeat=beats;
    const end=Math.min(this.duration,timeAt(grid,beatAt(grid,from)+beats));
    return this.setLoop(from,end);
  }
  async exitLoop(){
    if(!this.loop.on)return;
    const current=this.position();
    this.loop.on=false;
    await this.seek(this.slipPosition()??current);
  }
  async toggleReverse(){
    if(!this.buffer)throw new Error("Reversal requiere una pista que se pueda analizar.");
    const at=this.position();
    const active=this.playing;
    if(!this.reverse)this.armSlip();
    this.reverse=!this.reverse;
    const place=this.reverse?at:this.slipPosition()??at;
    if(active)await this.start(place);
    else this.streamPos=place;
  }
  async stunt(mode){
    if(!this.playing||!this.buffer)throw new Error("Reproduce una pista analizada antes de aplicar este efecto.");
    const at=this.position();
    const remembered=this.reverse;
    if(mode==="backspin")this.armSlip();
    this.trickReturn={reverse:remembered};
    this.halt();
    this.startBuffer(at,mode==="backspin"?-1:remembered?-1:1,mode,.01,
      mode==="backspin"?.7:Math.max(.12,this.opts.touch||.55),mode==="backspin"?2.1:this.rate);
  }
  beginScratch(){
    if(!this.buffer)throw new Error("El modo Vinyl requiere una pista que se pueda analizar. Usa CDJ para empujar el tempo.");
    const active=this.playing,at=this.position();
    this.armSlip();
    this.halt();
    this.scratch={at,active,last:0,touch:performance.now()};
    if(active&&this.opts.touch>.05){
      this.grain(at,this.reverse?-1:1,this.rate,Math.min(this.opts.touch,.45));
    }
  }
  grain(at,direction,speed,length=.085){
    const context=this.mixer.context;
    const channel=this.mixer.channels[this.id];
    const source=context.createBufferSource();const gain=context.createGain();
    const now=context.currentTime;
    source.buffer=direction<0?this.getReverse():this.buffer;
    source.playbackRate.value=speed;
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(.85,now+.008);
    gain.gain.linearRampToValueAtTime(0,now+length);
    source.connect(gain).connect(channel.input);
    source.start(now,Math.max(0,Math.min(source.buffer.duration-.007,direction<0?source.buffer.duration-at:at)));
    source.stop(now+length+.004);
    source.onended=()=>{source.disconnect();gain.disconnect();};
  }
  scratchBy(degrees){
    if(!this.scratch)return;
    const now=performance.now();
    const before=this.scratch.at;
    const distance=degrees*.0035*(11-this.opts.jogAdjust)/6;
    this.scratch.at=this.bounded(before+distance);
    const elapsed=now-this.scratch.last;
    if(elapsed>28&&Math.abs(distance)>.001){
      this.grain(before,distance<0?-1:1,Math.max(.28,Math.min(4,Math.abs(distance)/(.001*Math.min(100,elapsed||35)))));
      this.scratch.last=now;
    }
  }
  endScratch(){
    if(!this.scratch)return;
    const scratch=this.scratch;
    const at=this.slipPosition()??scratch.at;
    this.scratch=null;this.streamPos=at;
    if(scratch.active)return this.start(at,this.opts.release);
    return this.seek(at);
  }
  setRate(value,base=false){
    const rate=limit(value,.25,2,1);
    if(Math.abs(rate-this.rate)<.00015)return;
    if(this.anchor&&this.mode!=="brake"&&this.mode!=="backspin"){
      const at=this.position();
      this.anchor={...this.anchor,position:at,at:this.mixer.context.currentTime,rate};
      this.source?.playbackRate.setValueAtTime(rate,this.mixer.context.currentTime);
    }
    this.rate=rate;
    if(this.media)this.media.playbackRate=rate;
    this.updatePitch();
    if(base)this.pitch=(rate-1)*100;
  }
  manualPitch(percent){
    const next=limit(percent,-Math.min(75,this.opts.tempoRange),this.opts.tempoRange,0);
    if(this.sync&&this.readyGrid&&this.mixer.syncSource!==this.id)return;
    this.pitch=next;
    this.manualRate=1+next/100;
    this.setRate(this.manualRate);
    this.mixer.tickSync();
  }
  updatePitch(){
    if(this.media&&!this.mixer.channels)this.media.preservesPitch=this.opts.masterTempo;
    this.mixer.applyPitch();
  }
  pitchAmount(shared){
    const compensation=this.mode&&(shared||this.mode!=="media")&&this.opts.masterTempo ? -12*Math.log2(this.rate) : 0;
    return this.shift+compensation;
  }
  soundingShift(){return this.shift+(this.opts.masterTempo?0:12*Math.log2(this.rate));}
  async setKey(semitones){
    await this.mixer.ensure();
    if(!await this.mixer.channels[this.id].enablePitch())throw new Error("Este navegador no ofrece el procesador de tono independiente.");
    this.shift=Math.round(limit(semitones,-12,12,0));this.updatePitch();
  }
  tick(){
    if(this.mode==="media"&&this.loop.on&&!this.media.seeking&&this.position()>=this.loop.out-.017){
      const overshoot=Math.max(0,this.position()-this.loop.out);
      this.media.currentTime=this.loop.in+overshoot;
    }
  }
  get holding(){return Boolean(this.bend||this.scratch||this.reverse||this.cuePreview||this.mode==="brake"||this.mode==="backspin");}
  get clockReady(){return this.playing&&!this.holding&&(this.mode!=="media"||(this.media.readyState>=2&&!this.media.seeking&&!this.media.paused));}
  followSync(time,bpm,beat){
    if(this.holding){this.phaseLock.reset(time);this.syncError=null;this.syncState="hold";return;}
    const native=gridReading(this.grid(),this.position(),this.syncScale);
    const required=bpm/native.bpm;
    const [low,high]=syncRateLimits;
    const delta=beatError(beat,native.beat);
    this.syncError=this.clockReady&&required>=low-1e-7&&required<=high+1e-7?delta*60000/bpm:null;
    const result=this.phaseLock.update({time,delta,required,low,high,running:this.clockReady});
    this.syncState=result.state;
    this.pitch=(Math.max(low,Math.min(high,required))-1)*100;
    this.setRate(result.rate);
  }
  alignSync(){
    if(!this.clockReady||this.mixer.syncSource===this.id||this.syncState==="range")return;
    const current=this.position();
    const target=this.mixer.syncedStart(this,current);
    if(Math.abs(current-target)>.024)return this.start(current,.012,true);
  }
  async enableSync(){
    if(!this.readyGrid)throw new Error("Analiza la pista o marca su BPM y primer pulso para activar Sync.");
    const track=this.track;
    await this.mixer.ensure();
    if(track!==this.track)return;
    this.phaseLock.reset(this.mixer.context.currentTime);
    this.sync=true;this.syncScale=0;
    this.updatePitch();
    this.mixer.tickSync();
    await this.alignSync();
  }
  disableSync(){
    this.sync=false;this.syncScale=0;this.syncState="";this.syncError=null;
    this.updatePitch();
    this.pitch=(this.rate-1)*100;
    this.manualRate=this.rate;
    this.mixer.tickSync();
  }
}

export class DDMixer {
  constructor(){
    this.master="A";
    this.cueSink="";
    this.config=mixerSettings();
    this.prelisten=Object.fromEntries(DECKS.map(id=>[id,false]));
    this.playbackReservations=new Map();
    this.decks=Object.fromEntries(DECKS.map(id=>[id,new Deck(id,this)]));
    this.syncClock=new SyncClock();this.syncClock.reset();
    this.syncTempo=null;this.syncDynamic=false;this.syncMode="off";
    this.spaceOwner="";this.spaceApplied={};this.spaceAt=-Infinity;
  }
  async ensure(){
    await readyAudio();
    homePlayer.pause();
    if(this.context===ctx)return this.pitchReady;
    this.closeCueOutput();
    this.context=ctx;
    this.syncClock.reset();
    this.main=ctx.createGain();
    this.output=ctx.createGain();
    this.monitor=ctx.createGain();
    this.record=ctx.createMediaStreamDestination();
    this.main.connect(this.output).connect(chain.bus);
    this.output.connect(this.record);
    this.readMaster=stereoMeter(ctx,this.output);
    if(this.cueSink)this.routeCue(this.cueSink).catch(()=>{});
    else this.monitor.connect(chain.bus);
    this.monitor.gain.value=.55;
    const reverb=impulse(ctx),room=roomImpulse(ctx);
    this.channels=Object.fromEntries(DECKS.map(id=>[id,new DeckChannel(ctx,this.main,this.monitor,reverb,room)]));
    for(const channel of Object.values(this.channels))channel.onPitchLost=()=>this.applyPitch();
    for(const item of Object.values(this.decks)){
      item.node=null;
      const track=item.track;
      if(track&&item.boundContext&&item.boundContext!==ctx){
        item.detach();item.media=item.mediaFor(track);item.media.currentTime=item.streamPos;
      }
      item.boundContext=ctx;
    }
    this.apply();
    this.pitchReady=Promise.all(Object.values(this.channels).map(channel=>channel.enablePitch())).then(()=>this.applyPitch());
    return this.pitchReady;
  }
  applyPitch(){
    if(!this.channels||this.context.state==="closed")return;
    const decks=Object.values(this.decks);
    const matched=decks.some(deck=>deck.sync||Math.abs(deck.shift)>.025)&&Object.values(this.channels).every(channel=>channel.shift);
    const equalDelay=matched&&decks.some(deck=>deck.opts.masterTempo||Math.abs(deck.shift)>.025);
    for(const deck of decks){
      const native=deck.opts.masterTempo&&!matched;
      if(deck.media&&deck.media.preservesPitch!==native)deck.media.preservesPitch=native;
      this.channels[deck.id].pitch(deck.pitchAmount(matched),equalDelay,Math.abs(deck.shift)<.025);
    }
  }
  reservePlayback(deck){
    if(!window.AudioWorkletNode)return null;
    const budget=(navigator.deviceMemory&&navigator.deviceMemory<=4?128:224)*1024*1024;
    const estimate=Math.ceil(deck.duration*PLAYBACK_RATE*2*4);
    const allocated=Object.values(this.decks).reduce((bytes,item)=>bytes+(item.preparedPlayback?
      item.buffer.length*item.buffer.numberOfChannels*4:0),0);
    const pending=[...this.playbackReservations.values()].reduce((a,b)=>a+b,0);
    if(allocated+pending+estimate>budget)return null;
    const key=Symbol();this.playbackReservations.set(key,estimate);
    return key;
  }
  releasePlayback(key){this.playbackReservations.delete(key);}
  closeCueOutput(){
    this.cueAudio?.pause();
    if(this.cueAudio)this.cueAudio.srcObject=null;
    this.cueDestination?.stream.getTracks().forEach(track=>track.stop());
    this.cueAudio=null;
    this.cueDestination=null;
  }
  async routeCue(sink){
    const context=this.context;
    const monitor=this.monitor;
    const bus=chain.bus;
    const ticket=this.cueTicket=Symbol();
    if(!sink){
      monitor.disconnect();
      this.closeCueOutput();
      monitor.connect(bus);
      this.cueSink="";
      return;
    }
    const audio=new Audio();
    if(typeof audio.setSinkId!=="function")throw new Error("Tu navegador no permite una salida separada.");
    const destination=context.createMediaStreamDestination();
    try {
      audio.srcObject=destination.stream;
      await audio.setSinkId(sink);
      if(ticket!==this.cueTicket||context!==this.context)throw new DOMException("Salida sustituida","AbortError");
      await audio.play();
      if(ticket!==this.cueTicket||context!==this.context)throw new DOMException("Salida sustituida","AbortError");
    } catch(error) {
      audio.pause();
      audio.srcObject=null;
      destination.stream.getTracks().forEach(track=>track.stop());
      throw error;
    }
    monitor.disconnect();
    this.closeCueOutput();
    monitor.connect(destination);
    this.cueAudio=audio;
    this.cueDestination=destination;
    this.cueSink=sink;
  }
  async setCueSink(sink){
    await this.ensure();
    await this.routeCue(sink);
  }
  setMaster(id){
    this.master=id;
    this.tickSync();
    if(this.syncDynamic)return Promise.all(Object.values(this.decks).filter(deck=>deck.sync).map(deck=>deck.alignSync()));
  }
  setSyncTempo(bpm){
    this.syncDynamic=false;
    this.syncTempo=Math.round(limit(bpm,35,260,120)*100)/100;
    this.tickSync();
  }
  setDynamicTempo(dynamic){
    if(dynamic===this.syncDynamic)return;
    if(dynamic){this.syncTempo=null;this.syncDynamic=true;this.tickSync();}
    else if(this.syncClock.bpm)this.setSyncTempo(this.syncClock.bpm);
    else this.syncDynamic=false;
  }
  syncedStart(deck,position){
    this.tickSync();
    const {syncClock:clock}=this;
    if(!clock.bpm||this.syncSource===deck.id||!deck.readyGrid||deck.syncState==="range")return position;
    return startOnBeat(deck.grid(),position,deck.duration,clock.read(this.context.currentTime),deck.syncScale||1,deck.loop.on?deck.loop:null);
  }
  tickSync(){
    const decks=Object.values(this.decks),synced=decks.filter(deck=>deck.sync&&deck.readyGrid);
    const time=this.context?.currentTime,clock=this.syncClock;
    if(!synced.length){clock.reset();this.syncTempo=null;this.syncMode="off";this.syncSource="";return;}
    if(!Number.isFinite(time))return;
    const active=synced.filter(deck=>deck.clockReady);
    const free=decks.filter(deck=>!deck.sync&&deck.readyGrid&&deck.clockReady);
    const preferred=decks.find(deck=>deck.id===this.master&&deck.readyGrid&&deck.clockReady);
    const previous=this.decks[this.syncSource];
    const available=preferred||(previous?.clockReady&&(previous.sync||synced.length===1)?previous:null)||
      (synced.length===1?free[0]:null)||active[0];
    const configured=this.decks[this.master];
    const leader=this.syncDynamic?available:null;
    const seed=available||(configured?.readyGrid?configured:synced[0]);
    if(leader&&leader!==previous){
      leader.phaseLock.reset(time);
      if(leader.sync)leader.setRate(leader.manualRate,true);
    }
    const reading=gridReading(seed.grid(),seed.position(),seed.syncScale||1);
    const observed=reading.bpm*seed.rate;
    if(!this.syncDynamic&&this.syncTempo===null)this.syncTempo=Math.round(limit(observed,35,260,120)*100)/100;
    const tempo=this.syncTempo??(leader||!clock.bpm?observed:clock.bpm);
    for(const deck of synced)if(!deck.syncScale)deck.syncScale=tempoScale(tempo,deck.baseBpm());
    this.syncSource=leader?.id??"";
    this.syncMode=leader?"follow":"shared";
    clock.set(time,tempo,Boolean(leader)||active.length>0,leader||!clock.bpm?reading.beat:undefined);
    const beat=clock.read(time);
    for(const deck of synced){
      if(deck===leader){deck.syncState="locked";deck.syncError=0;}
      else deck.followSync(time,tempo,beat);
    }
    for(const deck of decks)if(this.config[deck.id].fx==="echo"){
      const bpm=deck.sync&&deck.syncState!=="range"?tempo:(deck.baseBpm()||128)*deck.rate;
      this.channels?.[deck.id].setEchoTempo(bpm);
    }
  }
  apply(){
    if(!this.context||this.context.state==="closed")return;
    const {config}=this;
    gate(this.output.gain,config.master,this.context);
    for(const id of DECKS){
      const channel=this.channels[id];
      const deck=this.decks[id];
      const bpm=deck.sync&&deck.syncState!=="range"&&this.syncClock.bpm|| (deck.baseBpm()||128)*deck.rate;
      const {weight,normalization}=this.channelLevel(deck);
      channel.apply(config[id],weight,bpm,normalization);
      gate(channel.monitor.gain,this.prelisten[id]?.72:0,this.context);
    }
    this.applySpace(true);
  }
  applySpace(force=false){
    if(!this.channels||this.context.state==="closed")return;
    const time=this.context.currentTime;
    if(!force&&(Math.abs(time-this.spaceAt)<.18||!DECKS.some(id=>this.config[id].spaceMode==="auto")))return;
    this.spaceAt=time;
    const entries=DECKS.map(id=>{
      const deck=this.decks[id],mix=this.config[id],{weight,normalization}=this.channelLevel(deck);
      const {detail,detailRate}=deck.analysis||{};
      const index=Math.round(deck.position()*(detailRate||1));
      const bands=detail?.map((band,i)=>{
        let power=0;
        for(let n=0;n<6;n++)power+=(band[Math.max(0,index-Math.floor(n*.09*detailRate))]||0)**2;
        return Math.sqrt(power/6)*DB([mix.low,mix.mid,mix.high][i]);
      })??[.35,.28,.21];
      const energy=Math.hypot(...bands),sum=bands[0]+bands[1]+bands[2];
      const sounding=deck.playing&&!deck.cuePreview&&!mix.mute;
      const level=sounding?mix.level*weight*Math.min(1,energy*DB(mix.trim+normalization)*2.5):0;
      return {id,mix,level,bass:sum?bands[0]/sum:0,body:sum?bands[1]/sum:0};
    });
    const {owner,states}=spatialPlan(entries,this.spaceOwner);
    this.spaceOwner=owner;this.spaceApplied=states;
    for(const {id,mix} of entries)this.channels[id].applySpace(states[id],mix.spaceMode==="auto");
  }
  channelLevel(deck){
    const {config}=this, t=(config.cross+1)/2;
    const side=DECKS.indexOf(deck.id)%2;
    const linear=side?t:1-t;
    const weight=config.curve==="linear"?linear:config.curve==="cut"?Number(linear>.03):Math.sin(linear*Math.PI/2);
    const {loudness,peak}=deck.metadata;
    const normalization=config.normalize&&loudness!==null&&peak!==null?Math.min(9,-18-loudness,-1-peak):0;
    return {weight,normalization};
  }
  beforeRateChange(){
    for(const deck of Object.values(this.decks)){deck.halt();deck.slipClock=null;}
  }
  reset(){
    this.cueTicket=Symbol();
    if(this.cueSink&&this.monitor&&this.context.state!=="closed"){
      this.monitor.disconnect();
      this.monitor.connect(chain.bus);
    }
    this.closeCueOutput();
    this.cueSink="";
    for(const deck of Object.values(this.decks))deck.reset();
    this.tickSync();
    this.prelisten=Object.fromEntries(DECKS.map(id=>[id,false]));
    this.master="A";
    this.syncDynamic=false;
    this.spaceOwner="";
    this.config=mixerSettings();
    this.apply();
  }
}
