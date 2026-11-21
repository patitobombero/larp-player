// The independent key effect preserves transport time. For matched monitoring,
// an unshifted deck can follow the same analysis-window delay.
const SIZE=sampleRate>=88200?4096:2048;
const HOP=SIZE/4;
const RING=SIZE*4;
const TAU=2*Math.PI;
const HALF=SIZE/2;
const order=new Uint16Array(SIZE);
const windowValues=new Float32Array(SIZE);
const cosine=new Float32Array(HALF);
const sine=new Float32Array(HALF);
for(let i=0;i<SIZE;i++){
  let v=i,reverse=0;
  for(let n=SIZE;n>1;n>>=1){reverse=(reverse<<1)|(v&1);v>>=1;}
  order[i]=reverse;
  windowValues[i]=.5-.5*Math.cos(TAU*i/SIZE);
  if(i<HALF){cosine[i]=Math.cos(TAU*i/SIZE);sine[i]=Math.sin(TAU*i/SIZE);}
}
function fft(real,imaginary,inverse) {
  for(let i=0;i<SIZE;i++){
    const j=order[i];
    if(j<=i)continue;
    const a=real[i],b=imaginary[i];
    real[i]=real[j];imaginary[i]=imaginary[j];real[j]=a;imaginary[j]=b;
  }
  for(let size=2;size<=SIZE;size*=2){
    const step=SIZE/size,half=size/2;
    for(let start=0;start<SIZE;start+=size){
      for(let k=0,j=0;k<half;k++,j+=step){
        const a=start+k,b=a+half;
        const cos=cosine[j],sin=inverse?sine[j]:-sine[j];
        const re=real[b]*cos-imaginary[b]*sin,im=real[b]*sin+imaginary[b]*cos;
        real[b]=real[a]-re;imaginary[b]=imaginary[a]-im;
        real[a]+=re;imaginary[a]+=im;
      }
    }
  }
}

function channelState() {
  return {
    input:new Float32Array(RING),output:new Float32Array(RING),
    real:new Float32Array(SIZE),imaginary:new Float32Array(SIZE),
    previous:new Float32Array(HALF+1),synthesis:new Float64Array(HALF+1),
    measured:new Float64Array(HALF+1),magnitude:new Float64Array(HALF+1),
    angle:new Float64Array(HALF+1),peaks:new Uint16Array(HALF+1)
  };
}

function transpose(channel,offset,factor,reset) {
  const {input,output,real,imaginary,previous,synthesis,measured,magnitude,angle,peaks}=channel;
  imaginary.fill(0);
  for(let i=0;i<SIZE;i++)real[i]=input[(offset-SIZE+i)&(RING-1)]*windowValues[i];
  fft(real,imaginary,false);
  for(let k=0;k<=HALF;k++){
    const phi=Math.atan2(imaginary[k],real[k]);
    const advance=TAU*k*HOP/SIZE;
    let diff=phi-previous[k]-advance;
    diff-=TAU*Math.round(diff/TAU);
    previous[k]=angle[k]=phi;
    measured[k]=advance+diff;
    magnitude[k]=Math.hypot(real[k],imaginary[k]);
    synthesis[k]=reset?phi:(synthesis[k]+measured[k]*factor)%TAU;
  }
  let count=0;
  for(let k=1;k<HALF;k++)if(magnitude[k]>magnitude[k-1]&&magnitude[k]>=magnitude[k+1])peaks[count++]=k;
  real.fill(0);imaginary.fill(0);
  let anchor=0;
  for(let k=1;k<HALF;k++){
    while(anchor+1<count&&k-peaks[anchor]>peaks[anchor+1]-k)anchor++;
    const peak=count?peaks[anchor]:k;
    const target=Math.round(peak*factor)+k-peak;
    if(target<=0||target>=HALF)continue;
    const phase=synthesis[peak]+angle[k]-angle[peak];
    real[target]+=magnitude[k]*Math.cos(phase);
    imaginary[target]+=magnitude[k]*Math.sin(phase);
  }
  for(let k=1;k<HALF;k++){
    real[SIZE-k]=real[k];imaginary[SIZE-k]=-imaginary[k];
  }
  fft(real,imaginary,true);
  const scale=HOP/(SIZE*SIZE*.375);
  for(let i=0;i<SIZE;i++)output[(offset+i)&(RING-1)]+=real[i]*windowValues[i]*scale;
}

