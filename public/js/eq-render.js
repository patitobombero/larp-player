import { createEqGraph } from "./eq-dsp.js";
import { limitBuffer } from "./peak-limiter.js";
import { encodeWav } from "./wav.js";

export async function exportWithEq(track,settings,bypass){
  if(!track?.url)throw new Error("Selecciona un audio de tu biblioteca.");
  if(track.size>48*1024*1024)throw new Error("La exportación de EQ admite archivos de hasta 48 MiB.");
  const media=new Audio();
  media.preload="metadata";
  try{
    const duration=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("No se pudo leer la duración de la pista.")),15000);
      media.onloadedmetadata=()=>{clearTimeout(timer);resolve(media.duration);};
      media.onerror=()=>{clearTimeout(timer);reject(new Error("El navegador no puede abrir esta pista."));};
      media.src=track.url;
    });
    if(!Number.isFinite(duration)||duration>240)throw new Error("La exportación con EQ admite pistas de hasta cuatro minutos.");
  }finally{media.removeAttribute("src");media.load();}
  const raw=track.file?await track.file.arrayBuffer():await (async()=>{
    const response=await fetch(track.url);
    if(!response.ok)throw new Error("No se pudo obtener el audio de la biblioteca.");
    return response.arrayBuffer();
  })();
  const decoder=new OfflineAudioContext(1,1,48000);
  const sourceBuffer=await decoder.decodeAudioData(raw);
  if(sourceBuffer.duration>240)throw new Error("La exportación con EQ admite pistas de hasta cuatro minutos.");
  // Chromium and Web Audio specify a 6 ms compressor pre-delay. Render
  // through it and compensate it so the WAV preserves alignment and its tail.
  const delay=settings.compressor?Math.floor(.006*48000):0;
  const context=new OfflineAudioContext(2,sourceBuffer.length+delay,48000);
  const source=context.createBufferSource();
  source.buffer=sourceBuffer;
  const eq=createEqGraph(context,source,settings.bands);
  eq.apply(settings,bypass,true);
  eq.output.connect(context.destination);
  source.start();
  let rendered=await context.startRendering();
  if(delay){
    const aligned=context.createBuffer(2,sourceBuffer.length,48000);
    for(let index=0;index<2;index++)aligned.copyToChannel(rendered.getChannelData(index).subarray(delay),index);
    rendered=aligned;
  }
  if(settings.limiter)limitBuffer(rendered,settings.ceiling);
  return encodeWav(rendered,track.name.replace(/\.[^.]+$/u,"")+" - EQ.wav",24);
}
