import assert from "node:assert/strict";
import { test } from "node:test";
import { beatAt, buildGrid, mixerSettings, timeAt } from "../public/js/ddj/data.js";
import { analyzeHarmony, harmonyAt, matchHarmony, parseKey, soundingKey } from "../public/js/ddj/harmony.js";
import { beatError, gridReading, PhaseLock, startOnBeat, SyncClock, syncRateLimits, tempoScale } from "../public/js/ddj/sync-controller.js";
import { spatialPlan } from "../public/js/ddj/spatial.js";

const marker=(time,bpm)=>({time,bpm,meter:4,beat:1});

test("a fixed clock keeps the same timeline for ten minutes and freezes while paused",()=>{
  const clock=new SyncClock();clock.reset();clock.set(0,132.25,true,.25);
  for(let frame=1;frame<=24000;frame++)clock.set(frame/40,132.25,true);
  assert.ok(Math.abs(clock.read(600)-(.25+600*132.25/60))<1e-9);
  const end=clock.read(600);
  clock.set(600,132.25,false);
  assert.equal(clock.read(603),end);
  clock.set(603,132.25,true);
  assert.ok(Math.abs(clock.read(609)-end-6*132.25/60)<1e-9);
});

test("the locked phase controller ignores small clock jitter",()=>{
  const follow=new PhaseLock(), required=1.21;
  const [low,high]=syncRateLimits;
  for(let frame=0;frame<1800;frame++){
    const state=follow.update({time:frame/40,delta:Math.sin(frame*1.7)*.003,required,low,high,running:true});
    assert.equal(state.rate,required);
    if(frame>25)assert.equal(state.state,"locked");
  }
});

test("spatial settings preserve legacy paneo and carve gently in auto mode",()=>{
  const mixes=mixerSettings({A:{pan:-.2},B:{spaceMode:"auto"},C:{spaceMode:"manual",spaceWidth:0,spaceWet:28,spaceTone:3800,spaceFocus:80}});
  const entry=(id,level)=>({id,mix:mixes[id],level,bass:.76,body:.18});
  const {owner,states}=spatialPlan([entry("A",.58),entry("B",.6),entry("C",0),entry("D",0)],"A");
  assert.equal(owner,"A");
  assert.equal(states.A.pan,-.2);
  assert.equal(states.A.width,1);
  assert.equal(states.A.wet,0);
  assert.ok(states.B.low< -2&&states.B.low>=-4.2);
  assert.ok(states.B.pan>0&&states.B.width>1&&states.B.wet<.1);
  assert.equal(states.C.width,0);
  assert.equal(states.C.wet,.28);
  const solo=spatialPlan([entry("A",0),entry("B",.6)],"A").states.B;
  assert.ok(Math.abs(solo.low)<.001&&solo.width===1&&solo.pan===0);
});

test("a 119 BPM follower tracks a 143 BPM leader and its next tempo segment",()=>{
  const a=buildGrid([marker(.14,143),marker(.14+480/143,134)]);
  const b=buildGrid([marker(.32,119)]);
  const at=a[1].time+.7;
  const lock=new PhaseLock();
  const [low,high]=syncRateLimits;
  const scale=tempoScale(143,119);
  assert.equal(scale,1);
  assert.ok(143/119>1.06);
  const target=gridReading(a,.8);
  const required=target.bpm/gridReading(b,1.67,scale).bpm;
  assert.equal(lock.update({time:1,delta:0,required,low,high,running:true}).rate,143/119);
  const next=gridReading(a,at);
  assert.equal(next.bpm,134);
  const position=startOnBeat(b,3.7,20,next.beat,scale);
  assert.ok(Math.abs(beatError(next.beat,gridReading(b,position,scale).beat))<1e-9);
  assert.equal(lock.update({time:4,delta:0,required:next.bpm/119,low,high,running:true}).rate,134/119);
});

test("a variable beatgrid remains invertible at tempo markers and supports half-time",()=>{
  const grid=buildGrid([marker(.2,136),marker(3.74,129),marker(7.48,121)]);
  for(const t of [0,1.9,3.739,3.74,3.741,7.48,9.8])assert.ok(Math.abs(timeAt(grid,beatAt(grid,t))-t)<1e-9);
  assert.equal(beatAt(grid,3.74),8);
  assert.equal(tempoScale(140,70),.5);
  assert.equal(startOnBeat(buildGrid([marker(0,70)]),.5,15,1,.5),60/140);
});

test("local chord evidence improves after transposition and silence abstains",()=>{
  const rate=22050;
  function profile(transpose){
    const notes=[48,52,55].map((note,i)=>[(.25-.04*i),2*Math.PI*440*2**((note+transpose-69)/12)/rate]);
    const signal=Float32Array.from({length:rate*3},(_,i)=>notes.reduce((sample,[gain,w])=>sample+gain*Math.sin(w*i),0));
    return analyzeHarmony(signal,null,rate);
  }
  const a=harmonyAt(profile(0),.6,""),b=harmonyAt(profile(1),.6,"");
  assert.equal(soundingKey(a.key,0),"C · 8B");
  assert.equal(soundingKey(b.key,-1),"C · 8B");
  assert.equal(soundingKey(parseKey("8A"),2),"Bm · 10A");
  const initial=matchHarmony(a,b,0,0,0), adjusted=matchHarmony(a,b,0,-1,-1);
  assert.equal(initial.recommend,-1);
  assert.ok(adjusted.score>initial.score+50);
  assert.equal(adjusted.recommend,0);
  assert.equal(harmonyAt(analyzeHarmony(new Float32Array(rate),null,rate),.4,""),null);
});
