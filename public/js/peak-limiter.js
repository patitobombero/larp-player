// One linked gain for L/R. The deque holds the maximum over the look-ahead
// interval in amortized constant time without allocating per audio frame.
const taps=32;
const sinc=x=>Math.abs(x)<1e-10?1:Math.sin(Math.PI*x)/(Math.PI*x);
const [first,half,last]=[.25,.5,.75].map(fraction=>{
 const coefficients=Float64Array.from({length:taps},(_,i)=>{
  const distance=i-(taps/2-1)-fraction;
  return sinc(distance)*sinc(distance/(taps/2));
 });
 const sum=coefficients.reduce((a,b)=>a+b,0);
 return coefficients.map(value=>value/sum);
});
const reconstructionBound=Math.max(...[first,half,last].map(phase=>phase.reduce((sum,k)=>sum+Math.abs(k),0)));

export function estimateTruePeak(channels,length,peak,floor){
 if(peak*reconstructionBound<=floor)return peak;
 const block=256,center=taps/2-1;
 for(const samples of channels)for(let start=0;start<length;start+=block){
  const end=Math.min(length,start+block);
  let local=0;
  for(let i=Math.max(0,start-center);i<Math.min(length,end+taps-center);i++)local=Math.max(local,Math.abs(samples[i]));
  if(local*reconstructionBound<=Math.max(floor,peak))continue;
  for(let i=start;i<end;i++){
   let p1=0,p2=0,p3=0;
   const left=i-center,lo=Math.max(0,-left),hi=Math.min(taps,length-left);
   for(let k=lo;k<hi;k++){
    const x=samples[left+k];
    p1+=x*first[k];p2+=x*half[k];p3+=x*last[k];
   }
   peak=Math.max(peak,Math.abs(p1),Math.abs(p2),Math.abs(p3));
  }
 }
 return peak;
}

export class PeakLimiter {
 constructor(rate){
  this.latency=Math.max(1,Math.round(rate*.004));
  this.capacity=Math.max(taps,this.latency+3);
  this.left=new Float32Array(this.capacity);
  this.right=new Float32Array(this.capacity);
  this.maxima=new Float32Array(this.capacity);
  this.indices=new Float64Array(this.capacity);
  this.head=0;this.size=0;this.frame=0;this.gain=1;
  this.release=1-Math.exp(-1/(rate*.085));
  this.outL=0;this.outR=0;
 }
 step(left,right,ceiling){
  const {capacity}=this,index=this.frame++,slot=index%capacity;
  const oldest=index-this.latency;
  this.left[slot]=left;this.right[slot]=right;
  // Estimate the three fractional-sample peaks from the most recent
  // 32 samples. Their centres are only 16 frames old, inside the look-ahead.
  let firstL=0,firstR=0,halfL=0,halfR=0,lastL=0,lastR=0;
  let frame=(slot+capacity-taps+1)%capacity;
  for(let i=0;i<taps;i++){
   const l=this.left[frame],r=this.right[frame];
   firstL+=l*first[i];firstR+=r*first[i];
   halfL+=l*half[i];halfR+=r*half[i];
   lastL+=l*last[i];lastR+=r*last[i];
   if(++frame===capacity)frame=0;
  }
  const peak=Math.fround(Math.max(Math.abs(left),Math.abs(right),Math.abs(firstL),Math.abs(firstR),
   Math.abs(halfL),Math.abs(halfR),Math.abs(lastL),Math.abs(lastR)));
  while(this.size&&this.indices[this.head]<oldest){
   this.head=(this.head+1)%capacity;this.size--;
  }
  while(this.size&&this.maxima[(this.head+this.size-1)%capacity]<=peak)this.size--;
  const end=(this.head+this.size++)%capacity;
  this.maxima[end]=peak;this.indices[end]=index;
  const allowed=Math.min(1,ceiling/Math.max(1e-12,this.maxima[this.head]));
  this.gain=allowed<this.gain?allowed:this.gain+(allowed-this.gain)*this.release;
  const out=(oldest+capacity)%capacity;
  this.outL=oldest<0?0:Math.min(ceiling,Math.max(-ceiling,this.left[out]*this.gain));
  this.outR=oldest<0?0:Math.min(ceiling,Math.max(-ceiling,this.right[out]*this.gain));
 }
}

export function limitBuffer(buffer,ceilingDb){
 const limiter=new PeakLimiter(buffer.sampleRate),ceiling=10**(ceilingDb/20);
 const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
 for(let i=0;i<left.length+limiter.latency;i++){
  limiter.step(left[i]??0,right[i]??0,ceiling);
  const target=i-limiter.latency;
  if(target>=0){left[target]=limiter.outL;right[target]=limiter.outR;}
 }
 return buffer;
}
