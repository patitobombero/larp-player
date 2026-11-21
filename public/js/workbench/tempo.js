import { clamp } from "./host.js";
const WTempo=(()=>{
 const estimate=(audio)=>{
  const stride=Math.round(audio.sampleRate/120);
  const length=Math.min(audio.length,Math.round(audio.sampleRate*90));
  const count=Math.floor(length/stride),channels=Array.from({length:Math.min(audio.numberOfChannels,2)},(_,i)=>audio.getChannelData(i));
  if(count<310)return {bpm:0,candidate:0,confidence:0};
  const env=new Float32Array(count),low=new Float32Array(count),onset=new Float32Array(count);
  const blockStep=Math.max(1,Math.floor(audio.sampleRate/10000));let bass=0;
  const coeff=1-Math.exp(-2*Math.PI*145*blockStep/audio.sampleRate);
  for(let i=0;i<count;i++){
   let total=0,bottom=0;
   for(let k=i*stride;k<(i+1)*stride;k+=blockStep){
    let sum=0;
    for(const channel of channels)sum+=Math.abs(channel[k]);
    bass+=(channels[0][k]-bass)*coeff;
    total+=sum/channels.length;bottom+=Math.abs(bass);
   }
   env[i]=Math.log1p(total*45*blockStep/stride);low[i]=Math.log1p(bottom*65*blockStep/stride);
   if(i>2)onset[i]=Math.max(0,env[i]-env[i-3])+.6*Math.max(0,low[i]-low[i-3]);
  }
  let average=0,variance=0,flux=0,contrast=0;
  for(let i=1;i<count;i++){average+=env[i];flux+=onset[i];}
  average/=count;
  for(let i=1;i<count;i++){variance+=(env[i]-average)**2;contrast+=onset[i]**2;}
  if(variance/count<.000035||contrast<.015||flux/count<.00015)return {bpm:0,candidate:0,confidence:0};
  const corr=lag=>{
   let hits=0,left=0,right=0;
   const baseline=flux/count;
   for(let i=lag+1;i<count;i++){
    const x=onset[i]-baseline,y=onset[i-lag]-baseline;
    hits+=x*y;left+=x*x;right+=y*y;
   }
   return hits/Math.sqrt(left*right+1e-12);
  };
  const fps=audio.sampleRate/stride,score=[];
  const min=Math.ceil(60*fps/210),max=Math.floor(60*fps/52);
  for(let i=min-1;i<=max+1;i++){
   const bpm=60*fps/i;
   const bias=Math.exp(-.5*(Math.log(bpm/116)/.46)**2);
   score[i]=corr(i)+.20*corr(i*2)+.08*corr(i*3)+.085*bias;
  }
  let peak=min;
  for(let i=min+1;i<=max;i++)if(score[i]>score[peak])peak=i;
  const d=score[peak-1]-2*score[peak]+score[peak+1];
  const lag=peak+(d===0?0:clamp(.5*(score[peak-1]-score[peak+1])/d,-.5,.5));
  const candidate=Math.round(60*fps/lag*10)/10;
  const confidence=clamp((corr(peak)-.13)/.72,0,1);
  return {bpm:confidence>=.42?candidate:0,candidate,confidence};
 };
 // WSOLA: anclaje al reloj de origen, búsqueda local de fase y fundidos complementarios.
 async function stretch(ctx,source,rate){
  if(Math.abs(rate-1)<.0005)return source;
  const sr=source.sampleRate,frame=Math.round(.046*sr),hop=frame>>1;
  const radius=Math.round(.014*sr),count=Math.max(1,Math.round(source.length/rate));
  const channels=Array.from({length:source.numberOfChannels},(_,i)=>source.getChannelData(i));
  const output=ctx.createBuffer(source.numberOfChannels,count,sr);
  const out=channels.map((_,i)=>output.getChannelData(i));
  const win=Float32Array.from({length:hop},(_,i)=>.5-.5*Math.cos(Math.PI*i/hop));
  const step=Math.max(2,Math.round(sr/4800));
  const analysis=channels[0],other=channels[1];
  const mono=i=>analysis[i]*.78+(other?.[i]||0)*.22;
  const similarity=(prev,next)=>{
   let ab=0,aa=0,bb=0;
   for(let i=0;i<hop;i+=step*2){
    const a=mono(prev+i)||0,b=mono(next+i)||0;
    ab+=a*b;aa+=a*a;bb+=b*b;
   }
   return aa*bb<1e-10?-2:ab/Math.sqrt(aa*bb);
  };
  let prev=0;
  out.forEach((channel,i)=>channel.set(channels[i].subarray(0,Math.min(hop,count))));
  for(let pos=hop,blocks=0;pos<count;pos+=hop,blocks++){
   const ref=prev+hop,expected=Math.floor(pos*rate);
   let best=expected,quality=-Infinity;
   if(expected+hop<source.length&&ref+hop<source.length){
    const begin=Math.max(0,expected-radius),end=Math.min(expected+radius,source.length-hop);
    for(let coarse=begin;coarse<=end;coarse+=step){
     const merit=similarity(ref,coarse)-.07*Math.abs(coarse-expected)/radius;
     if(merit>quality){quality=merit;best=coarse;}
    }
    const center=best;
    for(let exact=Math.max(begin,center-step+1);exact<=Math.min(end,center+step-1);exact++){
     const merit=similarity(ref,exact)-.07*Math.abs(exact-expected)/radius;
     if(merit>quality){quality=merit;best=exact;}
    }
    if(quality<=-2)best=expected;
   }
   for(let c=0;c<out.length;c++){
    for(let i=0;i<Math.min(hop,count-pos);i++)out[c][pos+i]=(channels[c][ref+i]||0)*(1-win[i])+(channels[c][best+i]||0)*win[i];
   }
   prev=best;
   if(blocks&&blocks%28===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return output;
 }
 return {estimate,stretch};
})();

export { WTempo };
