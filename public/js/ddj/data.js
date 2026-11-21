import { limit, permitted } from "../common.js";

export const DECKS=["A","B","C","D"];
export const CUE_COLORS=["#b4a2ff","#87dfbc","#ffbe88","#88c9ff","#ff9aa9","#f5df84","#b6aef9","#a1eca0"];
export const MAX_ANALYSIS_BYTES=64*1024*1024;
export const MAX_ANALYSIS_SECONDS=720;
export const LOOP_BEATS=[.25,.5,1,2,4,8,16,32];
export const MIX_EQ=[["low","lowshelf",180], ["mid","peaking",900], ["high","highshelf",3600]];
export const sweepFrequency=value=>value<0?17500*45**value:28*95**value;
export const STARTUP={
  loadLock:true, playMode:"single", autoCue:true, cueLevel:"memory", cueFloor:-60, quantize:true, quantizeBeat:1,
  jump:16, hotLoad:true, hotColor:true, ejectLock:true, wave:"3band", division:"phrase", phase:"blocks",
  time:"remain", brightness:4, ring:true, jog:"vinyl", touch:0, release:.08, jogAdjust:5,
  tempoRange:6, masterTempo:true, slip:false, sourceColor:"#b4a2ff", language:"es"
};
export const PRESETS={
  Cabina:STARTUP,
  Electrónica:{...STARTUP,brightness:3,jump:32,tempoRange:6,cueFloor:-78},
  "Mezcla abierta":{...STARTUP,tempoRange:10,quantizeBeat:.5,phase:"bars"},
  Turntablism:{...STARTUP,tempoRange:16,quantizeBeat:.25,slip:true,release:.02,jogAdjust:3},
  Práctica:{...STARTUP,playMode:"continue",wave:"blue",division:"time",time:"elapsed",tempoRange:10}
};
export const OPTIONS={
  playMode:["single","continue"],cueLevel:["memory","signal"],wave:["3band","rgb","blue"],
  division:["phrase","time"],phase:["blocks","bars"],time:["remain","elapsed"],jog:["vinyl","cdj"],language:["es","en"]
};
const PICKS={cueFloor:[-60,-78],quantizeBeat:[.25,.5,1],jump:[1,2,4,8,16,32,64],tempoRange:[6,10,16,100]};
const NUMBERS={brightness:[1,5],touch:[0,1.5],release:[0,1.5],jogAdjust:[1,10]};
const RGB=/^#[a-f\d]{6}$/iu;
const cueTime=value=>typeof value==="number" && Number.isFinite(value) && value>=0 && value<=86400 ? value : null;
export const mod=(n,d)=>((n%d)+d)%d;

export function settings(raw={}) {
  raw=raw && typeof raw==="object" ? raw : {};
  return Object.fromEntries(Object.entries(STARTUP).map(([key,fallback])=>{
    const value=raw[key];
    if (typeof fallback==="boolean") return [key,typeof value==="boolean" ? value : fallback];
    if (Object.hasOwn(OPTIONS,key) || Object.hasOwn(PICKS,key)) return [key,permitted(value,OPTIONS[key]||PICKS[key],fallback)];
    if (Object.hasOwn(NUMBERS,key)) return [key,limit(value,...NUMBERS[key],fallback)];
    return [key,RGB.test(value) ? value : fallback];
  }));
}

export function mixerSettings(raw={}) {
  const channel=value=>({
    trim:limit(value?.trim,-18,12,0), level:limit(value?.level,0,1,.88), low:limit(value?.low,-24,9,0),
    mid:limit(value?.mid,-24,9,0),high:limit(value?.high,-24,9,0), filter:limit(value?.filter,-1,1,0),
    fx:permitted(value?.fx,["off","echo","reverb"],"off"), wet:limit(value?.wet,0,.65,.25),
    mute:value?.mute===true, pan:limit(value?.pan,-1,1,0),
    spaceMode:permitted(value?.spaceMode,["off","manual","auto"],"off"),
    spaceWidth:limit(value?.spaceWidth,0,150,100),spaceWet:limit(value?.spaceWet,0,40,12),
    spaceTone:limit(value?.spaceTone,900,10500,5700),spaceFocus:limit(value?.spaceFocus,0,100,0)
  });
  return { ...Object.fromEntries(DECKS.map(id=>[id,channel(raw?.[id])])), normalize:raw?.normalize!==false, cross:limit(raw?.cross,-1,1,0), master:limit(raw?.master,0,1,.85),
    curve:permitted(raw?.curve,["power","linear","cut"],"power") };
}