class LarpShift extends AudioWorkletProcessor {
  static get parameterDescriptors(){
    return [
      {name:"semitones",defaultValue:0,minValue:-24,maxValue:24,automationRate:"k-rate"},
      {name:"aligned",defaultValue:0,minValue:0,maxValue:1,automationRate:"k-rate"},
      {name:"protect",defaultValue:1,minValue:0,maxValue:1,automationRate:"k-rate"}
    ];
  }
  constructor(){
    super();
    this.channels=[channelState(),channelState()];
    this.offset=0;
    this.renderedFrames=0;
    this.wet=0;
    this.delayBlend=0;
    this.transients=new Float32Array(RING);
    this.fast=0;this.slow=0;
    this.lastAttack=-Infinity;
    this.quietFrames=0;
    this.fastCoeff=1-Math.exp(-1/(sampleRate*.0025));
    this.slowCoeff=1-Math.exp(-1/(sampleRate*.042));
    this.attackHold=Math.round(sampleRate*.022);
    this.attackFade=Math.round(sampleRate*.012);
  }
  process(inputs,outputs,params){
    const input=inputs[0],out=outputs[0];
    if(!out?.length)return true;
    const shift=params.semitones[0];
    const active=Math.abs(shift)>.025;
    const protect=params.protect[0]>.5;
    const align=active||params.aligned?.[0]>.5;
    const factor=2**(shift/12);
    const mask=RING-1;
    for(let i=0;i<out[0].length;i++){
      const offset=this.offset;
      const amplitude=Math.max(Math.abs(input?.[0]?.[i]||0),Math.abs(input?.[1]?.[i]||0));
      this.quietFrames=amplitude<1e-7?this.quietFrames+1:0;
      this.fast+=(amplitude-this.fast)*this.fastCoeff;
      this.slow+=(amplitude-this.slow)*this.slowCoeff;
      if(offset-this.lastAttack>sampleRate*.085&&this.fast>.018&&this.fast>this.slow*2.55){
        this.lastAttack=offset;
        const back=Math.round(sampleRate*.008);
        for(let j=1;j<=back;j++)this.transients[(offset-j)&mask]=1;
      }
      const tail=offset-this.lastAttack-this.attackHold;
      this.transients[offset&mask]=tail<=0?1:Math.max(0,1-tail/this.attackFade);
      const preserve=protect?this.transients[(offset-SIZE)&mask]:0;
      this.delayBlend+=(Number(align)-this.delayBlend)*.003;
      const target=active&&this.renderedFrames>=SIZE/HOP?1:0;
      this.wet+=(target-this.wet)*.003;
      for(let ch=0;ch<out.length;ch++){
        const state=this.channels[ch];
        const value=input?.[ch]?.[i]??input?.[0]?.[i]??0;
        state.input[offset&mask]=value;
        const delayed=state.input[(offset-SIZE)&mask];
        const shifted=state.output[offset&mask];
        state.output[offset&mask]=0;
        const direct=value+(delayed-value)*this.delayBlend;
        out[ch][i]=direct+(shifted-direct)*this.wet*(1-preserve);
      }
      this.offset++;
      if(this.offset>=SIZE&&this.offset%HOP===0){
        if(active&&this.quietFrames<SIZE*8){
          for(const state of this.channels)transpose(state,this.offset,factor,this.renderedFrames===0);
          this.renderedFrames++;
        }else this.renderedFrames=0;
      }
    }
    return true;
  }
}
registerProcessor("larp-shift",LarpShift);
