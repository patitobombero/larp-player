export const butterworthQ=Math.SQRT1_2;
const gainDb=value=>10**(value/20);
export const usesQ=type=>type!=="lowshelf"&&type!=="highshelf";

export function filterSpecs(settings,bypass=false){
 return bypass?[]:[
  ...(settings.hp?[{type:"highpass",frequency:settings.highpass,q:butterworthQ}]:[]),
  ...(settings.lp?[{type:"lowpass",frequency:settings.lowpass,q:butterworthQ}]:[]),
  ...settings.bands.filter(band=>band.on)
 ];
}

export function filterValues(spec,rate){
 const q=spec.q??butterworthQ;
 return {frequency:Math.min(rate*.498,spec.frequency),gain:spec.gain??0,
  Q:["highpass","lowpass"].includes(spec.type)?20*Math.log10(q):q};
}

const set=(node,value,context,now)=>{
 if(now)node.setValueAtTime(value,context.currentTime);
 else node.setTargetAtTime(value,context.currentTime,.012);
};

function stage(context,input,type){
 const filter=context.createBiquadFilter(),wet=context.createGain(),dry=context.createGain(),output=context.createGain();
 filter.type=type;
 input.connect(filter).connect(wet).connect(output);
 input.connect(dry).connect(output);
 return {filter,wet,dry,output};
}

export function createEqGraph(context,source,bands){
 const pre=context.createGain();
 const hp=stage(context,pre,"highpass"),lp=stage(context,hp.output,"lowpass");
 let end=lp.output;
 const filters=bands.map(spec=>{
  const filter=stage(context,end,spec.type);
  end=filter.output;
  return filter;
 });
 const compressor=context.createDynamicsCompressor();
 const compWet=context.createGain(),compDry=context.createGain(),post=context.createGain();
 end.connect(compressor).connect(compWet).connect(post);
 end.connect(compDry).connect(post);
 const stereo=context.createGain(),split=context.createChannelSplitter(2),merge=context.createChannelMerger(2);
 stereo.channelCount=2;stereo.channelCountMode="explicit";
 const levels=[context.createGain(),context.createGain()];
 post.connect(stereo).connect(split);
 levels.forEach((level,i)=>{split.connect(level,i);level.connect(merge,0,i);});
 const trim=context.createGain();
 source.connect(pre);
 merge.connect(trim);
 const tune=(node,config,enabled,now)=>{
  node.filter.type=config.type;
  const values=filterValues(config,context.sampleRate);
  for(const [key,value] of Object.entries(values))set(node.filter[key],value,context,now);
  set(node.dry.gain,enabled?0:1,context,now);
  set(node.wet.gain,enabled?1:0,context,now);
 };
 return {output:trim,compressor,apply(settings,bypass=false,now=false){
  set(pre.gain,gainDb(settings.pre),context,now);
  set(trim.gain,gainDb(settings.trim),context,now);
  const right=settings.balance/100;
  set(levels[0].gain,1-Math.max(0,right),context,now);
  set(levels[1].gain,1+Math.min(0,right),context,now);
  tune(hp,{type:"highpass",frequency:settings.highpass},settings.hp&&!bypass,now);
  tune(lp,{type:"lowpass",frequency:settings.lowpass},settings.lp&&!bypass,now);
  filters.forEach((filter,i)=>tune(filter,settings.bands[i],settings.bands[i].on&&!bypass,now));
  set(compDry.gain,settings.compressor?0:1,context,now);
  set(compWet.gain,settings.compressor?1:0,context,now);
  set(compressor.threshold,settings.threshold,context,now);
  set(compressor.ratio,settings.ratio,context,now);
  set(compressor.knee,settings.knee,context,now);
  set(compressor.attack,settings.attack/1000,context,now);
  set(compressor.release,settings.release/1000,context,now);
 }};
}

export function measureResponse(filter,settings,bypass,frequencies){
 const result=new Float32Array(frequencies.length);
 const magnitudes=new Float32Array(frequencies.length),phases=new Float32Array(frequencies.length);
 for(const spec of filterSpecs(settings,bypass)){
  filter.type=spec.type;
  for(const [key,value] of Object.entries(filterValues(spec,filter.context.sampleRate)))filter[key].value=value;
  filter.getFrequencyResponse(frequencies,magnitudes,phases);
  for(let i=0;i<result.length;i++)if(Number.isFinite(magnitudes[i]))result[i]+=20*Math.log10(Math.max(magnitudes[i],1e-6));
 }
 return result;
}

export function createLimiterSlot(context,input){
 const output=context.createGain(),dry=context.createGain(),wet=context.createGain();
 const fallback=context.createDynamicsCompressor(),stop=context.createWaveShaper();
 input.connect(dry).connect(output);
 input.connect(fallback).connect(stop).connect(wet).connect(output);
 fallback.ratio.value=20;fallback.knee.value=0;fallback.attack.value=.003;fallback.release.value=.09;
 let node=null,ceiling,threshold,reduction=0;
 const activate=async()=>{
  if(!context.audioWorklet||typeof AudioWorkletNode!=="function")return;
  try{
   await context.audioWorklet.addModule(new URL("./eq-limiter-worklet.js",import.meta.url));
   if(context.state==="closed")return;
   node=new AudioWorkletNode(context,"larp-peak-limiter",{outputChannelCount:[2]});
   node.parameters.get("ceiling").value=threshold??-1;
   node.port.onmessage=({data})=>{reduction=data;};
   input.connect(node).connect(wet);
   stop.disconnect(wet);
   input.disconnect(fallback);
  }catch{}
 };
 const ready=activate();
 return {output,ready,get reduction(){return wet.gain.value<.01?0:node?reduction:fallback.reduction;},
  apply(enabled,db,now=false){
   threshold=db;
   set(dry.gain,enabled?0:1,context,now);
   set(wet.gain,enabled?1:0,context,now);
   if(node)set(node.parameters.get("ceiling"),db,context,now);
   else if(ceiling!==db){
    ceiling=db;
    const cap=gainDb(db);
    stop.curve=Float32Array.from({length:4097},(_,i)=>Math.max(-cap,Math.min(cap,i/2048-1)));
    set(fallback.threshold,db,context,now);
   }
  }};
}