export function trackData(raw={}) {
  const data=raw && typeof raw==="object" ? raw : {};
  const markers=Array.isArray(data.grid) ? data.grid.slice(0,220) : [];
  const grid=markers.map(mark=>({time:cueTime(mark?.time),bpm:limit(mark?.bpm,35,260,0),
    meter:Math.round(limit(mark?.meter,1,12,4)), beat:Math.round(limit(mark?.beat,1,12,1))}))
    .filter(mark=>mark.time!==null && mark.bpm>0).sort((a,b)=>a.time-b.time).filter((mark,i,items)=>!i || mark.time-items[i-1].time>.0001);
  const phrases=(Array.isArray(data.phrases)?data.phrases.slice(0,32):[]).map(part=>({
    time:cueTime(part?.time), name:typeof part?.name==="string" ? part.name.trim().slice(0,32) : ""
  })).filter(part=>part.name && part.time!==null).sort((a,b)=>a.time-b.time);
  return { grid, memory:cueTime(data.memory), cues:Array.from({length:8},(_,i)=>{
    const c=data.cues?.[i];
    const time=cueTime(c?.time);
    return time===null ? null : {time,color:RGB.test(c.color) ? c.color : CUE_COLORS[i],
      name:typeof c.name==="string"?c.name.trim().slice(0,35):"", end:cueTime(c.end)>time?cueTime(c.end):null};
  }), phrases, key:typeof data.key==="string"?data.key.slice(0,18):"",
    firstSignal:cueTime(data.firstSignal), firstBeat:cueTime(data.firstBeat),
    loudness:Number.isFinite(data.loudness)?limit(data.loudness,-80,12,-18):null,
    peak:Number.isFinite(data.peak)?limit(data.peak,-100,12,0):null
  };
}

export function configData(raw={}) {
  const value=raw && typeof raw==="object" ? raw : {};
  const defaults=settings(value.defaults);
  return {defaults, decks:Object.fromEntries(DECKS.map(id=>[id,settings(value.decks?.[id]||defaults)])),
    mix:mixerSettings(value.mix),
    tags:(Array.isArray(value.tags)?value.tags:[]).filter(item=>typeof item==="string" && item.length<=120).slice(0,120),
    profiles:(Array.isArray(value.profiles)?value.profiles:[]).filter(item=>typeof item?.name==="string"&&item.name.trim()).slice(0,12)
      .map(item=>({name:item.name.trim().slice(0,36),settings:settings(item.settings),mix:mixerSettings(item.mix)}))
  };
}

// A tempo marker starts on a pulse. Reconcile the interval between anchors so
// transport, snapping and the display share one continuous beat coordinate.
export function buildGrid(markers, bpm=128, anchor=0) {
  const source=markers.length ? markers : [{time:anchor,bpm,meter:4,beat:1}];
  let previous=null;
  return source.map(mark=>{
    let offset=0;
    if(previous){
      const elapsed=mark.time-previous.time;
      const estimated=elapsed*previous.bpm/60;
      const pulses=Math.max(1,Math.round(estimated));
      const close=Math.abs(estimated-pulses)<=.35;
      offset=previous.offset+(close?pulses:estimated);
      previous.segmentBpm=close?pulses*60/elapsed:previous.bpm;
    }
    const point={...mark,offset,segmentBpm:mark.bpm};
    previous=point;
    return point;
  });
}
export function markerAt(grid,time) {
  return grid.findLast(item=>time>=item.time) || grid[0];
}
export function beatAt(grid,time) {
  const mark=markerAt(grid,time);
  return mark.offset+(time-mark.time)*mark.segmentBpm/60;
}
export function timeAt(grid,beat) {
  const mark=grid.findLast(item=>beat>=item.offset) || grid[0];
  return mark.time+(beat-mark.offset)*60/mark.segmentBpm;
}
export function quantized(grid,time,beatValue,duration) {
  const mark=markerAt(grid,time);
  const beats=(time-mark.time)*mark.segmentBpm/60;
  const local=mark.offset+Math.round(beats/beatValue)*beatValue;
  const candidate=timeAt(grid,local);
  const next=grid[grid.indexOf(mark)+1];
  const nearest=next&&Math.abs(next.time-time)<Math.abs(candidate-time)?next.time:candidate;
  return Math.max(0,Math.min(duration,nearest));
}
export function barPhase(grid,time) {
  const m=markerAt(grid,time);
  const b=(time-m.time)*m.segmentBpm/60+m.beat-1;
  return {beat:Math.floor(mod(b,m.meter)),fraction:mod(b,1),meter:m.meter};
}
function xmlNumber(element,name) {
  const raw=element.getAttribute(name);
  return raw===null || !raw.trim() ? NaN : Number(raw.replace(",","."));
}

