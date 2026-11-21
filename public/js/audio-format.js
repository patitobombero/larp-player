const WINDOW_SIZE = 16 * 1024;
const MAX_READS = 16;

function id(bytes, offset) {
  return bytes.length >= offset + 4 ? String.fromCharCode(...bytes.subarray(offset,offset+4)) : "";
}

async function rangeBytes(response, length) {
  if (!response.body) return new Uint8Array();
  const bytes = new Uint8Array(length);
  const reader = response.body.getReader();
  let filled = 0;
  try {
    while (filled < length) {
      const {done,value} = await reader.read();
      if (done) break;
      const take = Math.min(value.length,length-filled);
      bytes.set(value.subarray(0,take),filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  return bytes.subarray(0,filled);
}

function audioReader(track, signal) {
  let windowStart = -1;
  let window = new Uint8Array();
  let probes = 0;
  return async (offset, minimum) => {
    if (windowStart >= 0 && offset >= windowStart && offset + minimum <= windowStart + window.length) {
      return window.subarray(offset-windowStart);
    }
    if (++probes > MAX_READS || offset + minimum > (track.size || Number.MAX_SAFE_INTEGER)) return new Uint8Array();
    if (track.file) {
      window = new Uint8Array(await track.file.slice(offset,offset+WINDOW_SIZE).arrayBuffer());
    } else {
      const end = Math.min(offset+WINDOW_SIZE,(track.size || Infinity)) - 1;
      const response = await fetch(track.url,{signal,headers:{Range:`bytes=${offset}-${end}`}});
      if (!response.ok || (offset && response.status!==206)) {
        await response.body?.cancel();
        throw new Error("No se pudo consultar el encabezado de este archivo.");
      }
      window = await rangeBytes(response,WINDOW_SIZE);
    }
    windowStart = offset;
    return window;
  };
}

function flacInfo(bytes) {
  if (bytes.length<42 || (bytes[4]&127)!==0 || bytes[5]!==0 || bytes[6]!==0 || bytes[7]!==34) return null;
  const rate = bytes[18]*4096+bytes[19]*16+(bytes[20]>>4);
  const channels = ((bytes[20]>>1)&7)+1;
  const bits = ((bytes[20]&1)*16+(bytes[21]>>4))+1;
  if (!rate || bits<4) return null;
  return {format:"FLAC",encoding:"PCM",rate,bits,channels};
}

function pcmSubformat(view) {
  // WAVE_FORMAT_EXTENSIBLE stores its PCM or IEEE float subtype as a GUID.
  const suffix=[0,0,16,0,128,0,0,170,0,56,155,113];
  if (!suffix.every((value,i)=>view.getUint8(28+i)===value)) return 0;
  return view.getUint32(24,true);
}

async function waveInfo(read, kind) {
  const little = kind!=="RIFX";
  let offset=12;
  for (let i=0; i<256; i++) {
    const bytes = await read(offset,8);
    if (bytes.length<8) return null;
    const chunk = id(bytes,0);
    const header = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const size = header.getUint32(4,little);
    if (chunk==="data") return null;
    if (chunk==="fmt ") {
      if (size<16) return null;
      const fmt = await read(offset+8,Math.min(size,40));
      if (fmt.length<16) return null;
      const view = new DataView(fmt.buffer,fmt.byteOffset,fmt.byteLength);
      const tag = view.getUint16(0,little);
      const channels = view.getUint16(2,little);
      const rate = view.getUint32(4,little);
      const alignment = view.getUint16(12,little);
      const width = view.getUint16(14,little);
      const extensible = tag===0xfffe;
      if (extensible && (!little || size<40 || fmt.length<40 || view.getUint16(16,true)<22)) return null;
      const encoding = extensible ? pcmSubformat(view) : tag;
      const bits = (extensible ? view.getUint16(18,true) : width) || width;
      if (![1,3].includes(encoding) || !channels || !rate || !bits || bits>width ||
          alignment!==channels*Math.ceil(width/8) || (encoding===1 && width>32) ||
          (encoding===3 && ![32,64].includes(width))) return null;
      return {format:"WAV",encoding:encoding===3?"float":"PCM",rate,bits,channels};
    }
    if (size===0xffffffff) return null;
    offset += 8+size+(size%2);
  }
  return null;
}

export async function readAudioFormat(track, signal) {
  if (!track?.url && !track?.file) return null;
  const read = audioReader(track,signal);
  let bytes = await read(0,12);
  let kind = id(bytes,0);
  if ((kind==="RIFF" || kind==="RF64" || kind==="RIFX") && id(bytes,8)==="WAVE") return waveInfo(read,kind);
  if (bytes.length>=10 && bytes[0]===73 && bytes[1]===68 && bytes[2]===51 && bytes.subarray(6,10).every(v=>v<128)) {
    const offset=10+bytes.subarray(6,10).reduce((total,v)=>total*128+v,0)+(bytes[5]&16?10:0);
    bytes=await read(offset,42);
    kind=id(bytes,0);
  }
  return kind==="fLaC" ? flacInfo(bytes) : null;
}

export function referenceWav() {
  const rate=96000, channels=2, seconds=3, frames=rate*seconds, alignment=channels*3;
  const bytes=new Uint8Array(44+frames*alignment);
  const view=new DataView(bytes.buffer);
  const label=(offset,value)=>bytes.set(new TextEncoder().encode(value),offset);
  label(0,"RIFF"); view.setUint32(4,bytes.length-8,true); label(8,"WAVE"); label(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*alignment,true); view.setUint16(32,alignment,true);
  view.setUint16(34,24,true); label(36,"data"); view.setUint32(40,frames*alignment,true);
  const amplitude=10**(-24/20)*0x7fffff;
  for (let n=0; n<frames; n++) {
    const fade=Math.min(1,n/(rate*.035),(frames-1-n)/(rate*.05));
    const sample=Math.round(Math.sin(n*997*2*Math.PI/rate)*amplitude*fade);
    const offset=44+n*alignment;
    for (let c=0;c<channels;c++) {
      bytes[offset+c*3]=sample;
      bytes[offset+c*3+1]=sample>>8;
      bytes[offset+c*3+2]=sample>>16;
    }
  }
  return new File([bytes],"Larp – referencia 96 kHz 24 bits.wav",{type:"audio/wav"});
}
