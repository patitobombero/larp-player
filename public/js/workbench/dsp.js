import { butterworthQ, filterValues } from "../eq-dsp.js";
import { estimateTruePeak } from "../peak-limiter.js";
import { clamp, noiseFor } from "./host.js";
import { WInstruments } from "./instruments.js";
import { WModel } from "./model.js";
import { WTempo } from "./tempo.js";
import { WPhysical } from "./physical.js";
import { prepareTakes, selectTake } from "./takes.js";
function createStudioEngine(){
 const graph=new Map(),samples=new Map(),impulses=new Map(),voices=new Set(),stretched=new Map(),rooms=new WeakMap();
 const gain=(a,value=1)=>{const node=a.createGain();node.gain.value=value;return node;};
 const stereoDelay=(a,max)=>{
  const node=a.createDelay(max);node.channelCount=2;node.channelCountMode="explicit";return node;
 };
 const dB=value=>value<=-80?0:10**(value/20);
 const smooth=(param,value,a)=>{
  if(typeof a.startRendering==="function")param.value=value;
  else param.setTargetAtTime(value,a.currentTime,.009);
 };
 function delayPlan(p,sr){
  const offsets=new Map(p.tracks.map(t=>[t.id,WModel.manualMs(t.mix,p.bpm,sr)/1000]));
  const potentials=new Map([["master",0]]);
  function potential(id){
   if(!potentials.has(id)){
    const receivers=WModel.outputs(p,id).map(potential);
    potentials.set(id,Math.max(0,Math.max(...receivers)-offsets.get(id)));
   }
   return potentials.get(id);
  }
  const base=Math.max(0,...p.tracks.map(t=>potential(t.id)));
  return {base,potentials,offsets};
 }
 function impulse(a,seconds){
  const key=a.sampleRate+":"+seconds;
  if(impulses.has(key))return impulses.get(key);
  if(impulses.size>=8)impulses.delete(impulses.keys().next().value);
  const ir=a.createBuffer(2,Math.max(1,Math.round(a.sampleRate*seconds)),a.sampleRate);
  const onset=a.sampleRate/300;
  for(let c=0;c<2;c++){
   let seed=43219+c*7433;
   const data=ir.getChannelData(c);
   for(let i=0;i<data.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    data[i]=(seed/2147483648-1)*Math.pow(1-i/data.length,3)*Math.min(1,i/onset);
   }
  }
  impulses.set(key,ir);return ir;
 }
 function clipping(node,amount,morph=0,bias=0,flavor=-1){
  const arr=new Float32Array(4097),k=1+amount*.15;
  const curve=(x)=>{
   const z=x*k,t=Math.tanh(z);
   if(flavor>=0)return [
    Math.tanh(z*1.31),Math.atan(z*2.15)/(Math.PI*.5),
    z>=0?1-Math.exp(-1.5*z):.56*(Math.exp(2.23*z)-1),
    z/(.44+Math.abs(z)),Math.tanh(z*3)*Math.min(1,Math.abs(z)**1.4*1.1)
   ][flavor];
   const hard=clamp(z*(1+.8*morph),-1,1);
   return t*(1-morph)+hard*morph;
  };
  const dc=curve(bias);
  const bound=Math.max(1,Math.abs(curve(1+bias)-dc),Math.abs(curve(-1+bias)-dc));
  for(let i=0;i<arr.length;i++)arr[i]=(curve(i/2048-1+bias)-dc)/bound;
  node.curve=arr;
 }
 function toolsFor(a){
  const nodes=[],oscillators=[];
  const add=node=>(nodes.push(node),node);
  const biquad=(type,f,amount=0)=>{
   const node=add(a.createBiquadFilter());node.type=type;
   const values=filterValues({type,frequency:Math.min(a.sampleRate*.46,f),gain:amount},a.sampleRate);
   node.frequency.value=values.frequency;node.gain.value=values.gain;node.Q.value=values.Q;
   return node;
  };
  return {add,biquad,g:v=>add(gain(a,v)),lfo(){
   const osc=add(a.createOscillator());osc.start();oscillators.push(osc);return osc;
  },dispose(){for(const osc of oscillators)try{osc.stop();}catch{}for(const n of nodes)n.disconnect();}};
 }
 function feedbackDelay(a,src,dest,kit,max=2,tape=false){
  const {add,g,biquad}=kit;
  const split=add(a.createChannelSplitter(2)),merge=add(a.createChannelMerger(2)),mix=g(0);
  const stereo=g(1);stereo.channelCount=2;stereo.channelCountMode="explicit";
  src.connect(stereo).connect(split);merge.connect(mix).connect(dest);
  const lines=Array.from({length:2},(_,i)=>{
   const gate=g(1),d=add(a.createDelay(max)),lo=biquad("highpass",90),hi=biquad("lowpass",7000);
   const same=g(0),cross=g(0);
   split.connect(gate,i);gate.connect(d).connect(lo).connect(hi);
   let out=hi;
   if(tape){
    const tapeHead=add(a.createWaveShaper());
    tapeHead.oversample="4x";
    tapeHead.curve=Float32Array.from({length:1025},(_,n)=>Math.tanh(1.45*(n/512-1))/1.45);
    out=hi.connect(tapeHead);
   }
   out.connect(merge,0,i);out.connect(same).connect(d);out.connect(cross);
   return {gate,d,lo,hi,same,cross};
  });
  lines.forEach((m,i)=>m.cross.connect(lines[1-i].d));
  return ({time=.25,skew=.03,feedback=.2,wet=.1,low=90,high=7000,ping=0,side=0})=>{
   smooth(mix.gain,wet,a);lines.forEach(({gate,d,lo,hi,same,cross},i)=>{
    smooth(gate.gain,side===0||side===i+1?1:0,a);
    smooth(d.delayTime,clamp(time*(1+i*skew),.015,max-.01),a);
    smooth(lo.frequency,low,a);smooth(hi.frequency,Math.min(a.sampleRate*.46,high),a);
    smooth(same.gain,feedback*(1-ping),a);smooth(cross.gain,feedback*ping,a);
   });
  };
 }
 function distortionBands(a,input,kit){
  const {add,g,biquad}=kit;
  const crossover=(source,frequency,type)=>{
   const first=biquad(type,frequency),second=biquad(type,frequency);
   // Low/high-pass Q is in dB. Two Butterworth sections give LR4.
   first.Q.value=second.Q.value=-3.0102999566;
   source.connect(first).connect(second);
   return second;
  };
  const phase=(source,frequency)=>{
   const node=biquad("allpass",frequency);
   node.Q.value=Math.SQRT1_2;
   return source.connect(node);
  };
  const middleHigh=crossover(input,210,"highpass");
  const bands=[phase(crossover(input,210,"lowpass"),2250),crossover(middleHigh,2250,"lowpass"),crossover(middleHigh,2250,"highpass")];
  const dry=phase(phase(input,210),2250);
  const out=g(1);
  const shapers=bands.map((band,i)=>{
   const node=add(a.createWaveShaper());
   node.oversample="4x";
   band.connect(node).connect(g([.90,1,.88][i])).connect(out);
   return node;
  });
  return {dry,out,update(amount,morph){
   shapers.forEach((shaper,i)=>clipping(shaper,amount*[.48,1,.67][i],morph*[.30,.84,.49][i]));
  }};
 }
 function makeFX(a,fx,inNode,bpm=120){
  const kit=toolsFor(a),{add,g,biquad,lfo}=kit;
  const input=g(1),output=g(1);
  inNode.connect(input);
  let update;
  if(fx.kind==="channelEQ"){
   const hp=biquad("highpass",20),lo=biquad("lowshelf",160),mid=biquad("peaking",950),hi=biquad("highshelf",5000);
   const flat=g(1),cut=g(0);hp.Q.value=20*Math.log10(butterworthQ);
   input.connect(flat).connect(lo);input.connect(hp).connect(cut).connect(lo);lo.connect(mid).connect(hi).connect(output);
   update=v=>{
    smooth(hp.frequency,[20,20,45,85,140,240][v.cut],a);
    smooth(flat.gain,v.cut?0:1,a);smooth(cut.gain,v.cut?1:0,a);
    smooth(lo.gain,v.low,a);smooth(mid.frequency,v.midHz,a);smooth(mid.Q,v.width,a);
    smooth(mid.gain,v.mid,a);smooth(hi.gain,v.high,a);
   };
  }else if(fx.kind==="dynamics"){
   const comp=add(a.createDynamicsCompressor());
   input.connect(comp).connect(output);
   update=v=>{
    smooth(comp.threshold,v.threshold,a);smooth(comp.ratio,v.ratio,a);smooth(comp.knee,v.knee,a);
    smooth(comp.attack,v.attack/1000,a);smooth(comp.release,v.release/1000,a);smooth(output.gain,dB(v.makeup),a);
   };
  }else if(fx.kind==="tape"){
   input.connect(output);
   const echo=feedbackDelay(a,input,output,kit,4.1,true);
   update=(v,tempo)=>echo({time:v.sync?[.25,.5,.75,1,2][v.division]*60/tempo:v.time/1000,
    skew:v.sync?0:.03,feedback:v.feedback/100,wet:v.wet*.006,low:115,high:1250*8**(v.color/100),ping:v.ping/100});
  }else if(fx.kind==="amp"){
   const amp=amplifier(a,input,kit);
   amp.out.connect(output);
   update=amp.update;
  }else if(fx.kind==="space"){
   const dry=g(1),wet=g(0),ir=add(a.createConvolver()),sum=g(1),lo=biquad("highpass",90),hi=biquad("lowpass",8400);
   const splitter=add(a.createChannelSplitter(2)),merger=add(a.createChannelMerger(2));
   const channels=Array.from({length:2},(_,i)=>{
    const direct=g(1),own=g(1),other=g(-1),widen=g(0),side=biquad("highpass",145),mod=add(a.createDelay(.05)),modGain=g(0),send=g(0);
    side.Q.value=20*Math.log10(butterworthQ);
    const wave=lfo();mod.delayTime.value=.014+i*.004;
    splitter.connect(direct,i);direct.connect(merger,0,i);
    splitter.connect(own,i);splitter.connect(other,1-i);
    own.connect(side);other.connect(side);side.connect(widen).connect(merger,0,i);
    splitter.connect(mod,i);mod.connect(send).connect(merger,0,i);
    wave.connect(modGain).connect(mod.delayTime);
    return {direct,widen,modGain,send,wave};
   });
   input.connect(dry).connect(sum);input.connect(lo).connect(hi).connect(ir).connect(wet).connect(sum);
   const echo=feedbackDelay(a,input,sum,kit);
   sum.connect(splitter);merger.connect(output);
   let seconds;
   update=v=>{
    if(seconds!==v.room){seconds=v.room;ir.buffer=impulse(a,seconds);}
    smooth(lo.frequency,v.lowcut,a);smooth(hi.frequency,Math.min(a.sampleRate*.46,v.highcut),a);
    smooth(dry.gain,1-v.reverb*.004,a);smooth(wet.gain,v.reverb/110,a);
    channels.forEach(({direct,widen,modGain,send,wave},i)=>{
     smooth(direct.gain,1-v.chorus*.002,a);
     smooth(widen.gain,v.dimension*.003,a);smooth(send.gain,v.chorus*.0036,a);
     smooth(modGain.gain,.001+v.chorus*.000065,a);smooth(wave.frequency,v.rate*(1+i*.23),a);
    });
    echo({time:v.delay*.001,skew:v.warp*.004,feedback:Math.min(.78,v.feedback/100),wet:v.wet*.0042,low:v.lowcut,high:v.highcut,ping:v.density/100});
   };
  }else if(fx.kind==="padvault"){
   const filter=biquad("lowpass",10400),ir=add(a.createConvolver()),room=g(0),dry=g(1);
   ir.buffer=impulse(a,.51);
   input.connect(filter).connect(dry).connect(output);filter.connect(ir).connect(room).connect(output);
   update=v=>{smooth(dry.gain,v.volume/100,a);smooth(filter.frequency,Math.min(a.sampleRate*.46,v.filter),a);smooth(room.gain,v.room*.0048*v.volume/100,a);};
  }else if(fx.kind==="drumcircuit"){
   const sat=add(a.createWaveShaper()),wet=g(0),dry=g(1),ir=add(a.createConvolver()),room=g(0),s=g(1),post=biquad("highpass",31);
   ir.buffer=impulse(a,.68);sat.oversample="4x";
   input.connect(dry).connect(s);input.connect(sat).connect(post).connect(wet).connect(s);
   s.connect(output);s.connect(ir).connect(room).connect(output);
   const echo=feedbackDelay(a,s,output,kit);
   update=(v,barBpm)=>{
    clipping(sat,v.dist,.12);
    smooth(dry.gain,1-v.dist*.0075,a);smooth(wet.gain,v.dist*.005,a);
    smooth(output.gain,v.gain/100,a);smooth(room.gain,v.room*.0042,a);
    const mode=Math.round(v.delaySide);
    echo({time:v.sync?v.division*60/barBpm:v.delay*.001,feedback:v.feedback/100,wet:v.mix*.0055,ping:mode===1?1:0,side:mode>=2?mode-1:0,low:130,high:6100});
   };
  }else if(fx.kind==="sustain"){
   const compressor=add(a.createDynamicsCompressor());
   compressor.knee.value=13;input.connect(compressor).connect(output);
   update=v=>{
    smooth(compressor.threshold,-12-v.amount*.16,a);
    smooth(compressor.ratio,1+v.amount*.029,a);
    smooth(compressor.attack,v.attack*.001,a);
    smooth(compressor.release,clamp(v.release*.001,.05,.93),a);
    smooth(output.gain,v.level*.01*(1+v.amount*.004),a);
   };
  }else{
   const filter=biquad("lowpass",6500),hp=biquad("highpass",32),clipper=add(a.createWaveShaper()),dry=g(1),wet=g(0);
   clipper.oversample="4x";
   const multi=fx.kind==="drive"?distortionBands(a,input,kit):null;
   const singleDry=g(1),singleWet=g(1),bandDry=g(0),bandWet=g(0);
   input.connect(singleDry).connect(dry).connect(output);
   input.connect(clipper).connect(singleWet).connect(hp).connect(filter).connect(wet).connect(output);
   if(multi){
    multi.dry.connect(bandDry).connect(dry);
    multi.out.connect(bandWet).connect(hp);
   }
   update=v=>{
    if(fx.kind==="fuzz")clipper.oversample=["none","2x","4x"][Math.round(v.oversample)];
     const drive=v.drive??v.fuzz;
    const morph=(v.color||0)/100;
    if(multi&&v.bands){
     multi.update(drive,morph);
     smooth(singleDry.gain,0,a);smooth(singleWet.gain,0,a);
     smooth(bandDry.gain,1,a);smooth(bandWet.gain,1,a);
    }else{
     clipping(clipper,drive,morph,(v.bias||0)/250,fx.kind==="fuzz"?Math.round(v.flavor):-1);
     smooth(singleDry.gain,1,a);smooth(singleWet.gain,1,a);
     smooth(bandDry.gain,0,a);smooth(bandWet.gain,0,a);
    }
    smooth(filter.frequency,Math.min(a.sampleRate*.46,350*30**(v.tone/100)),a);
    smooth(dry.gain,1-v.mix/100,a);smooth(wet.gain,v.mix*v.level/10000/Math.sqrt(1+drive*.012),a);
   };
  }
  update(fx.values,bpm);
  return {out:output,update,dispose:kit.dispose};
 }
 const cabinetIR=new WeakMap();
 function cabIR(a,kind){
  if(!cabinetIR.has(a))cabinetIR.set(a,new Map());
  const set=cabinetIR.get(a);
  if(set.has(kind))return set.get(kind);
  const buffer=a.createBuffer(2,Math.ceil(a.sampleRate*.036),a.sampleRate);
  const taps=kind===1?[[0,.74],[.00062,.14],[.0014,-.13],[.0031,.092],[.0062,-.034]]:
   kind===2?[[0,.73],[.00053,-.17],[.00133,.18],[.00239,-.095],[.0076,.066]]:
    [[0,.79],[.00069,.16],[.0021,.13],[.0041,-.085]];
  const modes=kind===1?[[112,.006,.0039],[620,.0013,-.0018],[1750,.0014,.0031]]:
   kind===2?[[139,.007,.0041],[215,.003,-.0024],[1180,.0016,.003]]:
    [[73,.009,.0038],[203,.004,.0022],[550,.002,-.0021]];
  for(let c=0;c<2;c++){
   const out=buffer.getChannelData(c);
   taps.forEach(([sec,w],i)=>out[Math.round(a.sampleRate*(sec+(c&&i?i*.00012:0)))]+=w);
   for(let i=1;i<out.length;i++){
    const t=i/a.sampleRate;
    for(const [f,tau,k] of modes)out[i]+=k*Math.exp(-t/tau)*Math.sin(t*2*Math.PI*f*(c?1.002:1));
   }
  }
  set.set(kind,buffer);return buffer;
 }
 // Two gain stages surround the tone stack. The first stage breaks up
 // asymmetrically, while the slower gain reduction models power-supply sag.
 function amplifier(a,input,kit){
  const {add,g,biquad}=kit;
  const dry=g(0),wet=g(1),output=g(1);
  const inFilter=biquad("highpass",76),inShelf=biquad("lowshelf",220);
  const preamp=g(1),drive=add(a.createWaveShaper());
  const bass=biquad("lowshelf",145),mid=biquad("peaking",740),treble=biquad("highshelf",2350);
  const sag=add(a.createDynamicsCompressor()),power=g(1),tube=add(a.createWaveShaper());
  const presence=biquad("highshelf",3150),clean=g(0),cabinet=g(0),ir=add(a.createConvolver());
  const cabHP=biquad("highpass",76),cabLP=biquad("lowpass",5150),mic=biquad("peaking",2250);
  const level=g(1),post=g(1),blocking=biquad("highpass",20);
  let lastCab=-1,lastMode=-1,lastDirect;
  mid.Q.value=.8;mic.Q.value=.86;
  drive.oversample="4x";tube.oversample="4x";ir.normalize=false;
  sag.knee.value=13;sag.attack.value=.010;sag.release.value=.10;
  input.connect(dry).connect(output);
  input.connect(inFilter).connect(inShelf).connect(preamp).connect(drive).connect(bass).connect(mid).connect(treble)
   .connect(sag).connect(power).connect(tube).connect(presence).connect(wet).connect(post);
  post.connect(clean).connect(level);
  post.connect(ir).connect(cabHP).connect(cabLP).connect(mic).connect(cabinet).connect(level);
  level.connect(blocking).connect(output);

  function transfer(node,hardness,bias){
   const points=new Float32Array(4097);
   const origin=Math.tanh(hardness*bias);
   const derivative=hardness*(1-origin*origin);
   for(let i=0;i<points.length;i++)points[i]=(Math.tanh(hardness*(i/2048-1+bias))-origin)/derivative;
   node.curve=points;
  }
  function update(v){
   const m=v.mode;
   const active=!v.bypass;
   const shape=!v.direct;
   if(m!==lastMode){
    lastMode=m;
    transfer(drive,[1.1,1.62,2.45,1.13][m],[.065,.11,.17,.025][m]);
    transfer(tube,[1.07,1.36,1.62,1.14][m],[.028,.047,.07,.018][m]);
   }
   if(v.cab&&v.cab!==lastCab){ir.buffer=cabIR(a,v.cab);lastCab=v.cab;}
   if(lastDirect!==v.direct){
    if(lastDirect)input.disconnect(post);
    if(v.direct)input.connect(post);
    lastDirect=v.direct;
   }
   smooth(dry.gain,active?0:1,a);
   smooth(wet.gain,active&&shape?1:0,a);
   smooth(inFilter.frequency,[59,77,106,36][m],a);
   smooth(inShelf.gain,[-1,-3.5,-6,-.9][m],a);
   smooth(preamp.gain,dB(v.preamp+v.gain*[.064,.13,.20,.042][m]),a);
   smooth(bass.frequency,m===3?105:145,a);
   smooth(bass.gain,v.low,a);
   smooth(mid.frequency,[720,790,890,480][m],a);
   smooth(mid.gain,v.mid,a);
   smooth(treble.gain,v.high,a);
   smooth(sag.threshold,[-12,-18,-22,-14][m],a);
   smooth(sag.ratio,[1.35,2.1,3.3,1.65][m],a);
   smooth(power.gain,dB(v.master+[-1,2,5,0][m]),a);
   smooth(presence.gain,v.presence,a);
   smooth(clean.gain,active&&!v.cab?1:0,a);
   smooth(cabinet.gain,active&&v.cab?1:0,a);
   smooth(cabHP.frequency,v.cab===3?39:v.cab===2?83:65,a);
   smooth(cabLP.frequency,([6800,6150,4830,3350][v.cab])*[1,.83,.69][v.mic],a);
   smooth(mic.gain,[2,-1,-2.7][v.mic],a);
   smooth(level.gain,dB(v.volume),a);
  }
  return {out:output,update};
 }

 function makeTone(a,t,entry){
  const kit=toolsFor(a),{add,g,biquad,lfo}=kit;
  if(t.kind==="electric"){
   const amp=amplifier(a,entry,kit),output=g(1);
   amp.out.connect(output);
   const update=(v,external=false)=>{
    const direct=v.amp===0;
    amp.update({mode:Math.max(0,v.amp-1),direct,bypass:external,preamp:[0,9,17,24][v.amp],
     gain:v.drive,low:v.low,mid:v.mid,high:v.high,presence:v.presence,master:-2,volume:0,cab:v.cab,mic:0});
    smooth(output.gain,v.level*.01,a);
   };
   update(WInstruments.get(t));
   return {out:output,update,dispose:kit.dispose};
  }
  const eqLow=biquad("lowshelf",160),eqMid=biquad("peaking",780),eqHigh=biquad("highshelf",2900);
  const output=g(1),sum=g(1);
  eqMid.Q.value=.83;
  entry.connect(eqLow).connect(eqMid).connect(eqHigh);
  let eqEnd=eqHigh;
  const opts={};
  if(t.kind==="rhodes"){
   opts.midHi=biquad("peaking",2140);eqEnd.connect(opts.midHi);eqEnd=opts.midHi;
  }
  if(t.kind==="piano"){
   opts.voicing=biquad("lowpass",14000);opts.voicing.Q.value=20*Math.log10(.68);
   eqEnd.connect(opts.voicing);eqEnd=opts.voicing;
  }
  if(t.kind==="rhodes"||t.kind==="synth"){
   const dry=g(1),wet=g(0),sat=add(a.createWaveShaper()),hp=biquad("highpass",65),presence=biquad("peaking",3050);
   sat.oversample="4x";presence.Q.value=.76;
   eqEnd.connect(dry).connect(sum);
   eqEnd.connect(hp).connect(sat).connect(presence).connect(wet).connect(sum);
   Object.assign(opts,{dry,wet,sat,hp,presence});
  }else eqEnd.connect(sum);
  let end=sum;
  if(t.kind==="rhodes"){
   const ir=add(a.createConvolver()),dry=g(1),wet=g(0),lo=biquad("lowpass",5100),blend=g(1);
   ir.normalize=false;end.connect(dry).connect(blend);end.connect(ir).connect(lo).connect(wet).connect(blend);
   Object.assign(opts,{cab:{ir,dry,wet,lo,kind:null}});
   end=blend;
  }
  if(t.kind==="rhodes"){
   const split=add(a.createChannelSplitter(2)),join=add(a.createChannelMerger(2)),stereo=g(1);
   stereo.channelCount=2;stereo.channelCountMode="explicit";end.connect(stereo).connect(split);
   const wave=lfo(),trem=Array.from({length:2},(_,i)=>{
    const v=g(1),d=g(0);split.connect(v,i);v.connect(join,0,i);wave.connect(d).connect(v.gain);return {v,d};
   });
   const p=biquad("allpass",820),base=g(1),phase=g(0),mix=g(1);p.Q.value=1.45;
   const phaseOsc=lfo(),phaseDepth=g(0);phaseOsc.frequency.value=.67;phaseOsc.connect(phaseDepth).connect(p.frequency);
   join.connect(base).connect(mix);join.connect(p).connect(phase).connect(mix);
   const chor=g(0),dl=add(a.createDelay(.05)),depth=g(0),l=lfo();l.frequency.value=.32;dl.delayTime.value=.017;
   mix.connect(dl).connect(chor);l.connect(depth).connect(dl.delayTime);
   const post=g(1);mix.connect(post);chor.connect(post);
   Object.assign(opts,{wave,trem,chor,depth,base,phase,phaseDepth});
   end=post;
  }
  end.connect(output);
  if(t.kind==="guitar"||t.kind==="piano"||t.kind==="synth"){
   const room=g(0),ir=add(a.createConvolver());
   ir.buffer=impulse(a,t.kind==="synth"?1.25:.68);end.connect(ir).connect(room).connect(output);opts.room=room;
  }
  if(t.kind==="rhodes"||t.kind==="synth")opts.echo=feedbackDelay(a,end,output,kit);
  const update=v=>{
   smooth(eqLow.gain,v.low??0,a);smooth(eqMid.gain,v.mid??0,a);smooth(eqHigh.gain,v.high??0,a);
   smooth(output.gain,(v.level??100)*.01,a);
   if(opts.sat){
    const drive=t.kind==="rhodes"?v.drive+[0,0,12][v.model]:v.drive;
    clipping(opts.sat,drive,.05);
    const wet=drive*.0048;
    smooth(opts.dry.gain,1-wet,a);smooth(opts.wet.gain,wet*.84,a);
    smooth(opts.presence.gain,v.presence??0,a);
   }
   if(opts.cab){
    const {cab}=opts;const id=v.cab;
    if(id&&cab.kind!==id){cab.ir.buffer=cabIR(a,id);cab.kind=id;}
    const mic=v.mic??0;
    smooth(cab.dry.gain,id?.14:1,a);smooth(cab.wet.gain,id?.93:0,a);
    smooth(cab.lo.frequency,(id===2?5600:7280)*[1,.80,.7][mic],a);
   }
   if(opts.midHi){
    smooth(eqLow.gain,v.low+[.3,-.5,.9][v.model],a);
    smooth(eqHigh.gain,v.high+[-1.1,2.5,.4][v.model],a);
    smooth(opts.midHi.gain,v.midHi+[0,2.6,1.3][v.model],a);smooth(opts.wave.frequency,v.speed,a);
    opts.trem.forEach(({v:gainNode,d},i)=>{
     smooth(gainNode.gain,1-v.tremolo*.004,a);smooth(d.gain,v.tremolo*.0039*(i?-1:1),a);
    });
    smooth(opts.chor.gain,v.chorus*.004,a);smooth(opts.depth.gain,v.chorus*.00007,a);
    smooth(opts.base.gain,1-v.phaser*.0038,a);smooth(opts.phase.gain,v.phaser*.0038,a);smooth(opts.phaseDepth.gain,v.phaser*4,a);
   }
   if(t.kind==="piano"){
    smooth(eqLow.gain,v.low+[0,.9,-2.4][v.model],a);
    smooth(eqMid.gain,v.mid+[0,-.9,2.1][v.model],a);
    smooth(eqHigh.gain,v.high+(v.lid-70)*.095-[0,3.5,1.2][v.model],a);
    smooth(opts.voicing.frequency,[16500,2550+v.hammer*28,8600][v.model],a);
   }
   if(t.kind==="guitar"){
    smooth(eqLow.gain,v.low+[0,-2,.7][v.model],a);
    smooth(eqMid.gain,v.mid+[0,1.7,-.9][v.model],a);
    smooth(eqHigh.gain,v.high+[0,.7,-1.6][v.model],a);
   }
   if(opts.room)smooth(opts.room.gain,v.room*.0045,a);
   if(opts.echo)opts.echo({time:t.kind==="rhodes"?.32:.27,wet:v.delay*.0049,feedback:.27,low:160,high:6900,ping:.42});
  };
  update(WInstruments.get(t));
  return {out:output,update,dispose:kit.dispose};
 }
 function strip(a){
  const input=gain(a),local=gain(a),inset=stereoDelay(a,11),sum=gain(a),splitter=a.createChannelSplitter(2),merger=a.createChannelMerger(2);
  const volume=gain(a),tap=a.createChannelSplitter(2),meters=[a.createAnalyser(),a.createAnalyser()];
  const readings=new Float32Array(512);
  meters.forEach((meter,i)=>{meter.fftSize=readings.length;tap.connect(meter,i);});
  sum.channelCount=2;sum.channelCountMode="explicit";
  local.connect(inset).connect(input);
  const weights=[0,1,0,1].map((side,i)=>{
   const line=gain(a,i===0||i===3?1:0);
   splitter.connect(line,side);line.connect(merger,0,i>=2?1:0);return line;
  });
  sum.connect(splitter);merger.connect(volume).connect(tap);
  return {input,local,inset,sum,splitter,merger,volume,tap,meters,readings,weights,fx:new Map(),routes:[],signature:"",destination:null};
 }
 function connectFX(a,s,list,bpm){
  for(const instance of s.fx.values())instance.dispose();
  s.fx.clear();let current=s.tone?.out||s.input;current.disconnect();
  for(const fx of list){
   if(!fx.enabled)continue;
   const instance=makeFX(a,fx,current,bpm);s.fx.set(fx.id,instance);current=instance.out;
  }
  current.connect(s.sum);
 }
 function apply(a,p,destination){
  const all=[["master",p.master,null],...p.tracks.map(t=>[t.id,t.mix,t])];
  const valid=new Set(all.map(([id])=>id));
  for(const [id,s] of graph){
   if(valid.has(id))continue;
   s.input.disconnect();s.local.disconnect();s.inset.disconnect();s.sum.disconnect();s.splitter.disconnect();s.merger.disconnect();s.volume.disconnect();s.tap.disconnect();
   s.weights.forEach(node=>node.disconnect());s.routes.forEach(r=>{r.delay.disconnect();r.level.disconnect();});
   s.fx.forEach(f=>f.dispose());s.tone?.dispose();if(s.destination)s.destination.disconnect();graph.delete(id);
  }
  for(const [id,,t] of all)if(!graph.has(id)){
   const s=strip(a);if(t&&WInstruments.has(t.kind))s.tone=makeTone(a,t,s.input);graph.set(id,s);
  }
  const latency=delayPlan(p,a.sampleRate);
  const soloed=new Set(p.tracks.filter(t=>t.mix.solo).map(t=>t.id));
  const upstream=new Set(soloed),downstream=new Set(soloed);
  function follow(id){
   for(const to of WModel.outputs(p,id)){
    if(downstream.has(to))continue;
    downstream.add(to);follow(to);
   }
  }
  function feeds(id){
   if(upstream.has(id))return true;
   if(WModel.outputs(p,id).some(feeds)){upstream.add(id);return true;}
   return false;
  }
  if(soloed.size){soloed.forEach(follow);p.tracks.forEach(t=>feeds(t.id));}
  for(const [id,m,t] of all){
   const s=graph.get(id);
   if(s.tone){
    const config=WInstruments.get(t),external=m.fx.some(f=>f.kind==="amp"&&f.enabled);
    const serialized=JSON.stringify(config)+external;
    if(s.config!==serialized){s.tone.update(config,external);s.config=serialized;}
   }
   for(const v of voices)if(v.track===id)v.setSustain?.(m.fx.find(f=>f.kind==="sustain"&&f.enabled)?.values);
   const graphFx=m.fx.filter(f=>f.enabled&&f.kind!=="bpm");
   const signature=graphFx.map(f=>f.id).join("|");
   if(signature!==s.signature||!s.wired){connectFX(a,s,graphFx,p.bpm);s.signature=signature;s.wired=true;}
   for(const fx of m.fx){
    const instance=s.fx.get(fx.id),value=JSON.stringify(fx.values)+p.bpm;
    if(instance&&instance.cache!==value){instance.update(fx.values,p.bpm);instance.cache=value;}
   }
   WModel.matrix(m).forEach((value,i)=>smooth(s.weights[i].gain,value,a));
   smooth(s.volume.gain,m.mute||(soloed.size&&id!=="master"&&!upstream.has(id)&&!downstream.has(id))?0:dB(m.volume),a);
   if(id==="master"){
    if(!s.destination){s.destination=stereoDelay(a,1);s.volume.connect(s.destination).connect(destination);}
    smooth(s.destination.delayTime,clamp(WModel.manualMs(m,p.bpm,a.sampleRate)/1000,0,19.9),a);
    continue;
   }
   const inset=latency.base-latency.potentials.get(id);
   if(s.routeKey===undefined)s.inset.delayTime.value=inset;else smooth(s.inset.delayTime,inset,a);
   const targets=[{to:m.route,level:0},...m.sends];
   const routeKey=targets.map(r=>r.to).join("|");
   if(routeKey!==s.routeKey){
    s.routes.forEach(r=>{s.volume.disconnect(r.delay);r.delay.disconnect();r.level.disconnect();});
    s.routes=targets.map(({to})=>{
     const delay=stereoDelay(a,11),level=gain(a);
     s.volume.connect(delay).connect(level).connect(graph.get(to).input);
     return {to,delay,level, fresh:true};
    });
    s.routeKey=routeKey;
   }
   s.routes.forEach((r,i)=>{
    smooth(r.level.gain,dB(targets[i].level),a);
    const seconds=latency.offsets.get(id)+latency.potentials.get(id)-latency.potentials.get(r.to);
    if(r.fresh){r.delay.delayTime.value=Math.max(0,seconds);r.fresh=false;}
    else smooth(r.delay.delayTime,Math.max(0,seconds),a);
   });
  }
  return latency;
 }
 function measure(id){
  const s=graph.get(id);if(!s)return -100;
  let peak=0;
  for(const meter of s.meters){meter.getFloatTimeDomainData(s.readings);for(const v of s.readings)peak=Math.max(peak,Math.abs(v));}
  return Math.max(-100,20*Math.log10(peak));
 }
 function roomReturn(a,target){
  if(rooms.has(target))return rooms.get(target);
  const entry=gain(a),ir=a.createConvolver(),filter=a.createBiquadFilter();
  ir.buffer=impulse(a,.32);filter.type="highpass";filter.frequency.value=180;filter.Q.value=20*Math.log10(butterworthQ);
  entry.connect(filter).connect(ir).connect(target);
  rooms.set(target,entry);return entry;
 }
 function hit(a,pad,when,target,track,velocity=1){
  const cfg={...track.kit[pad]};let padPan=0;
  for(const fx of track.mix.fx){
   if(!fx.enabled||!["padvault","drumcircuit"].includes(fx.kind))continue;
   const values=fx.values,key="p"+pad+"_";
   cfg.level*=values[key+"volume"]/100;cfg.tune+=values[key+"tune"];
   cfg.attack+=values[key+"attack"]||0;padPan+=values[key+"pan"]/100;
  }
  const tune=2**(cfg.tune/1200);
  const env=gain(a,0),shelf=a.createBiquadFilter(),pan=a.createStereoPanner();
  shelf.type="highshelf";shelf.frequency.value=2400;shelf.gain.value=cfg.overhead*.081;
  pan.pan.value=clamp([0,-.18,-.58,-.48,.41,-.25,.25,.58][pad]*cfg.overhead/100+padPan,-1,1);
  env.connect(shelf).connect(pan).connect(target);
  const wet=gain(a,cfg.room*.0030);
  if(cfg.room>0)pan.connect(wet).connect(roomReturn(a,target));
  const start=when+cfg.attack*.001,hold=start+cfg.hold*.001,end=hold+cfg.decay*.001;
  const level=Math.min(.67,.0038*cfg.level*velocity);
  env.gain.setValueAtTime(0,when);env.gain.linearRampToValueAtTime(level,start);
  env.gain.setValueAtTime(level,hold);env.gain.exponentialRampToValueAtTime(Math.max(.000001,level*.0005),end);
  env.gain.linearRampToValueAtTime(0,end+.006);
  const sources=[],replacement=samples.get(cfg.sample);
  if(replacement){
   const src=a.createBufferSource();src.buffer=replacement;src.detune.value=cfg.tune;
   src.connect(env);sources.push(src);
  }else{
   const noiseSrc=a.createBufferSource(),filter=a.createBiquadFilter();
   const nyquist=a.sampleRate*.46,color=.8+track.timbre*.004;
   noiseSrc.buffer=noiseFor(a);noiseSrc.loop=true;
   filter.type=pad===0?"lowpass":[2,3,7].includes(pad)?"highpass":"bandpass";
   filter.frequency.value=Math.min(nyquist,[740,2150,5800,5150,850,1330,1775,4000][pad]*tune*color);
   filter.Q.value=filterValues({type:filter.type,frequency:filter.frequency.value,q:pad===6?1.25:.68},a.sampleRate).Q;
   const noiseGain=gain(a,[.17,.85,.76,.66,.22,.29,.91,.51][pad]);
   if(pad===6){
    noiseGain.gain.setValueAtTime(.68,when);
    for(const t of [.009,.018,.029]){
     noiseGain.gain.setValueAtTime(.24,when+t);
     noiseGain.gain.linearRampToValueAtTime(.82,when+t+.0028);
    }
   }
   noiseSrc.connect(filter).connect(noiseGain).connect(env);sources.push(noiseSrc);
   const membrane=[51,166,0,0,87,122,0,0][pad];
   const frequencies=membrane?WPhysical.membrane(membrane):[null,null,[4351,5137,6377,8167,10079,12161],[4103,6119,7817,10391,12773,14753],null,null,[1260,1880],[2539,3971,4981,7919,9461,11941]][pad];
   const amount=[[.91,.104,.09,.038,.027],[.32,.12,.064,.042,.024],[.07,.055,.035,.02,.014,.008],[.075,.068,.056,.026,.016,.010],[.72,.22,.092,.048,.026],[.67,.24,.117,.041,.026],[.08,.04],[.13,.12,.081,.046,.024,.012]][pad];
   for(const [i,f] of frequencies.entries()){
    const hz=f*tune;if(hz>=nyquist)continue;
    const osc=a.createOscillator(),weight=gain(a,amount[i]);
    osc.frequency.setValueAtTime(Math.min(nyquist,hz*(pad===0?2.12:pad===4||pad===5?1.42:1.04)),when);
    osc.frequency.exponentialRampToValueAtTime(hz,when+(pad===0?.044:.022));
    if(i)weight.gain.setTargetAtTime(.0001,when+.010,[.083,.049,.029,.019][i-1]||.018);
    osc.connect(weight).connect(env);sources.push(osc);
   }
  }
  const job={stop:()=>{for(const src of sources)try{src.stop();}catch{}},node:env};
  voices.add(job);
  sources[0].onended=()=>{voices.delete(job);env.disconnect();pan.disconnect();wet.disconnect();};
  for(const src of sources){
   if(src.loop)src.start(when,(pad*.173+when*.371)%1);
   else src.start(when);
   src.stop(end+.012);
  }
 }
 const oscillatorWaves=new WeakMap();
 function sinePhase(a,phase){
  const key=phase.toFixed(2);
  if(!oscillatorWaves.has(a))oscillatorWaves.set(a,new Map());
  const bank=oscillatorWaves.get(a);
  if(!bank.has(key)){
   if(bank.size>384)bank.delete(bank.keys().next().value);
   bank.set(key,a.createPeriodicWave(Float32Array.of(0,Math.sin(phase)),Float32Array.of(0,Math.cos(phase)),{disableNormalization:true}));
  }
  return bank.get(key);
 }
 function pwm(a,duty,top,maxHz){
  const count=Math.round(clamp(Math.floor(top/maxHz),1,96)),key="pwm:"+duty+":"+count;
  if(!oscillatorWaves.has(a))oscillatorWaves.set(a,new Map());
  const bank=oscillatorWaves.get(a);
  if(!bank.has(key)){
   if(bank.size>384)bank.delete(bank.keys().next().value);
   const real=new Float32Array(count+1),imag=new Float32Array(count+1);
   for(let k=1;k<=count;k++)real[k]=2*Math.sin(k*Math.PI*duty)/(Math.PI*k);
   bank.set(key,a.createPeriodicWave(real,imag));
  }
  return bank.get(key);
 }
 function transitionVoice(a,track,n,when,target,ends,cents,pitchMoves){
  const v=WInstruments.get(track),model=v.model;
  const tail=v.release,duration=v.duration,finish=when+duration,stopAt=finish+tail+.02;
  const pan=a.createStereoPanner(),env=gain(a,0),tone=a.createOscillator();
  const detune=n.fine+v.tune;
  const highest=pitchMoves?.reduce((peak,point)=>Math.max(peak,point.value),cents)??cents;
  const nyquist=a.sampleRate*.46,limit=x=>clamp(x,20,nyquist);
  const limitTone=x=>clamp(x,12,nyquist/2**(Math.max(0,detune+highest)/1200));
  const base=WPhysical.hz(n.pitch-(model===2?24:0)),ratio=2**(v.sweep/12);
  const [first,last]=[[base/ratio,base],[base*ratio,base],[base*ratio,base],[base,base]][model].map(limitTone);
  const rise=[duration*.70,.018,.007,Math.min(.6,duration*.35)][model];
  const level=.30*(n.velocity/127)**(v.touch*.0118);
  const width=v.stereo/100,noise=a.createBufferSource(),filter=a.createBiquadFilter();
  const shadow=a.createDelay(.03),split=a.createStereoPanner(),air=gain(a,v.density/100),direct=gain(a,.72);
  const brightness=Math.min(v.cutoff,n.cutoff);
  pan.pan.value=n.pan/100;shadow.delayTime.value=.011*width;
  split.pan.value=width*.77;
  const balance=a.createStereoPanner();balance.pan.value=-width*.77;
  filter.type=model===3?"bandpass":"lowpass";
  filter.Q.value=filterValues({type:filter.type,frequency:brightness,q:model===3?1.15:.68},a.sampleRate).Q;
  const [cutFrom,cutTo]=[[.05,1],[1,.07],[1,.12],[.22,.62]][model];
  filter.frequency.setValueAtTime(limit(brightness*cutFrom),when);
  filter.frequency.exponentialRampToValueAtTime(limit(brightness*cutTo),finish);
  noise.buffer=noiseFor(a);noise.loop=true;
  noise.connect(filter).connect(air);air.connect(direct).connect(balance).connect(env);
  air.connect(shadow).connect(gain(a,.46*width)).connect(split).connect(env);
  tone.type=model===3?"triangle":"sine";
  tone.frequency.setValueAtTime(first,when);
  tone.frequency.exponentialRampToValueAtTime(last,model===2?when+Math.min(.16,duration):finish);
  tone.detune.setValueAtTime(detune+cents,when);
  for(const point of pitchMoves||[])tone.detune.linearRampToValueAtTime(detune+point.value,point.time);
  tone.connect(gain(a,[.36,.57,.93,.31][model]*(1-v.density*.007))).connect(env);
  env.connect(pan).connect(target);
  env.gain.setValueAtTime(0,when);env.gain.linearRampToValueAtTime(level,when+rise);
  env.gain.exponentialRampToValueAtTime(Math.max(.000001,level*[.80,.18,.014,.63][model]),finish);
  env.gain.exponentialRampToValueAtTime(.000001,stopAt-.01);env.gain.linearRampToValueAtTime(0,stopAt);
  tone.start(when);noise.start(when,(n.pitch*.131+when*.19)%1);
  tone.stop(stopAt);noise.stop(stopAt);
  let released=false;
  const job={track:track.id,key:n.pitch,node:pan,stop(){
   for(const source of [tone,noise])try{source.stop();}catch{}
  },release(at=a.currentTime){
   if(released||model!==3||at>=finish)return;
   released=true;
   const t=Math.max(at,when+.006);
   const current=t<when+rise?level*(t-when)/rise:level*.63**((t-when-rise)/(duration-rise));
   env.gain.cancelScheduledValues(t);env.gain.linearRampToValueAtTime(Math.max(.000001,current),t);
   const end=Math.min(stopAt,t+tail+.02);
   env.gain.exponentialRampToValueAtTime(.000001,end-.01);
   env.gain.linearRampToValueAtTime(0,end);tone.stop(end);noise.stop(end);
  }};
  tone.onended=()=>{voices.delete(job);pan.disconnect();};
  voices.add(job);if(ends!==null)job.release(ends);
  return job;
 }
 function voice(a,track,n,when,target,ends=null,cents=0,pitchMoves=null){
  if(track.kind==="drums"){hit(a,((n.pitch-60)%8+8)%8,when,target,track,n.velocity/127);return null;}
  if(track.kind==="fx")return transitionVoice(a,track,n,when,target,ends,cents,pitchMoves);
  if(!WModel.types[track.kind]?.[1]||track.kind==="audio")return null;
  const [,,defaultRelease,maxTone,amplitude]=WModel.types[track.kind];
  const kind=track.kind,cfg=WInstruments.get(track),guitar=WInstruments.isGuitar(kind);
  const rake=guitar?WInstruments.strumDelay(n,cfg):0;
  when+=rake;
  if(ends!==null)ends+=rake;
  if(rake&&pitchMoves)pitchMoves=pitchMoves.map(move=>({...move,time:move.time+rake}));
  let sustain=guitar?track.mix.fx.find(f=>f.kind==="sustain"&&f.enabled)?.values:null;
  const env=gain(a,0),lp=a.createBiquadFilter(),pan=a.createStereoPanner(),oscs=[],voicesForNote=[];
  const velocity=n.velocity/127;
  const brightness=kind==="flute"||kind==="cello"?.78+velocity*.27:1;
  const defaultCut=Math.min(n.cutoff,maxTone*(.4+track.timbre*.015)*brightness,a.sampleRate*.46);
  const articulation=guitar?[1,1.7,.7,1.2][cfg.articulation]:1;
  const onset=kind==="cello"||kind==="flute"?1.32-velocity*.49:1;
  const attack=kind==="synth"?cfg.attack:Math.max(.001,track.attack*articulation*onset);
  const level=amplitude*(n.velocity/127)**((cfg.touch??100)*.0118);
  lp.type=kind==="synth"?["lowpass","bandpass","highpass"][cfg.filterType]:"lowpass";
  const cut=kind==="synth"?Math.min(n.cutoff,cfg.cutoff,a.sampleRate*.46):defaultCut;
  lp.frequency.value=cut;
  if(kind==="synth"){
   lp.frequency.setValueAtTime(clamp(cut*(1-cfg.filterEnv*.008),40,a.sampleRate*.46),when);
   lp.frequency.exponentialRampToValueAtTime(clamp(cut*(1+cfg.filterEnv*.018),40,a.sampleRate*.46),when+attack);
   lp.frequency.setTargetAtTime(cut,when+attack+cfg.hold,cfg.decay*.52);
  }
  lp.Q.value=filterValues({type:lp.type,frequency:cut,q:kind==="synth"?cfg.res:n.q},a.sampleRate).Q;
  const stereo=kind==="synth"?cfg.spread:kind==="piano"?cfg.perspective:cfg.stereo??0;
  const layout=kind==="piano"?clamp((n.pitch-60)/45,-1,1)*stereo*.0044:
   (n.pitch%12-5.5)/5.5*stereo*.0044;
  pan.pan.value=clamp(n.pan/100+layout,-1,1);
  const extra=(cfg.tune??0)+(kind==="electric"?cfg.bend*100:0),pitch=n.fine+cents+extra;
  const guard=pitchMoves?.reduce((peak,point)=>Math.max(peak,Math.abs(n.fine+extra+point.value)),Math.abs(pitch))??Math.abs(pitch);
  const take=selectTake(a,track,n);
  const modeled=take?({electric:.27,piano:.24,nylon:.20})[take.kind]:1;
  const units=WPhysical.partials(kind,n.pitch,n.velocity,track.timbre,a.sampleRate,guard,cfg)
   .map(mode=>({...mode,amp:mode.amp*modeled}));
  const profile=WPhysical.profiles[kind];
  const movement=kind==="electric"?[5.2,cfg.vibrato,.19]:kind==="synth"?[cfg.rate,cfg.vibrato,.08]:profile?.vibrato;
  let depth=null;
  if(movement?.[1]>0){
   const [speed,width,delay]=movement,vibrato=a.createOscillator();vibrato.frequency.value=speed;
   depth=gain(a,0);vibrato.connect(depth);vibrato.start(when);oscs.push(vibrato);
   depth.gain.setValueAtTime(0,when);depth.gain.setTargetAtTime(width,when+delay,.13);
  }
  for(const mode of units){
   const oscillator=a.createOscillator(),part=gain(a,mode.amp);
   const tune=mode.detune??0;
   if(mode.wave==="pulse")oscillator.setPeriodicWave(pwm(a,mode.pulse,a.sampleRate*.46,mode.hz*2**((guard+100)/1200)));
   else if(mode.phase)oscillator.setPeriodicWave(sinePhase(a,mode.phase));
   else oscillator.type=mode.wave;
   oscillator.frequency.value=mode.hz;oscillator.detune.setValueAtTime(pitch+tune,when);
   if(mode.sweep>1){
    oscillator.frequency.setValueAtTime(mode.hz*mode.sweep,when);
    oscillator.frequency.exponentialRampToValueAtTime(mode.hz,when+.043);
   }
   if(pitchMoves)for(const item of pitchMoves)oscillator.detune.linearRampToValueAtTime(n.fine+extra+tune+item.value,item.time);
   if(mode.fm>0){
    const room=a.sampleRate*.43/(mode.hz*2**((guard+Math.abs(tune))/1200));
    const amount=clamp((room-1)/2-1,0,mode.fm);
    if(amount>0){
     const l=a.createOscillator(),index=gain(a,mode.hz*2*amount);
     l.frequency.value=mode.hz*2;l.detune.setValueAtTime(pitch+tune,when);
     if(pitchMoves)for(const item of pitchMoves)l.detune.linearRampToValueAtTime(n.fine+extra+tune+item.value,item.time);
     l.connect(index).connect(oscillator.frequency);l.start(when);oscs.push(l);
    }
   }
   if(mode.decay)part.gain.setTargetAtTime(mode.amp*Math.max(mode.remain,sustain?sustain.amount*.0098:0),when+.015,mode.decay);
   if(depth)depth.connect(oscillator.detune);
   voicesForNote.push({mode,part});oscillator.connect(part).connect(lp);oscillator.start(when);oscs.push(oscillator);
  }
  if(profile?.transient||profile?.breath){
   const [frequency,decay,amount]=profile.transient||profile.breath;
   const air=a.createBufferSource(),filter=a.createBiquadFilter(),breath=gain(a,0);
   air.buffer=noiseFor(a);air.loop=Boolean(profile.breath);filter.type="bandpass";
   filter.frequency.value=guitar?[frequency,frequency*.77,frequency*1.26,frequency*.91][cfg.articulation]:frequency;
   filter.Q.value=.82;
   const volume=amount*(.42+velocity*.64)*(cfg.noise===undefined?1:cfg.noise*.032)*(take?.kind==="electric"?.72:1);
   breath.gain.setValueAtTime(0,when);breath.gain.linearRampToValueAtTime(volume,when+.005);
   breath.gain.setTargetAtTime(profile.breath?amount*.38:0,when+.008,decay);
   air.connect(filter).connect(breath).connect(lp);air.start(when,(n.pitch*.083+when*.35)%(.54*air.buffer.duration));oscs.push(air);
  }
  if(take){
   const source=a.createBufferSource(),blend=gain(a,take.kind==="electric"?.90:take.kind==="piano"?.77:.80);
   source.buffer=take.buffer;
   source.playbackRate.value=2**(take.semitones/12);
   source.detune.setValueAtTime(pitch,when);
   if(depth)depth.connect(source.detune);
   if(pitchMoves)for(const item of pitchMoves)source.detune.linearRampToValueAtTime(n.fine+extra+item.value,item.time);
   source.connect(blend);
   if(take.kind==="electric"){
    // The DI captures its bridge pickup. Shape that signal toward other
    // positions in parallel with the computed string and pickup modes.
    const filter=a.createBiquadFilter(),body=a.createBiquadFilter(),tilt=a.createBiquadFilter();
    filter.type="lowpass";filter.Q.value=20*Math.log10(.64);
    filter.frequency.value=Math.min(a.sampleRate*.46,[12400,9700,8500,7600,6500][cfg.pickup]*(.20+cfg.tone*.0084)*[1,.93,.79][cfg.coil]);
    body.type="peaking";body.frequency.value=[2650,1800,1190,890,660][cfg.pickup];body.Q.value=.73;
    body.gain.value=[1,-2.3,1.8,-1.4,4.5][cfg.pickup]+[0,.8,1.4][cfg.coil];
    tilt.type="highshelf";tilt.frequency.value=1580;
    tilt.gain.value=[1,-1.5,-2.8,-3.2,-5.5][cfg.pickup]-(cfg.coil===2?1.8:0);
    blend.connect(filter).connect(body).connect(tilt).connect(lp);
    if(cfg.articulation===2)blend.gain.setTargetAtTime(.035,when+.018,.045+(.10-cfg.damp*.001));
   }else blend.connect(lp);
   source.start(when,take.offset,take.duration);
   oscs.push(source);
  }
  if(!oscs.length)return null;
  lp.connect(env).connect(pan);
  let bodyFeed=null;
  if(kind==="guitar"){
   const direct=gain(a,[.92,1,.83,.94][cfg.mic]);pan.connect(direct).connect(target);
   const roomMic=a.createDelay(.012),roomGain=gain(a,cfg.distance*.0022);
   roomMic.delayTime.value=cfg.distance/34300;
   pan.connect(roomMic).connect(roomGain).connect(target);
   bodyFeed=WPhysical.radiate(a,["guitar","parlor","nylon"][cfg.model],pan,target,cfg.body*.031*[1.20,.91,1.52,.65][cfg.mic]);
  }else{
   pan.connect(target);
   bodyFeed=WPhysical.radiate(a,kind,pan,target,kind==="piano"?cfg.resonance*.031*(1+cfg.pedal*.003):1);
  }
  env.gain.setValueAtTime(.0001,when);env.gain.linearRampToValueAtTime(level,when+attack);
  const plucked=guitar||["piano","rhodes","bass"].includes(kind);
  const floor=take?(take.kind==="electric"?.61:.72):guitar?.115:.36;
  if(kind==="synth"){
   const fall=when+attack+cfg.hold;
   env.gain.setValueAtTime(level,fall);env.gain.linearRampToValueAtTime(Math.max(.0001,level*cfg.sustain/100),fall+cfg.decay);
  }
  if(kind==="bass808")env.gain.setTargetAtTime(level*.10,when+attack+.032,.23+track.timbre*.006);
  if(plucked)env.gain.setTargetAtTime(level*(sustain?Math.max(floor,sustain.amount*.0103):floor),when+attack,sustain?sustain.attack*.001:.16+track.timbre*.004);
  let ended=false,latched=false,sustainSignature=JSON.stringify(sustain);
  const job={track:track.id,key:n.pitch,node:pan,stop:()=>{for(const o of oscs)try{o.stop();}catch{}},release(at=a.currentTime,force=false){
   if(ended)return;
   if(!force&&ends===null&&sustain?.latch){latched=true;return;}
   ended=true;latched=false;
   const t=Math.max(at,when+.005);
   const tail=clamp(sustain?sustain.release*.001:kind==="synth"?cfg.release:n.release*track.release/defaultRelease*(kind==="piano"||kind==="rhodes"?1+cfg.pedal*.013:1),.01,4);
   if(env.gain.cancelAndHoldAtTime)env.gain.cancelAndHoldAtTime(t);
   else{env.gain.cancelScheduledValues(t);env.gain.setValueAtTime(Math.max(.0001,env.gain.value),t);}
   env.gain.setTargetAtTime(.0001,t,tail*.21);
   for(const o of oscs)try{o.stop(t+tail+.03);}catch{}
  },releaseLatch(){if(latched)this.release(a.currentTime,true);},setSustain(next){
   if(!guitar||ended)return;
   const signature=JSON.stringify(next);if(sustainSignature===signature)return;
   sustainSignature=signature;sustain=next;
   if(!next&&latched){this.release(a.currentTime,true);return;}
   const t=Math.max(a.currentTime,when+attack);
   env.gain.cancelScheduledValues(t);env.gain.setTargetAtTime(level*(next?Math.max(floor,next.amount*.0103):floor),t,.088);
   for(const {mode,part} of voicesForNote)if(mode.decay){
    part.gain.cancelScheduledValues(t);part.gain.setTargetAtTime(mode.amp*(next?next.amount*.0098:mode.remain),t,.085);
   }
  }};
  if(guitar&&ends===null)for(const old of voices)if(old.track===track.id&&old.key===n.pitch)old.releaseLatch?.();
  voices.add(job);
  oscs[0].onended=()=>{voices.delete(job);pan.disconnect();depth?.disconnect();bodyFeed?.disconnect();};
  if(ends!==null)job.release(ends);
  return job;
 }
 function releaseLatches(id){for(const v of voices)if(v.track===id)v.releaseLatch?.();}
 function setBuffer(id,buffer){samples.set(id,buffer);}
 function forget(id){samples.delete(id);for(const key of stretched.keys())if(key.startsWith(id+":"))stretched.delete(key);}
 function resetBuffers(){samples.clear();stretched.clear();}
 async function decode(a,asset,id){
  if(samples.has(id))return samples.get(id);
  const binary=atob(asset.base64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
  const decoded=await a.decodeAudioData(bytes.buffer);samples.set(id,decoded);return decoded;
 }
 const stretchKey=(id,rate)=>id+":"+rate.toPrecision(10);
 async function prepare(a,p,selection=p.tracks.map(t=>[t,t.clips])){
  await Promise.all(selection.map(([track])=>prepareTakes(a,track)));
  const ids=new Set();
  for(const [t,clips] of selection){
   for(const c of clips)if(c.asset)ids.add(c.asset);
   for(const pad of t.kit||[])if(pad.sample)ids.add(pad.sample);
  }
  for(const id of ids)await decode(a,p.assets[id],id);
  const results=new Map();
  for(const [t,clips] of selection)for(const c of clips){
   if(!c.asset)continue;
   const sync=WModel.audioGrid(p,t,c),source=samples.get(c.asset);
   if(!sync.synced||Math.abs(sync.rate-1)<.0005)continue;
   const key=stretchKey(c.asset,sync.rate);
   if(results.has(key))continue;
   let entry=stretched.get(key);
   if(!entry){
    entry=await WTempo.stretch(a,source,sync.rate);
    const bytes=entry.length*entry.numberOfChannels*4;
    let used=[...stretched.values()].reduce((n,buf)=>n+buf.length*buf.numberOfChannels*4,0);
    while(stretched.size&&used+bytes>128*1024*1024){
     const oldest=stretched.keys().next().value,buf=stretched.get(oldest);
     used-=buf.length*buf.numberOfChannels*4;stretched.delete(oldest);
    }
    if(bytes<=128*1024*1024)stretched.set(key,entry);
   }
   results.set(key,entry);
  }
  return results;
 }
 function playClip(a,p,track,clip,startTime,fromBeat,toBeat,prepared){
  const s=graph.get(track.id);if(!s||track.kind==="bus")return;
  const spb=60/p.bpm,first=Math.max(0,fromBeat-clip.start),last=Math.min(clip.length,toBeat-clip.start);
  if(last<=first)return;
  const target=gain(a),pan=a.createStereoPanner();target.connect(pan).connect(s.local);
  const when=beat=>startTime+(clip.start+beat-fromBeat)*spb;
  function automate(param,points,convert,exponential=false){
   const ramp=(value,at)=>{
    if(exponential)param.exponentialRampToValueAtTime(convert(value),at);
    else param.linearRampToValueAtTime(convert(value),at);
   };
   param.setValueAtTime(convert(WModel.at(points,first)),when(first));
   for(const point of points)if(point.beat>first&&point.beat<last)ramp(point.value,when(point.beat));
   if(last<clip.length)ramp(WModel.at(points,last),when(last));
   else if(points.some(point=>point.beat===last))ramp(WModel.at(points,last),when(last));
  }
  automate(target.gain,clip.gain,dB,true);automate(pan.pan,clip.pan,v=>v/100);
  let timeout,eventTimer;
  const clipJob={node:pan,stop:()=>{clearTimeout(timeout);clearInterval(eventTimer);target.disconnect();pan.disconnect();}};
  voices.add(clipJob);
  const finish=when(last)+8;
  const cleanup=()=>{
   const remaining=(finish-a.currentTime)*1000;
   if(remaining>0){timeout=setTimeout(cleanup,Math.min(remaining,2147483647));return;}
   if(voices.delete(clipJob))clipJob.stop();
  };
  if(typeof a.startRendering!=="function")cleanup();
  const sync=WModel.audioGrid(p,track,clip),source=samples.get(clip.asset);
  const key=clip.asset?stretchKey(clip.asset,sync.rate):"";
  const baked=sync.synced&&(prepared?.get(key)||stretched.get(key));
  const buffer=baked||source;
  if(buffer){
   const pos=(clip.offset+first)*(baked?spb:(clip.sourceScale||spb));
   if(pos<buffer.duration){
    const src=a.createBufferSource();src.buffer=buffer;automate(src.detune,clip.pitch,v=>v);
    src.connect(target);src.start(when(first),pos);src.stop(when(last));
    const job={node:src,stop:()=>{try{src.stop();}catch{}}};voices.add(job);
    src.onended=()=>{voices.delete(job);src.disconnect();};
   }
  }
  const events=[];
  for(const n of clip.notes){
   const repeats=Math.max(1,Math.round(n.repeat));
   for(let i=0;i<repeats;i++){
    const onset=n.start+i*n.length/repeats,end=Math.min(last,n.start+(i+1)*n.length/repeats);
    if(end<=first||onset>=last)continue;
    const at=Math.max(onset,first);
    const moves=clip.pitch.filter(point=>point.beat>at&&point.beat<end).map(point=>({time:when(point.beat),value:point.value}));
    moves.push({time:when(end),value:WModel.at(clip.pitch,end)});
    events.push({at:when(at),fire:()=>voice(a,track,n,when(at),target,when(end),WModel.at(clip.pitch,at),moves)});
   }
  }
  if(track.kind==="drums")for(const step of clip.layers)if(step.beat>=first&&step.beat<last){
   events.push({at:when(step.beat),fire:()=>hit(a,step.pad,when(step.beat),target,track,step.velocity??.86)});
  }
  if(typeof a.startRendering==="function"){
   for(const event of events)event.fire();
  }else{
   events.sort((x,y)=>x.at-y.at);let next=0;
   const schedule=()=>{
    while(next<events.length&&events[next].at<a.currentTime+.19)events[next++].fire();
    if(next>=events.length){clearInterval(eventTimer);eventTimer=undefined;}
   };
   eventTimer=setInterval(schedule,38);schedule();
  }
 }
 function hardStop(){for(const job of voices)job.stop();voices.clear();}
 function reset(){
  hardStop();for(const s of graph.values()){
   s.volume.disconnect();s.tap.disconnect();s.destination?.disconnect();s.input.disconnect();s.fx.forEach(f=>f.dispose());s.tone?.dispose();
  }
  graph.clear();
 }
 return {apply,delayPlan,measure,voice,hit,decode,prepare,playClip,releaseLatches,setBuffer,forget,resetBuffers,hardStop,reset,graph};
}

const WDSP=createStudioEngine();
const studioRates=[48000,96000];
async function renderStudioMix(project,sampleRate=studioRates[0]){
 if(!studioRates.includes(sampleRate))throw new Error("Frecuencia de muestreo no compatible.");
 const spb=60/project.bpm;
 let end=0,hasNotes=false;
 for(const track of project.tracks)for(const clip of track.clips){
  end=Math.max(end,(clip.start+clip.length)*spb);
  hasNotes||=Boolean(clip.asset||clip.notes.length||clip.layers.length);
 }
 if(!hasNotes)throw new Error("Añade notas o audio al arreglo antes de exportar la mezcla.");
 const engine=createStudioEngine();
 const latency=engine.delayPlan(project,sampleRate).base+WModel.manualMs(project.master,project.bpm,sampleRate)/1000;
 const finish=end+Math.max(0,latency);
 if(finish>300)throw new Error("El arreglo con su compensación de latencia debe durar como máximo 5 minutos.");
 const frames=Math.ceil((finish+14)*sampleRate);
 const offline=new OfflineAudioContext(2,frames,sampleRate);
 const prepared=await engine.prepare(offline,project);
 engine.apply(offline,project,offline.destination);
 for(const track of project.tracks)for(const clip of track.clips)engine.playClip(offline,project,track,clip,0,0,clip.start+clip.length,prepared);
 const rendered=await offline.startRendering();
 const channels=[rendered.getChannelData(0),rendered.getChannelData(1)];
 const silence=10**(-76/20);
 let peak=0,last=0;
 for(const samples of channels)for(let i=0;i<samples.length;i++){
  const value=Math.abs(samples[i]);
  peak=Math.max(peak,value);
  if(value>silence)last=Math.max(last,i);
 }
 if(!Number.isFinite(peak)||peak<1e-5)throw new Error("La mezcla está en silencio. Revisa las pistas y el máster.");
 const length=Math.min(frames,Math.max(Math.ceil(finish*sampleRate),last+Math.ceil(.065*sampleRate)));
 if(length===frames){
  const fade=Math.ceil(.080*sampleRate);
  for(const samples of channels)for(let i=0;i<fade;i++)samples[frames-fade+i]*=(fade-1-i)/fade;
 }
 const ceiling=10**(-1/20);
 const gain=Math.min(1,ceiling/estimateTruePeak(channels,length,peak,ceiling));
 channels.forEach((samples,channel)=>{
  if(gain<1)for(let i=0;i<length;i++)samples[i]*=gain;
 });
 if(length===frames)return rendered;
 const buffer=offline.createBuffer(2,length,sampleRate);
 channels.forEach((samples,channel)=>buffer.copyToChannel(samples.subarray(0,length),channel));
 return buffer;
}

export { WDSP, renderStudioMix, studioRates };
