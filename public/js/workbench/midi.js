import { clamp } from "./host.js";
const WMidi=(()=>{
 function parse(buffer){
  const data=new DataView(buffer);
  let pos=0;
  const remaining=n=>{if(pos+n>data.byteLength)throw new Error("El MIDI está incompleto.");};
  const u8=()=>{remaining(1);return data.getUint8(pos++);};
  const u16=()=>{remaining(2);const v=data.getUint16(pos);pos+=2;return v;};
  const u32=()=>{remaining(4);const v=data.getUint32(pos);pos+=4;return v;};
  function word(){return String.fromCharCode(u8(),u8(),u8(),u8());}
  function vlq(){
   let value=0;
   for(let i=0;i<4;i++){const b=u8();value=value*128+(b&127);if(!(b&128))return value;}
   throw new Error("La duración de un evento MIDI no es válida.");
  }
  if(word()!=="MThd")throw new Error("Elige un archivo Standard MIDI.");
  const headerBytes=u32(),startHeader=pos;
  if(headerBytes<6)throw new Error("La cabecera MIDI es inválida.");
  const format=u16(),count=u16(),ppq=u16();
  if(format>1||!count||count>256||ppq===0||(ppq&0x8000))throw new Error("Elige MIDI tipo 0 o 1 con resolución por pulsos.");
  pos=startHeader+headerBytes;remaining(0);
  const parts=[];
  let tempo=120,tempoTick=Infinity;
  const chars=new TextDecoder();
  for(let row=0;row<count;row++){
   if(word()!=="MTrk")throw new Error("Falta una pista MIDI.");
   const bytes=u32(),end=pos+bytes;
   remaining(bytes);
   let tick=0,status=0,name="";
   const channels=new Map();
   function channel(id){
    if(!channels.has(id))channels.set(id,{id,program:0,open:new Map(),notes:[]});
    return channels.get(id);
   }
   function finish(c,pitch){
    const n=c.open.get(pitch)?.shift();
    if(n){n.length=Math.max(.03125,Math.min(1e12,(tick-n.tick)/ppq));c.notes.push(n);}
   }
   while(pos<end){
    tick+=vlq();let code=u8();
    if(code<128){pos--;code=status;if(!status)throw new Error("Estado MIDI inválido.");}
    if(code===255){
     const type=u8(),size=vlq();remaining(size);
     if(type===81&&size===3&&tick<tempoTick){
      const period=data.getUint8(pos)*65536+data.getUint16(pos+1);
      if(period>0){tempoTick=tick;tempo=clamp(60000000/period,30,300);}
     }
     if(type===3&&!name)name=chars.decode(new Uint8Array(buffer,pos,size)).trim().slice(0,60);
     pos+=size;if(type===47)break;continue;
    }
    if(code===240||code===247){const size=vlq();remaining(size);pos+=size;status=0;continue;}
    if(code>=240)throw new Error("El MIDI contiene un evento de sistema incompatible.");
    status=code;
    const hi=code>>4,c=channel(code&15),a=u8(),b=hi===12||hi===13?0:u8();
    if(a>=128||b>=128)throw new Error("El MIDI contiene un valor inválido.");
    if(hi===12)c.program=a;
    if(hi===8||(hi===9&&!b))finish(c,a);
    if(hi===9&&b){
     if(!c.open.has(a))c.open.set(a,[]);
     c.open.get(a).push({tick,start:tick/ppq,pitch:a,velocity:b});
    }
   }
   if(pos>end)throw new Error("La duración de la pista MIDI es inválida.");
   pos=end;
   for(const c of channels.values()){
    for(const [pitch,open] of c.open)while(open.length)finish(c,pitch);
    if(c.notes.length)parts.push({name,id:c.id,program:c.program,notes:c.notes.sort((a,b)=>a.start-b.start)});
   }
  }
  if(!parts.length)throw new Error("El MIDI no contiene notas.");
  return {parts,tempo};
 }
 function instrument(part){
  if(part.id===9)return "drums";
  const n=part.program;
  if(n<=3)return "piano";
  if(n<=7)return "rhodes";
  if(n>=24&&n<=31)return "guitar";
  if(n>=32&&n<=39)return "bass";
  if(n>=40&&n<=47)return "cello";
  if(n>=72&&n<=79)return "flute";
  return "synth";
 }
 const drumPitch=note=>{
  if(note===35||note===36)return 60;
  if(note===38||note===40||note===37)return 61;
  if(note===42||note===44)return 62;
  if(note===46)return 63;
  if(note>=41&&note<=48)return note<45?64:65;
  if(note===39)return 66;
  return 67;
 };
 return {parse,instrument,drumPitch};
})();

export { WMidi };
