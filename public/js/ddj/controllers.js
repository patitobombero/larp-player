import { DECKS } from "./data.js";

const buttons=[
 ["play","Play / pausa"],["cue","Cue"],["sync","Sync"],["master","Master"],["mt","Bloquear tono"],
 ["loop4","Loop de 4"],["loop8","Loop de 8"],["loop16","Loop de 16"],["reloop","Salir / volver al loop"],
 ...Array.from({length:8},(_,index)=>["cue"+index,"Hot Cue "+String.fromCharCode(65+index)]),
 ["key-up","Tono +"],["key-down","Tono −"]
];
const rotary=[
 ["trim","Trim",-18,12,.1],["low","Graves",-24,9,.1],["mid","Medios",-24,9,.1],
 ["high","Agudos",-24,9,.1],["filter","Filtro",-1,1,.01],["level","Fader",0,1,.01],["tempo","Tempo"],
 ["cross","Crossfader",-1,1,.01],["master-volume","Ganancia máster",0,1,.01]
];
const continuous=new Set(rotary.map(([key])=>key));

export function controllerBody(){
 return `<details class="card ddj-controllers"><summary>Controladoras MIDI / HID</summary>
   <div class="toolbar"><button type="button" class="g" data-midi-connect>Conectar MIDI</button>
     <button type="button" class="g" data-hid-connect>Conectar HID</button>
     <button type="button" class="g" data-device-disconnect>Desconectar</button></div>
   <div class="toolbar">
     <label>Deck <select data-device-deck>${DECKS.map(id=>`<option>${id}</option>`).join("")}</select></label>
     <label>Función <select data-device-action>${[...buttons,...rotary].map(([id,label])=>`<option value="${id}">${label}</option>`).join("")}</select></label>
     <button type="button" class="g" data-device-learn>Aprender control</button>
     <button type="button" class="g" data-device-forget>Quitar asignación</button>
   </div>
   <p data-device-status class="muted" role="status"></p>
   <p class="muted">Conecta un dispositivo, elige una función y pulsa el botón o mueve el control que quieras asignar. HID aprende botones simples y faders absolutos de un byte.</p>
  </details>`;
}

function readMidi(message){
 if(message.length<3)return [];
 const [status,key,level]=message;
 const type=status&0xf0,channel=status&15;
 if(type===0x90||type===0x80)return [{key:`n:${channel}:${key}`,value:type===0x80?0:level/127,button:true}];
 if(type===0xb0)return [{key:`c:${channel}:${key}`,value:level/127,button:false}];
 if(type===0xe0)return [{key:`p:${channel}`,value:((level<<7)|key)/16383,button:false}];
 return [];
}

