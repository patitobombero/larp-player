export function encodeWav(buffer,name="larp-mezcla-" + Date.now() + ".wav",bits=16) {
  if (buffer.length > 15_000_000) throw new Error("La grabación es demasiado larga para exportarla.");
  const channels = Math.min(2,buffer.numberOfChannels);
  if (![16,24].includes(bits)) throw new Error("Resolución WAV no compatible.");
  const width=bits/8;
  const bytes = new ArrayBuffer(44+buffer.length*channels*width);
  const view = new DataView(bytes);
  const label = (offset,text) => [...text].forEach((letter,i) => view.setUint8(offset+i,letter.charCodeAt(0)));
  label(0,"RIFF"); view.setUint32(4,bytes.byteLength-8,true); label(8,"WAVE"); label(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true);
  view.setUint32(24,buffer.sampleRate,true); view.setUint32(28,buffer.sampleRate*channels*width,true);
  view.setUint16(32,channels*width,true); view.setUint16(34,bits,true); label(36,"data"); view.setUint32(40,bytes.byteLength-44,true);
  const tracks = Array.from({length:channels},(_,i) => buffer.getChannelData(i));
  const scale=2**(bits-1);
  let cursor = 44;
  for (let index=0;index<buffer.length;index++) for (const track of tracks) {
    const value = Math.max(-1,Math.min(1,track[index]));
    const pcm=Math.round(value*(value<0?scale:scale-1));
    view.setInt16(cursor,pcm,true);
    if (bits===24) view.setInt8(cursor+2,pcm>>16);
    cursor+=width;
  }
  return new File([bytes],name,{type:"audio/wav"});
}

export function downloadFile(file) {
  const url=URL.createObjectURL(file);
  const link=document.createElement("a");
  link.href=url;
  link.download=file.name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export function downloadJSON(name,value) {
  downloadFile(new File([JSON.stringify(value,null,2)],name,{type:"application/json"}));
}
