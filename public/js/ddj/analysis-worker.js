import { analyzeHarmony } from "./harmony.js";

const BINS=860;

self.onmessage=({data:{samples,right,rate}})=>{
  try {
    const frames=Math.floor(samples.length);
    const trackSeconds=frames/rate;
    const hop=Math.max(1,Math.round(rate*.01));
    const envelope=new Float32Array(Math.ceil(frames/hop));
    const onsetEnergy=Array.from({length:3},()=>new Float32Array(envelope.length));
    const bands=[new Float32Array(BINS),new Float32Array(BINS),new Float32Array(BINS)];
    const alpha=(f)=>1-Math.exp(-2*Math.PI*f/rate);
    const sub=alpha(170),mid=alpha(2150);
    const detailRate=rate/hop;
    const detail=bands.map(()=>new Float32Array(Math.ceil(trackSeconds*detailRate)));
    const clipped=new Uint8Array(envelope.length);
    const weightL=kWeight(rate),weightR=right?kWeight(rate):null;
    const block=Math.max(1,Math.round(rate*.1)),energies=[];
    let l=0,m=0,lr=0,mr=0,energy=0,peak=0,lastL=0,lastR=0,flatL=0,flatR=0;
    for(let i=0;i<frames;i++){
      const x=samples[i];
      l+=sub*(x-l);m+=mid*(x-m);
      const at=Math.min(BINS-1,Math.floor(i*BINS/frames));
      const r=right?.[i]??x;
      energy+=weightL(x)**2+(weightR?weightR(r)**2:0);
      peak=Math.max(peak,Math.abs(x),Math.abs(r));
      if((i+1)%block===0){energies.push(energy/block);energy=0;}
      lr+=sub*(r-lr);mr+=mid*(r-mr);
      const bass=Math.max(Math.abs(l),Math.abs(lr));
      const middle=Math.max(Math.abs(m-l),Math.abs(mr-lr));
      const treble=Math.max(Math.abs(x-m),Math.abs(r-mr));
      const window=(i/hop)|0;
      flatL=Math.abs(x)>=.998&&Math.abs(x-lastL)<.00015?flatL+1:0;
      flatR=Math.abs(r)>=.998&&Math.abs(r-lastR)<.00015?flatR+1:0;
      if(flatL>=3||flatR>=3)clipped[window]=1;
      lastL=x;lastR=r;
      bands[0][at]=Math.max(bands[0][at],bass);
      bands[1][at]=Math.max(bands[1][at],middle);
      bands[2][at]=Math.max(bands[2][at],treble);
      detail[0][window]=Math.max(detail[0][window],bass);
      detail[1][window]=Math.max(detail[1][window],middle);
      detail[2][window]=Math.max(detail[2][window],treble);
      envelope[window]=Math.max(envelope[window],Math.abs(x),Math.abs(r));
      onsetEnergy[0][window]+=bass*bass;
      onsetEnergy[1][window]+=middle*middle;
      onsetEnergy[2][window]+=treble*treble;
    }
    const atDb=db=>Math.max(0,envelope.findIndex(value=>value>=10**(db/20)))*hop/rate;
    const onset=percussiveOnsets(onsetEnergy,hop);
    const result=detectGrid(onset,atDb(-60)*rate/hop,rate/hop);
    const grid=result.confidence>0?traceGrid(onset,result,rate/hop):[];
    const firstBeat=grid[0]?.time??null,bpm=grid[0]?.bpm??0;
    const phrases=estimatePhrases(bands,trackSeconds,bpm,firstBeat??0);
    const level=integratedLoudness(energies);
    const peakDb=peak>0?20*Math.log10(peak):null;
    const harmony=analyzeHarmony(samples,right,rate);
    self.postMessage({bands,detail,detailRate,envelope,clipped,harmony,loudness:level,peak:peakDb,
      signals:{"-60":atDb(-60),"-78":atDb(-78)},firstBeat,bpm,grid,confidence:result.confidence,phrases},
      [...bands,...detail,envelope,clipped].map(band=>band.buffer));
  } catch {
    self.postMessage({error:"No se pudo analizar esta señal."});
  }
};

