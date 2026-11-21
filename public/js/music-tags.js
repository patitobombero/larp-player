const fields = {TIT2:"title",TPE1:"artist",TALB:"album",TT2:"title",TP1:"artist",TAL:"album",
  TITLE:"title",ARTIST:"artist",ALBUM:"album"};
const utf8=new TextDecoder();
const latin=new TextDecoder("windows-1252");
const ascii=(data,start,length)=>latin.decode(data.subarray(start,start+length));
const synchsafe=(data,start)=>data.subarray(start,start+4).reduce((value,byte)=>value*128+(byte&127),0);

function clean(value) {
  return value.replace(/\0.*$/su,"").trim().slice(0,160);
}

function id3(data, view) {
  const tags={};
  const version=data[3];
  if (![2,3,4].includes(version) || (data[5]&128)) return tags;
  const limit=Math.min(data.length,10+synchsafe(data,6));
  let offset=10;
  if (data[5]&64) {
    if (version===2 || data.length<14) return tags;
    offset+=version===4?synchsafe(data,10):4+view.getUint32(10);
  }
  const header=version===2?6:10;
  while (offset+header<=limit) {
    const id=ascii(data,offset,version===2?3:4);
    const length=version===2 ? (view.getUint32(offset+2)&0xffffff) :
      version===4 ? synchsafe(data,offset+4) : view.getUint32(offset+4);
    const end=offset+header+length;
    if (!length||end>limit) break;
    const start=offset+header;
    if (fields[id] && (version===2 || !(data[offset+9]&(version===3?224:79)))) {
      const mode=data[start];
      const bytes=data.subarray(start+1,end);
      const big=mode===2 || (bytes[0]===254 && bytes[1]===255);
      const decoder=mode===0?latin:mode===3?utf8:new TextDecoder(big?"utf-16be":"utf-16le");
      tags[fields[id]]=clean(decoder.decode(bytes));
    }
    offset=end;
  }
  return tags;
}

function vorbis(data, view, start, end) {
  const tags={};
  if (start+4>end) return tags;
  let offset=start+4+view.getUint32(start,true);
  if (offset+4>end) return tags;
  const count=view.getUint32(offset,true);
  offset+=4;
  for(let i=0;i<count&&offset+4<=end;i++){
    const length=view.getUint32(offset,true);
    offset+=4;
    if(offset+length>end)break;
    const field=utf8.decode(data.subarray(offset,offset+length));
    const split=field.indexOf("=");
    const key=fields[field.slice(0,split).toUpperCase()];
    if(split>0&&key&&!tags[key])tags[key]=clean(field.slice(split+1));
    offset+=length;
  }
  return tags;
}

export function parseMusicTags(data) {
  if (data.length<10) return {};
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if (ascii(data,0,3)==="ID3") return id3(data,view);
  if (ascii(data,0,4)==="fLaC") {
    let offset=4;
    while (offset+4<=data.length) {
      const type=data[offset]&127;
      const end=offset+4+(view.getUint32(offset)&0xffffff);
      if (end>data.length) break;
      if (type===4) return vorbis(data,view,offset+4,end);
      if (data[offset]&128) break;
      offset=end;
    }
  }
  return {};
}

export async function musicTags(track) {
  const limit=256*1024;
  if (track.file) return parseMusicTags(new Uint8Array(await track.file.slice(0,limit).arrayBuffer()));
  const end=Math.min(track.size||limit,limit)-1;
  const response=await fetch(track.url,{headers:{Range:"bytes=0-"+end}});
  if (response.status!==206) { await response.body?.cancel(); return {}; }
  return parseMusicTags(new Uint8Array(await response.arrayBuffer()));
}
