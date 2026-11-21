import { beatAt, markerAt, MIX_EQ, sweepFrequency, timeAt } from "./data.js";
import { SPACE_EQ } from "./spatial.js";

const channelColors={A:["#ac8bff","#ef88c3","#f9daf6"],B:["#48b7b1","#83e0bf","#defee9"],
  C:["#e79554","#f4bc64","#ffe2b8"],D:["#689bf1","#9ebeff","#e1edff"]};
const rgb=["#fb8296","#82e0aa","#7bbaff"];
const warningColors=["#c82f54","#f44962","#ff9f9a"];
const frequencies=[55,105,165,285,580,1000,1650,3000,5300,8800];
const db=value=>10**(value/20);
let preview;

function response(mix,shift,spaceLow,spaceMid){
  if(!preview){
    const context=new OfflineAudioContext(1,1,48000);
    preview={filter:context.createBiquadFilter(),magnitudes:new Float32Array(frequencies.length),
      phases:new Float32Array(frequencies.length), hz:new Float32Array(frequencies.length)};
  }
  const {filter,magnitudes,phases,hz}=preview;
  frequencies.forEach((freq,i)=>hz[i]=Math.min(23990,freq*2**(shift/12)));
  const weights=Float32Array.from(frequencies,()=>1);
  function apply(type,freq,gain,q=.8){
    filter.type=type;filter.frequency.value=freq;filter.gain.value=gain;filter.Q.value=q;
    filter.getFrequencyResponse(hz,magnitudes,phases);
    for(let i=0;i<weights.length;i++)weights[i]*=magnitudes[i];
  }
  for(const [name,type,frequency] of MIX_EQ)if(mix[name])apply(type,frequency,mix[name],.8);
  if(Math.abs(mix.filter)>=.015)apply(mix.filter<0?"lowpass":"highpass",sweepFrequency(mix.filter),0,-3.0103);
  if(spaceLow)apply("lowshelf",SPACE_EQ.shelf,spaceLow);
  if(spaceMid)apply("peaking",SPACE_EQ.body,spaceMid,SPACE_EQ.q);
  return [[0,3],[3,7],[7,10]].map(([min,max])=>Math.sqrt(weights.slice(min,max)
    .reduce((sum,value)=>sum+value**2,0)/(max-min)));
}

function waveMix(canvas,deck,mixer){
  const mix=mixer.config[deck.id],{weight,normalization}=mixer.channelLevel(deck);
  const shift=Math.round(deck.soundingShift()*8)/8;
  const space=mixer.spaceApplied[deck.id];
  const spaceLow=Math.round((space?.low||0)*5)/5,spaceMid=Math.round((space?.mid||0)*5)/5;
  const signature=[mix.low,mix.mid,mix.high,mix.filter,shift,spaceLow,spaceMid].join(":");
  if(canvas.waveEQ?.key!==signature)canvas.waveEQ={key:signature,gain:response(mix,shift,spaceLow,spaceMid)};
  const after=mix.mute?0:mix.level*weight;
  const signal=db(mix.trim+normalization);
  return {bandGain:canvas.waveEQ.gain,after,signal,signature:[signature,after,signal,deck.clipActive,deck.opts.wave].join(":")};
}

function sizeCanvas(canvas){
  const ratio=Math.min(2,devicePixelRatio||1);
  const width=Math.max(1,Math.round(canvas.clientWidth*ratio)),height=Math.max(1,Math.round(canvas.clientHeight*ratio));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;canvas.waveFrame="";}
  return ratio;
}

function guides(ctx,deck,first,last,pixel,ratio,labels){
  const {width,height}=ctx.canvas;
  if(!deck.readyGrid)return;
  const grid=deck.grid(), initial=Math.max(0,grid.indexOf(markerAt(grid,first)));
  for(let i=initial;i<grid.length;i++){
    const mark=grid[i];
    if(mark.time>last)break;
    const period=60/mark.segmentBpm;
    const start=Math.max(0,Math.ceil((first-mark.time)/period-1e-7));
    const end=Math.min(last,(grid[i+1]?.time??Infinity)-1e-6,deck.duration);
    for(let step=start,time=mark.time+start*period;time<=end;step++,time=mark.time+step*period){
      const isBar=(step+mark.beat-1)%mark.meter===0;
      if(!isBar&&!labels&&deck.duration>100)continue;
      const x=Math.round(pixel(time));
      if(x<0||x>=width)continue;
      ctx.fillStyle=isBar?"#bdb2d9a0":"#a59cbb51";
      ctx.fillRect(x,0,isBar?Math.max(2,ratio*1.35):ratio,height);
      if(isBar&&labels){ctx.fillStyle="#dacdf1c0";ctx.fillRect(x,0,5*ratio,3*ratio);}
    }
  }
}

