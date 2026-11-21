const wrap=(value,length=12)=>((value%length)+length)%length;
const clamp=(value,max=1)=>Math.max(0,Math.min(max,value));
const pitchNames=["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
const camelotMajor=[11,6,1,8,3,10,5,0,7,2,9,4];
const pretty=(root,minor)=>`${pitchNames[root]}${minor?"m":""} · ${camelotMajor.indexOf(wrap(root+(minor?3:0)))+1}${minor?"A":"B"}`;
const scales=[
  [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
  [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]
];
const chromaBasis=Array.from({length:12},(_,note)=>[7,3,4].flatMap((degree,index)=>{
  const angle=2*Math.PI*degree*note/12, weight=index===2?.5:1;
  return [weight*Math.cos(angle),weight*Math.sin(angle)];
}));

const distribution=values=>{
  const sum=values.reduce((acc,value)=>acc+value,0);
  return sum?values.map(value=>value/sum):values;
};
const squared=values=>values.reduce((sum,value)=>sum+value*value,0);
const centered=values=>values.map(value=>value-values.reduce((sum,v)=>sum+v/12,0));
const templates=scales.map(scale=>{
  const center=centered(scale), norm=Math.sqrt(squared(center));
  return center.map(value=>value/norm);
});

function keyFromChroma(chroma){
  const center=centered(Array.from(chroma)), norm=Math.sqrt(squared(center));
  if(norm<.005)return null;
  const fits=[];
  for(let mode=0;mode<templates.length;mode++)for(let root=0;root<12;root++){
    const score=templates[mode].reduce((sum,weight,i)=>sum+weight*center[(i+root)%12],0)/norm;
    fits.push({root,minor:Boolean(mode),score});
  }
  fits.sort((a,b)=>b.score-a.score);
  const key=fits[0];
  return {...key,confidence:clamp((key.score-.3)*1.15)*clamp(.45+3*(key.score-fits[1].score))};
}

export function parseKey(text){
  const value=String(text??"").trim().replaceAll("♯","#").replaceAll("♭","b");
  const wheel=/^(1[0-2]|[1-9])\s*([AB])$/iu.exec(value);
  if(wheel){
    const minor=wheel[2].toUpperCase()==="A";
    return {root:wrap(camelotMajor[Number(wheel[1])-1]-(minor?3:0)),minor,confidence:.64};
  }
  const note=/^([A-G])([#b]?)(?:\s*(major|minor|maj|min|mayor|menor|m))?$/iu.exec(value);
  if(!note)return null;
  const root=({C:0,D:2,E:4,F:5,G:7,A:9,B:11})[note[1].toUpperCase()];
  return {root:wrap(root+(note[2]==="#"?1:note[2]==="b"?-1:0)),minor:/^(m|min|minor|menor)$/iu.test(note[3]||""),confidence:.64};
}

export function soundingKey(key,semitones){
  return key?pretty(wrap(key.root+Math.round(semitones)),key.minor):"";
}

function spectrum(size){
  const real=new Float64Array(size),imag=new Float64Array(size);
  const reverse=new Uint16Array(size),win=new Float64Array(size);
  const cos=new Float64Array(size/2),sin=new Float64Array(size/2);
  for(let i=0;i<size;i++){
    reverse[i]=(reverse[i>>1]>>1)|((i&1)*(size/2));
    win[i]=.5-.5*Math.cos(2*Math.PI*i/(size-1));
    if(i<size/2){cos[i]=Math.cos(2*Math.PI*i/size);sin[i]=-Math.sin(2*Math.PI*i/size);}
  }
  const magnitude=new Float64Array(size/2);
  return (samples,start)=>{
    imag.fill(0);
    for(let i=0;i<size;i++)real[reverse[i]]=(samples[start+i]||0)*win[i];
    for(let count=2;count<=size;count*=2){
      const half=count/2,step=size/count;
      for(let start=0;start<size;start+=count)for(let i=0;i<half;i++){
        const j=start+i,k=j+half,w=i*step;
        const a=real[k]*cos[w]-imag[k]*sin[w], b=real[k]*sin[w]+imag[k]*cos[w];
        real[k]=real[j]-a;imag[k]=imag[j]-b;
        real[j]+=a;imag[j]+=b;
      }
    }
    for(let i=0;i<magnitude.length;i++)magnitude[i]=Math.hypot(real[i],imag[i]);
    return magnitude;
  };
}

export function analyzeHarmony(left,right,rate){
  const size=8192, seconds=1.5, fft=spectrum(size);
  const limitBin=Math.min(size/2-2,Math.floor(3800*size/rate));
  const firstBin=Math.ceil(55*size/rate), total=new Float64Array(12), regions=[];
  for(let region=0;region*seconds*rate<left.length;region++){
    const notes=new Float64Array(128),hz=new Float64Array(128);
    const chroma=new Float64Array(12);
    let confidence=0;
    for(const fraction of [.18,.48,.78]){
      const first=Math.max(0,Math.round((region+fraction)*seconds*rate-size/2));
      if(first>=left.length)continue;
      let l=0,r=0;
      for(let i=first;i<Math.min(first+size,left.length);i+=16){l+=left[i]**2;r+=(right?.[i]||0)**2;}
      if(Math.max(l,r)<.001)continue;
      const bins=fft(r>l?right:left,first);
      let maximum=0,power=0;
      for(let i=firstBin;i<=limitBin;i++){maximum=Math.max(maximum,bins[i]);power+=bins[i]**2;}
      const candidates=[];
      for(let i=firstBin;i<=limitBin;i++){
        if(bins[i]<maximum*.055||bins[i]<=bins[i-1]||bins[i]<bins[i+1])continue;
        const a=Math.log(bins[i-1]+1e-9),b=Math.log(bins[i]+1e-9),c=Math.log(bins[i+1]+1e-9);
        const correction=.5*(a-c)/Math.min(-1e-6,a-2*b+c);
        const frequency=(i+Math.max(-.5,Math.min(.5,correction)))*rate/size;
        candidates.push({frequency,amplitude:bins[i]});
      }
      candidates.sort((a,b)=>b.amplitude-a.amplitude);
      const found=candidates.slice(0,18);
      const tonalPower=found.reduce((sum,peak)=>sum+peak.amplitude**2,0)/Math.max(1e-9,power);
      const strength=clamp((tonalPower-.09)/.33);
      confidence+=strength/3;
      for(const {frequency,amplitude} of found){
        const pitch=69+12*Math.log2(frequency/440), note=Math.round(pitch);
        const weight=strength*(amplitude/maximum)**.75/(1+(frequency/850)**1.2);
        const split=(pitch-note)*.38;
        chroma[wrap(note)]+=weight*(1-Math.abs(split));
        chroma[wrap(note+Math.sign(split))]+=weight*Math.abs(split);
        notes[note]+=weight;hz[note]+=weight*frequency;
      }
    }
    const profile=distribution(chroma);
    confidence*=clamp((1/Math.max(.08,squared(profile))-1.35)/1.75);
    if(!chroma.some(Boolean)||confidence<.14){regions.push(null);continue;}
    for(let note=0;note<12;note++)total[note]+=profile[note]*confidence;
    const partials=Array.from(notes.keys()).filter(i=>notes[i]>.025).sort((a,b)=>notes[b]-notes[a]).slice(0,9);
    const weights=distribution(partials.map(i=>notes[i]));
    regions.push({chroma:profile,confidence,partials:partials.map((i,j)=>[hz[i]/notes[i],weights[j]])});
  }
  const chroma=distribution(total);
  const key=keyFromChroma(chroma);
  return {seconds,regions,key,global:key?{chroma,confidence:key.confidence,partials:[]}:null};
}

export function harmonyAt(analysis,position,tag){
  const known=parseKey(tag);
  const local=analysis?.regions[Math.floor(position/analysis.seconds)];
  if(local)return {...local,key:known||analysis.key};
  if(analysis?.global)return {...analysis.global,key:known||analysis.key};
  if(!known)return null;
  const chroma=distribution(scales[Number(known.minor)]);
  return {chroma:chroma.map((_,i)=>chroma[wrap(i-known.root)]),confidence:known.confidence,partials:[],key:known};
}

function shiftedChroma(chroma,shift){
  const whole=Math.floor(shift),fraction=shift-whole;
  return Array.from(chroma,(_,i)=>(1-fraction)*chroma[wrap(i-whole)]+fraction*chroma[wrap(i-whole-1)]);
}

function centroid(chroma){
  return Array.from({length:6},(_,i)=>chroma.reduce((sum,value,note)=>sum+value*chromaBasis[note][i],0));
}

// Critical-band spacing weights the beating between cross-track partials.
function partialFit(first,second,shiftA,shiftB){
  if(!first.length||!second.length)return null;
  const a=2**(shiftA/12),b=2**(shiftB/12);
  let roughness=0;
  for(const [x,weightA] of first)for(const [y,weightB] of second){
    const low=Math.min(a*x,b*y),distance=Math.abs(a*x-b*y);
    const spacing=.24*distance/(.021*low+19);
    roughness+=weightA*weightB*(Math.exp(-3.5*spacing)-Math.exp(-5.75*spacing));
  }
  return Math.exp(-11*roughness);
}

export function matchHarmony(first,second,shiftA,shiftB,currentShift){
  if(!first||!second||Math.min(first.confidence,second.confidence)<.18)return null;
  const a=shiftedChroma(first.chroma,shiftA), center=centroid(a);
  const score=extra=>{
    const b=shiftedChroma(second.chroma,shiftB+extra), other=centroid(b);
    const common=a.reduce((sum,value,i)=>sum+Math.sqrt(value*b[i]),0);
    const tonal=Math.exp(-1.5*squared(center.map((value,i)=>value-other[i])));
    const partial=partialFit(first.partials,second.partials,shiftA,shiftB+extra);
    return partial===null?.65*common+.35*tonal:.54*common+.28*tonal+.18*partial;
  };
  const current=score(0);
  let best=current,recommend=0;
  for(let step=-6;step<=6;step++){
    if(Math.abs(currentShift+step)>12)continue;
    const merit=score(step)-.022*Math.abs(step);
    if(merit>best+.00001){best=merit;recommend=step;}
  }
  return {score:Math.round(100*clamp(current)),recommend:best-current>.045?recommend:0,
    confidence:Math.min(first.confidence,second.confidence)};
}
