const MAX_IMAGE=6*1024*1024;
const HEADER=192*1024;
const MIME={jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif"};
const text=(a,i,n)=>String.fromCharCode(...a.subarray(i,i+n));
const view=a=>new DataView(a.buffer,a.byteOffset,a.byteLength);
const uint=(a,i)=>view(a).getUint32(i);
const sized=(a,i)=>a.subarray(i,i+4).reduce((n,x)=>(n<<7)|(x&127),0);
const cover=(bytes,front=false)=>{
 if(bytes.length<12||bytes.length>MAX_IMAGE)return null;
 const type=bytes[0]===255&&bytes[1]===216?MIME.jpeg:bytes[0]===137&&text(bytes,1,3)==="PNG"?MIME.png:
  text(bytes,0,3)==="GIF"?MIME.gif:text(bytes,0,4)==="RIFF"&&text(bytes,8,4)==="WEBP"?MIME.webp:null;
 return type?{blob:new Blob([bytes],{type}),front}:null;
};
const unsync=bytes=>{
 const fixed=new Uint8Array(bytes.length);
 let used=0;
 for(let i=0;i<bytes.length;i++){
  fixed[used++]=bytes[i];
  if(bytes[i]===255&&bytes[i+1]===0)i++;
 }
 return fixed.subarray(0,used);
};
function takeID3(data){
 const v=data[3],flags=data[5],header=v===2?6:10;
 if(![2,3,4].includes(v))return null;
 const end=Math.min(data.length,10+sized(data,6));
 let buffer=data.subarray(0,end),pos=10;
 if(v<4&&(flags&128))buffer=unsync(buffer);
 if(flags&64){
  if(v===2||buffer.length<14)return null;
  pos+=v===4?sized(buffer,10):uint(buffer,10)+4;
 }
 let found=null;
 while(pos+header<=buffer.length){
  const tag=text(buffer,pos,v===2?3:4);
  const size=v===2?((buffer[pos+3]<<16)|(buffer[pos+4]<<8)|buffer[pos+5]):v===4?sized(buffer,pos+4):uint(buffer,pos+4);
  const next=pos+header+size;
  if(!size||next>buffer.length)break;
  const flags=v===2?0:buffer[pos+9];
  let bytes=buffer.subarray(pos+header,next);
  if((tag==="APIC"||tag==="PIC")&&!(flags&(v===3?224:v===4?76:0))){
   if(v===4&&((flags&2)||(buffer[5]&128)))bytes=unsync(bytes);
   if(v===4&&(flags&1))bytes=bytes.subarray(4);
   const encoding=bytes[0];
   const mimeEnd=tag==="PIC"?3:bytes.indexOf(0,1);
   if(mimeEnd>=0&&mimeEnd+2<bytes.length){
    const front=bytes[mimeEnd+1]===3,wide=encoding===1||encoding===2;
    let at=mimeEnd+2;
    for(;at<bytes.length;at+=wide?2:1){
     if(bytes[at]===0&&(!wide||bytes[at+1]===0))break;
    }
    const image=cover(bytes.subarray(at+(wide?2:1)),front);
    if(image?.front)return image;
    found||=image;
   }
  }
  pos=next;
 }
 return found;
}
function flacPicture(data){
 if(data.length<32)return null;
 const front=uint(data,0)===3;
 let at=8+uint(data,4);
 if(at+4>data.length)return null;
 at+=4+uint(data,at)+16;
 if(at+4>data.length)return null;
 const length=uint(data,at);
 if(at+4+length>data.length)return null;
 return cover(data.subarray(at+4,at+4+length),front);
}
function flacBlocks(data){
 let found=null;
 for(let i=4;i+4<=data.length;){
  const header=data[i],end=i+4+(uint(data,i)&0xffffff);
  if(end>data.length)return found||undefined;
  if((header&127)===6){
   const candidate=flacPicture(data.subarray(i+4,end));
   if(candidate?.front)return candidate;
   found||=candidate;
  }
  if(header&128)return found;
  i=end;
 }
 return found||undefined;
}
function oggPicture(bytes){
 const matches=bytes=>text(bytes,0,8)==="OpusTags"?8:bytes[0]===3&&text(bytes,1,6)==="vorbis"?7:0;
 function readComments(packet){
  let pos=matches(packet);
  if(!pos||pos+8>packet.length)return null;
  const reader=view(packet);
  pos+=4+reader.getUint32(pos,true);
  if(pos+4>packet.length)return null;
  const count=reader.getUint32(pos,true);pos+=4;
  for(let j=0;j<count&&pos+4<=packet.length;j++){
   const n=reader.getUint32(pos,true);pos+=4;
   if(pos+n>packet.length)break;
   if(text(packet,pos,23).toUpperCase()==="METADATA_BLOCK_PICTURE="){
    const encoded=new TextDecoder().decode(packet.subarray(pos+23,pos+n));
    try{return flacPicture(Uint8Array.from(atob(encoded),x=>x.charCodeAt(0)));}
    catch{return null;}
   }
   pos+=n;
  }
  return null;
 }
 let fragments=[],length=0;
 for(let offset=0;offset+27<=bytes.length&&text(bytes,offset,4)==="OggS";){
  const count=bytes[offset+26],table=offset+27;
  let at=table+count;
  if(at>bytes.length)break;
  for(const n of bytes.subarray(table,at)){
   if(at+n>bytes.length)return undefined;
   fragments.push(bytes.subarray(at,at+n));length+=n;at+=n;
   if(n===255)continue;
   const packet=new Uint8Array(length);
   let i=0;
   for(const fragment of fragments){packet.set(fragment,i);i+=fragment.length;}
   fragments=[];length=0;
   if(matches(packet))return readComments(packet);
  }
  offset=at;
 }
 return undefined;
}
function atom(bytes,at){
 if(at+8>bytes.length)return null;
 const type=text(bytes,at+4,4);
 let length=uint(bytes,at),header=8;
 if(length===1){
  if(at+16>bytes.length)return null;
  length=Number(view(bytes).getBigUint64(at+8));header=16;
 }
 if(!length)length=bytes.length-at;
 return Number.isSafeInteger(length)&&length>=header?{type,length,header}:null;
}
function mp4Picture(bytes,start=0,end=bytes.length,depth=0,parent=""){
 if(depth>6)return null;
 for(let at=start;at+8<=end;){
  const box=atom(bytes,at);
  if(!box||at+box.length>end)break;
  const first=at+box.header,last=at+box.length;
  if(box.type==="data"&&parent==="covr"&&first+8<last){
   const image=cover(bytes.subarray(first+8,last));
   if(image)return image;
  }
  if(["moov","udta","meta","ilst","covr"].includes(box.type)){
   const found=mp4Picture(bytes,first+(box.type==="meta"?4:0),last,depth+1,box.type);
   if(found)return found;
  }
  at=last;
 }
 return null;
}
function riffPicture(bytes){
 const v=view(bytes);
 for(let at=12;at+8<=bytes.length;){
  const n=v.getUint32(at+4,true),last=at+8+n;
  if(last>bytes.length)break;
  if(text(bytes,at,4).toLowerCase()==="id3 ")return takeID3(bytes.subarray(at+8,last));
  at=last+(n&1);
 }
 return null;
}
export async function readArtwork(track,signal){
 const size=track.file?.size||track.size||0;
 if(!size)return null;
 async function range(start,end){
  end=Math.min(end,size);
  if(start>=end)return new Uint8Array();
  if(track.file)return new Uint8Array(await track.file.slice(start,end).arrayBuffer());
  const response=await fetch(track.url,{headers:{Range:`bytes=${start}-${end-1}`},signal});
  if(response.status!==206){await response.body?.cancel();return new Uint8Array();}
  return new Uint8Array(await response.arrayBuffer());
 }
 const head=await range(0,HEADER);
 if(head.length<12)return null;
 const kind=text(head,0,4);
 if(kind.startsWith("ID3")){
  const required=10+sized(head,6);
  return (takeID3(required<=head.length?head:await range(0,Math.min(required,MAX_IMAGE)))?.blob)||null;
 }
 if(kind==="fLaC"||kind==="OggS"){
  const parser=kind==="fLaC"?flacBlocks:oggPicture;
  const picture=parser(head);
  return (picture===undefined&&size>head.length?parser(await range(0,MAX_IMAGE)):picture)?.blob||null;
 }
 if(kind==="RIFF"){
  const immediate=riffPicture(head);
  if(immediate)return immediate.blob;
  // WAV ID3 can be written after PCM, so scan chunk headers without reading it.
  for(let at=12,max=32;at+8<=size&&max--;){
   const header=at+8<=head.length?head.subarray(at,at+8):await range(at,at+8);
   if(header.length<8)break;
   const n=view(header).getUint32(4,true);
   if(text(header,0,4).toLowerCase()==="id3 "&&n<=MAX_IMAGE)return takeID3(await range(at+8,at+8+n))?.blob||null;
   at+=8+n+(n&1);
  }
 }
 if(text(head,4,4)==="ftyp"){
  for(let at=0,max=20;at+8<=size&&max--;){
   const header=at+16<=head.length?head.subarray(at,at+16):await range(at,at+16);
   const box=atom(header,0);
   if(!box)break;
   if(box.type==="moov"&&box.length<=MAX_IMAGE)return mp4Picture(at+box.length<=head.length?head.subarray(at,at+box.length):await range(at,at+box.length))?.blob||null;
   at+=box.length;
  }
 }
 return null;
}