function bars(ctx,deck,start,end,renderTime,mix,ratio){
  const {width,height}=ctx.canvas, center=height/2;
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle="#8e83a345";ctx.fillRect(0,center,width,ratio);
  const analysis=deck.analysis;
  if(!analysis||mix.after<.001)return;
  const {detail,detailRate,envelope,clipped}=analysis;
  const colors=deck.opts.wave==="rgb"?rgb:channelColors[deck.id];
  const caution=["#db8b52","#ffc47b","#fff0bb"];
  const step=Math.max(1,Math.round(ratio));
  const useSummary=(end-start)*detailRate/width>8;
  const count=useSummary?analysis.bands[0].length:detail[0].length;
  const bins=useSummary?analysis.bands:detail;
  const density=useSummary?count/deck.duration:detailRate;
  const order=[0,1,2], heights=[0,0,0], peaks=[0,0,0];
  for(let x=0;x<width;x+=step){
    const from=renderTime(x),to=renderTime(x+step);
    if(to<=0||from>=deck.duration)continue;
    const lo=Math.max(0,Math.floor(from*density)), hi=Math.min(count-1,Math.floor(to*density));
    let sourcePeak=0,sourceClip=false;
    peaks.fill(0);
    for(let i=lo;i<=hi;i++){
      for(let b=0;b<3;b++)peaks[b]=Math.max(peaks[b],bins[b][i]);
      if(useSummary)continue;
      sourcePeak=Math.max(sourcePeak,envelope[i]);
      sourceClip||=clipped[i]===1;
    }
    const unweighted=Math.hypot(...peaks);
    if(unweighted<1e-7)continue;
    for(let b=0;b<3;b++)heights[b]=peaks[b]*mix.bandGain[b];
    const filtered=Math.hypot(...heights);
    const predicted=(sourcePeak||unweighted)*filtered/unweighted*mix.signal;
    const output=predicted*mix.after;
    const palette=deck.clipActive||sourceClip?warningColors:output>.71?caution:colors;
    const amplitude=Math.min(1,output**.67)*Math.max(0,center-2*ratio);
    ctx.globalAlpha=palette===warningColors?1:Math.min(1,.54+output*.7);
    if(deck.opts.wave==="blue"){
      ctx.fillStyle=palette===colors?"#7ab6f7":palette[1];
      ctx.fillRect(x,center-amplitude,step,2*amplitude);
      continue;
    }
    order.sort((a,b)=>heights[b]-heights[a]);
    for(const b of order){
      const size=amplitude*(heights[b]/Math.max(1e-8,heights[order[0]]))**.67;
      ctx.fillStyle=palette[b];ctx.fillRect(x,center-size,step,2*size);
    }
  }
  ctx.globalAlpha=1;
}

export function drawLiveWave(canvas,deck,mixer,zoomBpm){
  if(!canvas.clientWidth||!canvas.clientHeight)return;
  const ratio=sizeCanvas(canvas), mix=waveMix(canvas,deck,mixer), ctx=canvas.getContext("2d");
  const position=deck.position(), grid=deck.grid();
  const warp=deck.readyGrid&&(deck.sync||mixer.syncSource===deck.id)&&mixer.syncClock.bpm&&deck.syncState!=="range";
  const center=beatAt(grid,position), range=12*(deck.syncScale||1);
  const seconds=720/zoomBpm*deck.rate;
  const time=x=>warp?timeAt(grid,center+(x/canvas.width-.5)*range):position+(x/canvas.width-.5)*seconds;
  const pixel=t=>(.5+(warp?(beatAt(grid,t)-center)/range:(t-position)/seconds))*canvas.width;
  const key=[position.toFixed(4),deck.rate.toFixed(4),zoomBpm.toFixed(2),warp,range,mix.signature].join(":");
  if(canvas.waveAnalysis===deck.analysis&&canvas.waveGrid===grid&&canvas.waveFrame===key)return;
  canvas.waveAnalysis=deck.analysis; canvas.waveGrid=grid; canvas.waveFrame=key;
  const first=time(0),last=time(canvas.width);
  bars(ctx,deck,first,last,time,mix,ratio);
  guides(ctx,deck,first,last,pixel,ratio,true);
  if(deck.track&&first<=deck.cue&&deck.cue<=last){
    const x=Math.round(pixel(deck.cue));
    ctx.fillStyle="#f3bc79";ctx.fillRect(x,0,ratio,canvas.height);
    ctx.font=`bold ${10*ratio}px system-ui`;ctx.fillText("CUE",x+3*ratio,canvas.height-6*ratio);
  }
}

export function drawOverviewWave(canvas,overview,deck,mixer){
  const mix=waveMix(canvas,deck,mixer), grid=deck.grid();
  const key=[deck.duration,deck.loop.on,deck.loop.in,deck.loop.out,mix.signature].join(":");
  if(canvas.waveAnalysis===deck.analysis&&canvas.waveGrid===grid&&canvas.waveFrame===key)return;
  canvas.waveAnalysis=deck.analysis; canvas.waveGrid=grid; canvas.waveFrame=key;
  const ctx=canvas.getContext("2d"), width=canvas.width, duration=deck.duration;
  bars(ctx,deck,0,duration,x=>x/width*duration,mix,1);
  if(duration){
    guides(ctx,deck,0,duration,time=>time/duration*width,1,false);
    if(deck.loop.on){ctx.fillStyle="#8cdbbf4f";ctx.fillRect(deck.loop.in/duration*width,0,
      (deck.loop.out-deck.loop.in)/duration*width,canvas.height);}
  }
  const small=overview.getContext("2d");
  small.clearRect(0,0,overview.width,overview.height);
  small.drawImage(canvas,0,0,overview.width,overview.height);
}