export function createControllers({storageKey,present,operate}){
 let controller,midi=null,learning=null;
 const hids=new Set(),state=new Map();
 let seen=new WeakSet();
 let panel=null,message="";
 function status(value=message){
  message=value;
  const label=panel?.querySelector("[data-device-status]");
  if(label)label.textContent=value||"Ninguna controladora conectada.";
 }
 function load(){
  try{return JSON.parse(localStorage.getItem(storageKey()+":controllers"))||{};}
  catch{return {};}
 }
 function save(values){
  try{localStorage.setItem(storageKey()+":controllers",JSON.stringify(values));}
  catch{status("El navegador no pudo guardar la asignación.");}
 }
 let mappings=null;
 function event(from,changes){
  if(!present())return;
  const known=mappings??=load();
  if(learning){
   const want=continuous.has(learning.action);
   const candidate=changes.find(change=>change.button!==want&&(!change.button||change.value>.5))||
     (want?null:changes.find(change=>!change.button&&change.value>.5));
   if(!candidate)return;
   for(const [key,value] of Object.entries(known)){
    if(value.deck===learning.deck&&value.action===learning.action)delete known[key];
   }
   known[from+"|"+candidate.key]=learning;
   save(known);
   status("Asignado a deck "+learning.deck+" · "+learning.label+".");
   learning=null;
   return;
  }
  for(const change of changes){
   const key=from+"|"+change.key,mapping=known[key];
   if(!mapping)continue;
   const previous=state.get(key)||0;
   state.set(key,change.value);
   if(continuous.has(mapping.action)||change.value>.5&&previous<=.5||mapping.action==="cue"&&change.value<=.5&&previous>.5){
    operate(mapping,change.value,continuous.has(mapping.action));
   }
  }
 }
 function available(){
  return (controller??=new AbortController()).signal;
 }
 function bindMidi(){
  for(const input of midi.inputs.values()){
   if(seen.has(input))continue;
   seen.add(input);
   input.addEventListener("midimessage",({data})=>event("midi:"+input.id,readMidi(data)),{signal:available()});
  }
  status(midi.inputs.size?midi.inputs.size+" entrada(s) MIDI habilitada(s).":"MIDI habilitado. Conecta una controladora.");
 }
 async function connectMidi(){
  if(!navigator.requestMIDIAccess)throw new Error("Este navegador no ofrece acceso MIDI.");
  if(midi){bindMidi();return;}
  midi=await navigator.requestMIDIAccess({sysex:false});
  midi.addEventListener("statechange",bindMidi,{signal:available()});
  bindMidi();
 }
 async function connectHid(){
  if(!navigator.hid)throw new Error("Este navegador no ofrece acceso HID.");
  const devices=await navigator.hid.requestDevice({filters:[{vendorId:0x08e4},{usagePage:0xff00},{usagePage:0xffa0},
   {usagePage:1,usage:4},{usagePage:1,usage:5}]});
  for(const device of devices){
   if(hids.has(device))continue;
   if(!device.opened)await device.open();
   hids.add(device);
   const reports=new Map();
   device.addEventListener("inputreport",({reportId,data})=>{
    const values=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();
    const previous=reports.get(reportId);
    reports.set(reportId,values);
    if(!previous)return;
    const changes=[];
    for(let i=0;i<values.length;i++){
     const delta=values[i]^(previous[i]??0);
     if(!delta)continue;
     changes.push({key:`h:${reportId}:${i}`,value:values[i]/255,button:false});
     for(let bit=0;bit<8;bit++)if(delta&(1<<bit)){
      changes.push({key:`b:${reportId}:${i}:${bit}`,value:Number(Boolean(values[i]&(1<<bit))),button:true});
     }
    }
    event(`hid:${device.vendorId}:${device.productId}`,changes);
   },{signal:available()});
  }
  if(devices.length)status(devices.map(device=>device.productName||"HID").join(", ")+" conectado.");
 }
 function disconnect(){
  controller?.abort();controller=null;midi=null;learning=null;mappings=null;seen=new WeakSet();
  for(const device of hids)device.close().catch(()=>{});
  hids.clear();state.clear();status("");
 }
 function mount(root){
  panel=root.querySelector(".ddj-controllers");
  const find=selector=>panel.querySelector(selector);
  const chosen=()=>({deck:find("[data-device-deck]").value,action:find("[data-device-action]").value,
   label:find("[data-device-action]").selectedOptions[0].textContent});
  const connect=fn=>()=>fn().catch(error=>status(error.message));
  find("[data-midi-connect]").onclick=connect(connectMidi);
  find("[data-hid-connect]").onclick=connect(connectHid);
  find("[data-device-disconnect]").onclick=disconnect;
  find("[data-device-learn]").onclick=()=>{
   if(!midi&&!hids.size){status("Conecta MIDI o HID para asignar un control.");return;}
   learning=chosen();status("Mueve o pulsa el control físico.");
  };
  find("[data-device-forget]").onclick=()=>{
   const {deck,action}=chosen(),known=mappings??=load();
   for(const [key,value] of Object.entries(known)){
    if(value.deck===deck&&value.action===action)delete known[key];
   }
   learning=null;save(known);status("Asignación quitada.");
  };
  status();
 }
 return {mount,disconnect};
}

export function controllerRange(action){
 return rotary.find(([id])=>id===action)?.slice(2);
}
