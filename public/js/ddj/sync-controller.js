import { beatAt, markerAt, mod } from "./data.js";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const beatError=(target,actual)=>mod(target-actual+.5,1)-.5;
export const syncRateLimits=[.25,2];

// A marker defines a real beat even when a preceding tempo segment ends mid-beat.
export function gridReading(grid,position,scale=1) {
  const marker=markerAt(grid,position);
  return {beat:beatAt(grid,position)/scale,bpm:marker.segmentBpm/scale};
}

export function tempoScale(target,native) {
  return [1,.5,2].reduce((best,scale)=>
    Math.abs(Math.log(target*scale/native))<Math.abs(Math.log(target*best/native))?scale:best,1);
}

export function startOnBeat(grid,position,duration,beat,scale,loop=null) {
  const end=Math.max(0,(loop?.out??duration)-.015);
  // A boundary can offer a second, nearer valid pulse in a different tempo segment.
  let closest=position,distance=Infinity;
  for(const [index,marker] of grid.entries()){
    const period=scale*60/marker.segmentBpm;
    const base=marker.time+mod(beat-marker.offset/scale,1)*period;
    const min=Math.max(loop?.in??0,index===0?0:marker.time);
    const max=Math.min(end,(grid[index+1]?.time??Infinity)-1e-6);
    const first=Math.ceil((min-base-1e-8)/period),last=Math.floor((max-base+1e-8)/period);
    if(first>last)continue;
    const step=clamp(Math.round((position-base)/period),first,last);
    const candidate=base+step*period;
    if(Math.abs(candidate-position)<distance){closest=candidate;distance=Math.abs(candidate-position);}
  }
  return Number.isFinite(distance)?closest:position;
}

export class SyncClock {
  reset(){this.at=undefined;this.beat=0;this.bpm=0;this.running=false;}

  read(time){return this.beat+(this.running?Math.max(0,time-this.at)*this.bpm/60:0);}

  set(time,bpm,running,beat){
    if(beat===undefined&&this.bpm===bpm&&this.running===running)return;
    this.beat=beat??this.read(time);this.at=time;this.bpm=bpm;this.running=running;
  }
}

export class PhaseLock {
  reset(time) {
    this.last=time;
    this.error=0;
    this.integral=0;
    this.settled=0;
    this.unstable=0;
    this.locked=false;
  }

  update({time,delta,required,low,high,running}) {
    if (this.last===undefined || !running || time-this.last>.28) this.reset(time);
    const elapsed=clamp(time-this.last,0,.1);
    this.last=time;
    if(required<low-1e-7 || required>high+1e-7){
      this.reset(time);
      return {state:"range",rate:clamp(required,low,high)};
    }
    if(!running)return {state:"ready",rate:clamp(required,low,high)};

    // Filter clock readout noise. Correct with continuous rate control instead of jumps.
    const weight=1-Math.exp(-elapsed/.045);
    this.error=beatError(this.error+weight*beatError(delta,this.error),0);
    if(Math.abs(delta)<=.038 && Math.abs(this.error)<=.030){
      this.settled+=elapsed;
      if(this.settled>=.38)this.locked=true;
    } else this.settled=0;
    if(Math.abs(delta)>.090){
      this.unstable+=elapsed;
      if(this.unstable>=.14){this.locked=false;this.integral=0;}
    }else this.unstable=0;
    // Correct acquisition quickly, then keep steady-state nudges small.
    const drive=Math.sign(this.error)*Math.max(0,Math.abs(this.error)-.004);
    const window=this.locked?.004:.035;
    const minimum=Math.max(-window,low/required-1),maximum=Math.min(window,high/required-1);
    const proportional=(this.locked?.17:.42)*drive;
    if(drive===0)this.integral*=Math.exp(-elapsed/1.4);
    else if((proportional+this.integral<maximum||drive<0)&&(proportional+this.integral>minimum||drive>0)){
      this.integral=clamp(this.integral+drive*.008*elapsed,-.0018,.0018);
    }
    const correction=required*clamp(proportional+this.integral,minimum,maximum);
    return {state:this.locked?"locked":"aligning",rate:clamp(required+correction,low,high)};
  }
}
