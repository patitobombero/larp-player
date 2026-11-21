const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
export const SPACE_EQ={shelf:165,body:370,q:.82};

export function spatialPlan(entries,previousOwner){
  const active=entries.filter(entry=>entry.level>.015);
  const priority=entry=>entry.level*(.55+entry.bass);
  const strongest=active.reduce((best,entry)=>!best||priority(entry)>priority(best)?entry:best,null);
  const owner=active.find(entry=>entry.id===previousOwner&&priority(entry)>=.83*priority(strongest))||strongest;
  const states=Object.fromEntries(entries.map((entry,index)=>{
    const {mix,level,bass,body}=entry;
    if(mix.spaceMode!=="auto"){
      const enabled=mix.spaceMode==="manual";
      return [entry.id,{pan:mix.pan,width:enabled?mix.spaceWidth/100:1,wet:enabled?mix.spaceWet/100:0,
        tone:mix.spaceTone,focus:enabled?mix.spaceFocus/100:0,low:0,mid:0}];
    }
    const others=active.filter(other=>other!==entry);
    const otherLevel=Math.max(0,...others.map(other=>other.level));
    const blend=clamp((Math.min(level,otherLevel)/Math.max(.02,level,otherLevel)-.12)/.76);
    const bassCollision=owner&&owner!==entry?Math.sqrt(bass*owner.bass)*blend:0;
    const bodyCollision=owner&&owner!==entry?Math.sqrt(body*owner.body)*blend:0;
    const side=index%2===0?-1:1;
    return [entry.id,{pan:side*.13*blend,width:1+.16*blend,wet:level>.015?.044+.055*blend:0,
      tone:6200-2200*blend-800*bassCollision,focus:.72+.20*blend,low:-4.2*bassCollision,mid:-2*bodyCollision}];
  }));
  return {owner:owner?.id??"",states};
}

export function roomImpulse(context){
  const {sampleRate:rate}=context;
  const impulse=context.createBuffer(2,Math.ceil(rate*.125),rate);
  const paths=[[[8,.26],[13,-.12],[21,.15],[32,.09],[46,-.06],[58,.06]],
    [[10,.25],[16,.13],[25,-.14],[35,.09],[51,.06],[63,-.055]]];
  for(const [side,reflections] of paths.entries()){
    const samples=impulse.getChannelData(side);
    for(const [ms,gain] of reflections){
      const onset=Math.round(ms*rate*.001);
      samples[onset]=gain*.75;
      samples[onset+1]=gain*.25;
    }
    let seed=side+77;
    for(let at=Math.round(.072*rate);at<samples.length;at++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      samples[at]=(2*seed/4294967296-1)*.6/rate/.053*((samples.length-at)/(rate*.053))**3;
    }
  }
  return impulse;
}

function connectGain(context,source,value){
  const gain=context.createGain();gain.gain.value=value;
  source.connect(gain);
  return gain;
}

function stereoFilter(context,input,type,frequency,q){
  const filter=context.createBiquadFilter();
  filter.type=type;filter.frequency.value=frequency;
  if(q!==undefined)filter.Q.value=q;
  input.connect(filter);
  return filter;
}

export class StereoSpace {
  constructor(context,response){
    this.context=context;
    this.input=context.createGain();this.input.channelCount=2;this.input.channelCountMode="explicit";
    this.output=context.createGain();
    this.low=stereoFilter(context,this.input,"lowshelf",SPACE_EQ.shelf);
    this.mid=stereoFilter(context,this.low,"peaking",SPACE_EQ.body,SPACE_EQ.q);
    const room=context.createGain();
    this.dry=connectGain(context,this.mid,1);this.dry.connect(room);
    const bassCut=stereoFilter(context,this.mid,"highpass",215,-3.0103);
    this.tone=stereoFilter(context,bassCut,"lowpass",5700,-3.0103);
    this.wet=connectGain(context,this.tone,0);
    const convolver=context.createConvolver();convolver.normalize=false;convolver.buffer=response;
    this.wet.connect(convolver).connect(room);
    const split=context.createChannelSplitter(2);
    room.connect(split);
    const mid=context.createGain(), side=context.createGain();
    for(let channel=0;channel<2;channel++){
      const m=context.createGain(), s=context.createGain();
      m.gain.value=.5;s.gain.value=channel?-.5:.5;
      split.connect(m,channel).connect(mid);
      split.connect(s,channel).connect(side);
    }
    this.sideShelf=stereoFilter(context,side,"lowshelf",160);
    this.width=connectGain(context,this.sideShelf,1);
    const stereo=context.createChannelMerger(2);
    mid.connect(stereo,0,0);mid.connect(stereo,0,1);
    this.width.connect(stereo,0,0);connectGain(context,this.width,-1).connect(stereo,0,1);
    stereo.connect(this.output);
  }
  apply({width,wet,tone,focus,low,mid},smooth=.06){
    const now=this.context.currentTime;
    const targets=[[this.low.gain,low],[this.mid.gain,mid],[this.width.gain,width],[this.sideShelf.gain,-30*focus],
      [this.wet.gain,wet],[this.dry.gain,1-.22*wet],[this.tone.frequency,tone]];
    for(const [parameter,target] of targets)parameter.setTargetAtTime(target,now,smooth);
  }
}