function fileLabel(name) {
  return String(name||"").normalize("NFC").trim().toLocaleLowerCase();
}

export function readRekordbox(xml,tracks) {
  if (/<\!DOCTYPE/i.test(xml)) throw new Error("Usa un XML de colección sin DTD.");
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName!=="DJ_PLAYLISTS") {
    throw new Error("Selecciona un XML de colección exportado por rekordbox.");
  }
  const byName=new Map();
  for (const track of tracks) {
    const key=fileLabel(track.name);
    if (!byName.has(key)) byName.set(key,[]);
    byName.get(key).push(track);
  }
  let ignored=0;
  const items=[];
  const seen=new Set();
  for (const entry of doc.querySelectorAll("COLLECTION > TRACK")) {
    const raw=entry.getAttribute("Location")||"";
    let basename="";
    try { basename=decodeURIComponent((new URL(raw)).pathname.split("/").at(-1)); }
    catch { basename=raw.split(/[\\/]/u).at(-1); }
    let possible=byName.get(fileLabel(basename))||[];
    const size=xmlNumber(entry,"Size");
    if (possible.length>1 && size>0) possible=possible.filter(item=>item.size===size);
    if (possible.length!==1 || seen.has(possible[0].id)) { ignored++; continue; }
    const track=possible[0];
    seen.add(track.id);
    const marks=[...entry.querySelectorAll("POSITION_MARK")];
    const imported={grid:[...entry.querySelectorAll("TEMPO")].map(mark=>({
      time:xmlNumber(mark,"Inizio"),bpm:xmlNumber(mark,"Bpm"),meter:Number(mark.getAttribute("Metro")?.split("/")[0]),beat:xmlNumber(mark,"Battito")
    })),key:entry.getAttribute("Tonality")||"",cues:Array(8).fill(null),phrases:[]};
    if (!imported.grid.length && xmlNumber(entry,"AverageBpm")>0) imported.grid.push({time:0,bpm:xmlNumber(entry,"AverageBpm"),meter:4,beat:1});
    const memory=marks.filter(m=>xmlNumber(m,"Num")===-1 && xmlNumber(m,"Type")===0)
      .map(m=>xmlNumber(m,"Start")).filter(t=>cueTime(t)!==null).sort((a,b)=>a-b);
    const load=marks.find(m=>xmlNumber(m,"Type")===3 && cueTime(xmlNumber(m,"Start"))!==null);
    imported.memory=memory[0] ?? (load ? xmlNumber(load,"Start") : null);
    for (const mark of marks) {
      const index=xmlNumber(mark,"Num");
      const name=mark.getAttribute("Name")||"";
      const time=xmlNumber(mark,"Start");
      const channels=["Red","Green","Blue"].map(key=>xmlNumber(mark,key));
      const color=channels.every(value=>Number.isInteger(value)&&value>=0&&value<=255) ?
        "#"+channels.map(value=>value.toString(16).padStart(2,"0")).join("") : CUE_COLORS[index];
      if (/\b(intro|verso|verse|coro|chorus|estribillo|puente|bridge|outro|break|drop)\b/iu.test(name)) imported.phrases.push({time,name});
      if (Number.isInteger(index) && index>=0 && index<8) imported.cues[index]={
        time,color,name,end:xmlNumber(mark,"Type")===4 ? xmlNumber(mark,"End") : null
      };
    }
    items.push({track,data:trackData(imported)});
  }
  return {items,ignored};
}
