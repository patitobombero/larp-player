class LarpCapture extends AudioWorkletProcessor {
 constructor({processorOptions:{start,maximum,channels}}){
  super();this.at=start;this.limit=maximum;this.channels=channels;
  this.count=0;this.size=4096;this.pos=0;this.pcm=new Float32Array(this.size*channels);
  this.done=false;
  this.port.onmessage=e=>{if(e.data==="stop")this.finish();};
 }
 flush(){
  if(!this.pos)return;
  const part=this.pcm.subarray(0,this.pos*this.channels);
  this.port.postMessage({pcm:part},[part.buffer]);
  this.pcm=new Float32Array(this.size*this.channels);this.pos=0;
 }
 finish(){if(this.done)return;this.done=true;this.flush();this.port.postMessage({done:true});}
 process(inputs,outputs){
  if(this.done)return false;
  const input=inputs[0]||[];
  const frames=outputs[0][0].length;
  for(let i=Math.max(0,this.at-currentFrame);i<frames;i++){
   for(let ch=0;ch<this.channels;ch++)this.pcm[this.pos*this.channels+ch]=input[ch]?.[i]||0;
   if(++this.pos===this.size)this.flush();
   if(++this.count>=this.limit){this.finish();return false;}
  }
  return true;
 }
}
registerProcessor("larp-pcm-capture",LarpCapture);
