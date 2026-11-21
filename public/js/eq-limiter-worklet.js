import { PeakLimiter } from "./peak-limiter.js";

class LarpPeakLimiter extends AudioWorkletProcessor {
 static get parameterDescriptors(){
  return [{name:"ceiling",defaultValue:-1,minValue:-12,maxValue:0,automationRate:"k-rate"}];
 }
 constructor(){
  super();
  this.limiter=new PeakLimiter(sampleRate);
  this.report=0;
 }
 process(inputs,outputs,parameters){
  const [left,right=left]=inputs[0]||[],[outL,outR]=outputs[0];
  if(!outL)return true;
  const cap=10**(parameters.ceiling[0]/20);
  let gain=1;
  for(let i=0;i<outL.length;i++){
   this.limiter.step(left?.[i]??0,right?.[i]??0,cap);
   outL[i]=this.limiter.outL;
   if(outR)outR[i]=this.limiter.outR;
   gain=Math.min(gain,this.limiter.gain);
  }
  if(++this.report===12){this.report=0;this.port.postMessage(20*Math.log10(gain));}
  return true;
 }
}
registerProcessor("larp-peak-limiter",LarpPeakLimiter);