function percussiveOnsets(energies,hop){
  const result=new Float32Array(energies[0].length);
  const weights=[.9,.44,.32];
  energies.forEach((band,index)=>{
    const prefix=new Float64Array(band.length+1);
    for(let i=0;i<band.length;i++)prefix[i+1]=prefix[i]+band[i];
    for(let i=0;i+3<band.length;i++){
      const signal=Math.sqrt((prefix[i+3]-prefix[i])/(3*hop));
      const start=Math.max(0,i-8),end=Math.max(start,i-1);
      const baseline=Math.sqrt((prefix[end]-prefix[start])/(7*hop));
      // An attack rises above its local floor. Averaging RMS windows suppresses
      // the carrier and the beating between sustained notes.
      result[i]+=weights[index]*Math.max(0,signal-1.15*baseline);
    }
  });
  return result;
}

function kWeight(rate){
  function section(b0,b1,b2,a0,a1,a2){
    let x1=0,x2=0,y1=0,y2=0;
    return x=>{
      const y=(b0*x+b1*x1+b2*x2-a1*y1-a2*y2)/a0;
      x2=x1;x1=x;y2=y1;y1=y;
      return y;
    };
  }
  const w1=2*Math.PI*1681.974/rate,A=10**(4/40),C=Math.cos(w1);
  const d=2*Math.sqrt(A)*Math.sin(w1)*Math.SQRT1_2;
  const shelf=section(A*((A+1)+(A-1)*C+d),-2*A*((A-1)+(A+1)*C),
    A*((A+1)+(A-1)*C-d),(A+1)-(A-1)*C+d,2*((A-1)-(A+1)*C),(A+1)-(A-1)*C-d);
  const w2=2*Math.PI*38.136/rate,c=Math.cos(w2),alpha=Math.sin(w2)/(2*.5003);
  const hp=section((1+c)/2,-(1+c),(1+c)/2,1+alpha,-2*c,1-alpha);
  return x=>hp(shelf(x));
}

function integratedLoudness(hops){
  const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  const loudness=energy=>-.691+10*Math.log10(energy);
  const blocks=hops.slice(3).map((_,i)=>(hops[i]+hops[i+1]+hops[i+2]+hops[i+3])/4);
  const audible=blocks.filter(value=>loudness(value)>=-70);
  if(!audible.length)return null;
  const gate=average(audible)*.1;
  return loudness(average(audible.filter(value=>value>=gate)));
}

function detectGrid(onset,first,fps){
  const start=Math.max(0,Math.floor(first));
  const end=Math.min(onset.length,Math.floor(start+fps*120));
  let strength=0;
  let variance=0;
  for(let i=start;i<end;i++){strength=Math.max(strength,onset[i]);variance+=onset[i]**2;}
  if(strength<.003||!variance||end-start<fps*4) return {bpm:0,first:0,confidence:0};
  const lower=Math.round(fps*60/190),upper=Math.round(fps*60/69);
  const scores=new Float32Array(2*upper+2);
  for(let lag=lower-2;lag<scores.length;lag++){
    let match=0;
    for(let i=start+lag;i<end;i++) match+=onset[i]*Math.max(onset[i-lag],.7*(onset[i-lag+1]||0),.7*(onset[i-lag-1]||0));
    scores[lag]=match/variance;
  }
  let best=0,lag=0;
  for(let i=lower;i<=upper;i++){
    if(scores[i]<scores[i-1]||scores[i]<scores[i+1])continue;
    const bpm=60*fps/i;
    const prior=1-.000023*(bpm-124)**2;
    const value=(scores[i]+.36*scores[i*2])*prior;
    if(value>best){best=value;lag=i;}
  }
  if(best<.105||!lag)return {bpm:0,first:0,confidence:0};
  const curve=scores[lag-1]-2*scores[lag]+scores[lag+1];
  const period=lag+(curve<-.001?Math.max(-.45,Math.min(.45,.5*(scores[lag-1]-scores[lag+1])/curve)):0);
  let bestPhase=start,fit=0;
  for(let i=start;i<start+lag;i++){
    let score=0;
    for(let j=i;j<Math.min(end,start+period*44);j+=period){
      const at=Math.round(j);
      score+=(onset[at]||0)+.65*((onset[at+1]||0)+(onset[at-1]||0));
    }
    if(score>fit){fit=score;bestPhase=i;}
  }
  return {bpm:60*fps/period,first:bestPhase/fps,confidence:Math.min(1,best),strength};
}

