const WRecord=(()=>{
 const secondsPerBeat=bpm=>60/bpm;
 const countIn=bpm=>4*secondsPerBeat(bpm);
 function tick(a,out,time,index){
  const osc=a.createOscillator(),edge=a.createGain();
  const accent=index%4===0;
  osc.frequency.value=accent?1490:1040;
  edge.gain.setValueAtTime(0,time);
  edge.gain.linearRampToValueAtTime(accent?.075:.046,time+.0019);
  edge.gain.exponentialRampToValueAtTime(.000006,time+.043);
  osc.connect(edge).connect(out);osc.start(time);osc.stop(time+.046);
  osc.onended=()=>{osc.disconnect();edge.disconnect();};
  return osc;
 }
 function guide(a,bpm,start,accent=0){
  const bus=a.createGain();bus.connect(a.destination);
  const ticks=new Set(),period=secondsPerBeat(bpm);
  let next=0;
  function queue(){
   const now=a.currentTime;
   while(start+next*period<now+.16){
    const at=start+next*period;
    if(at>=now-.004){
     const osc=tick(a,bus,Math.max(now,at),next+accent);
     ticks.add(osc);osc.addEventListener("ended",()=>ticks.delete(osc),{once:true});
    }
    next++;
   }
  }
  const timer=setInterval(queue,24);queue();
  return {period,start,stop(){
   clearInterval(timer);bus.disconnect();
   for(const osc of ticks)try{osc.stop();}catch{}
   ticks.clear();
  }};
 }
 const installed=new WeakMap();
 function wav(parts,rate,channels){
  const samples=parts.reduce((n,part)=>n+part.length,0),bytes=samples*3,padding=bytes%2;
  const header=new DataView(new ArrayBuffer(44));
  const ascii=(at,str)=>Array.from(str).forEach((char,i)=>header.setUint8(at+i,char.charCodeAt(0)));
  ascii(0,"RIFF");header.setUint32(4,36+bytes+padding,true);ascii(8,"WAVEfmt ");
  header.setUint32(16,16,true);header.setUint16(20,1,true);header.setUint16(22,channels,true);
  header.setUint32(24,rate,true);header.setUint32(28,rate*channels*3,true);
  header.setUint16(32,channels*3,true);header.setUint16(34,24,true);ascii(36,"data");header.setUint32(40,bytes,true);
  const blocks=parts.map(chunk=>{
   const raw=new Uint8Array(chunk.length*3);
   for(let i=0;i<chunk.length;i++){
    const v=Math.max(-8388608,Math.min(8388607,Math.round(chunk[i]*8388608)));
    raw[i*3]=v&255;raw[i*3+1]=(v>>8)&255;raw[i*3+2]=(v>>16)&255;
   }
   return raw;
  });
  return new Blob([header.buffer,...blocks,new Uint8Array(padding)],{type:"audio/wav"});
 }
 async function openPCM(a,stream,ready,byteLimit,bpm){
  if(!installed.has(a)){
   installed.set(a,a.audioWorklet.addModule(new URL("./mic-worklet.js",import.meta.url)).catch(error=>{installed.delete(a);throw error;}));
  }
  await installed.get(a);
  const channels=Math.min(2,Math.max(1,stream.getAudioTracks()[0].getSettings().channelCount||1));
  const rate=a.sampleRate,maximum=Math.max(1,Math.floor((byteLimit-46)/(3*channels)));
  const lead=a.currentTime+.115,start=Math.ceil((lead+countIn(bpm))*rate);
  const source=a.createMediaStreamSource(stream),silent=a.createGain();
  const node=new AudioWorkletNode(a,"larp-pcm-capture",{
   numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:channels,channelCountMode:"explicit",
   processorOptions:{start,maximum,channels}
  });
  silent.gain.value=0;source.connect(node).connect(silent).connect(a.destination);
  const parts=[];
  function close(){source.disconnect();node.disconnect();silent.disconnect();node.port.close();}
  let cancel;
  const finished=new Promise((resolve,reject)=>{
   cancel=()=>reject(new Error("La toma se canceló."));
   node.port.onmessage=e=>{
    if(e.data.pcm)parts.push(e.data.pcm);
    if(e.data.done)resolve({blob:wav(parts,rate,channels),extension:"wav",channels,rate});
   };
   node.onprocessorerror=()=>reject(new Error("Se interrumpió la captura de audio."));
  }).finally(close);
  const stop=()=>node.port.postMessage("stop");
  const state={lead:start/rate-countIn(bpm),start:start/rate,stop,cancel,finished,format:"WAV PCM 24 bits · "+Math.round(rate/100)/10+" kHz"};
  ready(state);
  return state;
 }
 function fallback(a,stream,ready,byteLimit,bpm){
  if(typeof MediaRecorder!=="function")throw new Error("Este navegador no ofrece captura de micrófono.");
  const captures=[],rec=new MediaRecorder(stream),lead=a.currentTime+.115,start=lead+countIn(bpm);
  let cancel,stop,timer,bytes=0;
  const finished=new Promise((resolve,reject)=>{
   cancel=()=>{clearTimeout(timer);if(rec.state!=="inactive")rec.stop();reject(new Error("La toma se canceló."));};
   stop=()=>{
    clearTimeout(timer);if(rec.state!=="inactive")rec.stop();
    else if(a.currentTime<start)resolve({blob:new Blob([]),extension:"webm"});
   };
   const begin=()=>{
    const remain=start-a.currentTime;
    if(remain>.006){timer=setTimeout(begin,Math.ceil(remain*1000));return;}
    try{rec.start(250);}catch(error){reject(error);}
   };
   timer=setTimeout(begin,(start-a.currentTime)*1000);
   rec.ondataavailable=e=>{
    if(e.data.size){captures.push(e.data);bytes+=e.data.size;}
    if(bytes>=Math.max(0,byteLimit-65536)&&rec.state!=="inactive")rec.stop();
   };
   rec.onerror=()=>reject(new Error("Se interrumpió la captura de audio."));
   rec.onstop=()=>{
    const type=rec.mimeType||"audio/webm",extension=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
    resolve({blob:new Blob(captures,{type}),extension});
   };
  });
  const state={lead,start,stop,cancel,finished,format:"Formato de micrófono del navegador"};
  ready(state);return state;
 }
 async function mic(a,stream,ready,byteLimit=90*1024*1024,bpm=120){
  if(a.audioWorklet&&typeof AudioWorkletNode==="function"){
   try{return await openPCM(a,stream,ready,byteLimit,bpm);}catch{if(!stream.active)throw new Error("La toma se canceló.");}
  }
  return fallback(a,stream,ready,byteLimit,bpm);
 }
 return {secondsPerBeat,countIn,guide,tick,mic,wav};
})();

export { WRecord };
