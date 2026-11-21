import { WInstruments } from "./instruments.js";

const packs=new Map(),byContext=new WeakMap();
const bankFor=track=>track.kind==="guitar"?(WInstruments.get(track).model===2?"nylon":null):
 ["electric","piano"].includes(track.kind)?track.kind:null;

async function fetchTakes(bank){
 const path="/assets/instruments/"+bank+"-takes";
 const [index,audio]=await Promise.all([fetch(path+".json"),fetch(path+".flac")]);
 if(!index.ok||!audio.ok)throw new Error("No se pudo cargar el banco de "+bank);
 return {zones:await index.json(),bytes:await audio.arrayBuffer()};
}

export function prepareTakes(context,track){
 const bank=bankFor(track);
 if(!bank)return Promise.resolve();
 if(!byContext.has(context))byContext.set(context,new Map());
 const store=byContext.get(context);
 if(!store.has(bank)){
  if(!packs.has(bank))packs.set(bank,fetchTakes(bank).catch(error=>{packs.delete(bank);throw error;}));
  const record={};
  store.set(bank,record);
  record.ready=packs.get(bank).then(async pack=>{
   record.buffer=await context.decodeAudioData(pack.bytes.slice(0));
   record.zones=pack.zones;
  }).catch(()=>{store.delete(bank);});
 }
 return store.get(bank).ready;
}

export function selectTake(context,track,note){
 const kind=bankFor(track),bank=byContext.get(context)?.get(kind);
 if(!bank?.buffer)return null;
 const cfg=WInstruments.get(track);
 if(kind==="electric"&&cfg.articulation===3)return null;
 const pitch=note.pitch+(kind==="nylon"?cfg.capo:0);
 const velocity=kind==="nylon"&&cfg.articulation===1?46:note.velocity;
 const score=zone=>Math.abs(zone[0]-pitch)*6+Math.abs(zone[1]-velocity)/26;
 const [root,,offset,duration]=bank.zones.reduce((a,b)=>score(b)<score(a)?b:a);
 if(Math.abs(root-pitch)>(kind==="piano"?8:6))return null;
 return {kind,buffer:bank.buffer,offset,duration,semitones:pitch-root};
}