function traceGrid(onset,{bpm,first,strength},fps){
  const initial=fps*60/bpm;
  function peak(at,radius){
    let index=Math.max(1,Math.round(at)),score=0;
    for(let i=Math.max(1,Math.ceil(at-radius));i<=Math.min(onset.length-2,Math.floor(at+radius));i++){
      const value=onset[i];
      if(value<strength*.09||value<onset[i-1]||value<onset[i+1])continue;
      const preference=1-.55*Math.abs(i-at)/radius;
      if(value*preference>score){score=value*preference;index=i;}
    }
    if(!score)return null;
    const left=onset[index-1],center=onset[index],right=onset[index+1];
    const curvature=left-2*center+right;
    return index+(curvature<0?.5*(left-right)/curvature:0);
  }
  const hits=[];
  let predicted=first*fps,period=initial,prior=null,missed=0;
  // The strongest match can land a beat after the first audible attack.
  const preceding=peak(predicted-period,period*.15);
  if(preceding!==null)predicted=preceding;
  for(let beat=0;predicted<onset.length&&beat<onset.length/15;beat++){
    const detected=peak(predicted,period*(missed>=4?.29:.19));
    if(detected!==null){
      if(prior!==null&&!missed){
        const gap=detected-prior;
        if(Math.abs(gap-period)<period*.19)period=Math.max(initial*.72,Math.min(initial*1.35,.67*period+.33*gap));
      }
      hits.push({beat,at:detected});
      prior=detected;
      missed=0;
    }else missed++;
    predicted=(detected??predicted)+period;
  }
  const grid=[];
  let firstIndex=0;
  const append=(beat,at,step)=>{
    const old=grid.at(-1);
    const time=Math.max(0,at/fps);
    if(old){
      const expected=old.time+(beat-old.index)*60/old.bpm;
      if(Math.abs(time-expected)<.024&&Math.abs(step-fps*60/old.bpm)<.004*step)return;
      if(time<=old.time)return;
    }
    grid.push({index:beat,time,bpm:60*fps/step,meter:4,beat:((beat-firstIndex)%4)+1});
  };
  for(let beat=0,index=0;index<hits.length&&grid.length<200;beat+=8){
    const start=index;
    while(index<hits.length&&hits[index].beat<beat+12)index++;
    const window=hits.slice(start,index);
    index=start;
    while(index<hits.length&&hits[index].beat<beat+8)index++;
    if(window.length<7||window.at(-1).beat-window[0].beat<7)continue;
    const n=window.length;
    const center=window.reduce((sum,hit)=>sum+hit.beat/n,0);
    const mean=window.reduce((sum,hit)=>sum+hit.at/n,0);
    const step=window.reduce((sum,hit)=>sum+(hit.beat-center)*(hit.at-mean),0)/
      window.reduce((sum,hit)=>sum+(hit.beat-center)**2,0);
    const fit=mean+(beat-center)*step;
    const rms=Math.sqrt(window.reduce((sum,hit)=>sum+(hit.at-mean-(hit.beat-center)*step)**2/n,0));
    if(step<initial*.73||step>initial*1.34||rms>fps*.033)continue;
    if(!grid.length&&beat>0){
      const origin=fit-beat*step;
      // A weak intro can delay the first trustworthy fit. Reconstruct its
      // phase from the first stable window to avoid an offbeat opening grid.
      if(beat<=16&&Math.abs(origin-first*fps)<initial*.58){
        const prior=peak(origin-step,step*.17);
        firstIndex=prior===null?0:-1;
        append(firstIndex,prior??origin,step);
      }else append(0,first*fps,initial);
    }
    append(beat,fit,step);
  }
  if(!grid.length)append(0,first*fps,initial);
  return grid.map(({index,...marker})=>marker);
}

function estimatePhrases(bands,duration,bpm,anchor){
  if(!bpm||duration<30)return [];
  const group=60/bpm*16;
  const blocks=[];
  for(let t=anchor;t+group<=duration;t+=group){
    const a=Math.floor(t/duration*BINS),b=Math.min(BINS,Math.ceil((t+group)/duration*BINS));
    let total=0,low=0;
    for(let i=a;i<b;i++){low+=bands[0][i];total+=bands[0][i]+bands[1][i]+bands[2][i];}
    blocks.push({time:t,level:total/Math.max(1,b-a),low:low/Math.max(.01,total)});
  }
  const result=[{time:Math.max(0,anchor),name:"Intro sugerida"}];
  for(let i=1;i<blocks.length&&result.length<12;i++){
    const before=blocks[i-1],next=blocks[i];
    if(Math.abs(next.level-before.level)>Math.max(.06,before.level*.34)||Math.abs(next.low-before.low)>.12){
      result.push({time:next.time,name:i===blocks.length-1?"Outro sugerido":`Cambio ${result.length}`});
    }
  }
  if(result.length===1) for(let i=2;i<blocks.length&&result.length<8;i+=2) result.push({time:blocks[i].time,name:`Frase ${result.length+1}`});
  return result;
}
