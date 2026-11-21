import { api } from "./client.js";
import { session } from "./state.js";

const MAX_TRACK_BYTES = 200*1024*1024;
const CHUNK_BYTES = 4*1024*1024;
function asMiB(size) {
  if (!size) return "0 MiB";
  const value=size/1024/1024;
  if (value<.1) return Math.max(1,Math.round(size/1024))+" KiB";
  return value.toLocaleString(undefined,{maximumFractionDigits:value<10?1:0})+" MiB";
}

async function uploadTrack(file,destination="library",progress=()=>{},signal) {
  if (!file.size || file.size>MAX_TRACK_BYTES) throw new Error("El archivo debe pesar entre 1 byte y 200 MiB.");
  const owner=session.user.id;
  const storageKey="larp:upload:"+JSON.stringify([owner,destination,file.name,file.size,file.lastModified]);
  const storage={
    get() { try{return localStorage.getItem(storageKey);}catch{return null;} },
    set(id) { try{localStorage.setItem(storageKey,id);}catch{} },
    clear() { try{localStorage.removeItem(storageKey);}catch{} }
  };
  const sync=()=> {
    if (session.user?.id!==owner || signal?.aborted) throw new Error("Carga pausada. Elige el mismo archivo para retomarla.");
  };
  const retry=async operation=>{
    for (let i=0;i<3;i++) {
      sync();
      try { return await operation(); }
      catch(error) {
        if (signal?.aborted || (error.status && error.status<500) || i===2) throw error;
        await new Promise(resolve=>setTimeout(resolve,350*2**i));
      }
    }
  };
  let id=storage.get()||crypto.randomUUID();
  storage.set(id);
  let init;
  for (let step=0;step<2;step++) {
    try {
      init=await retry(()=>api("uploads",{method:"POST",data:{id,name:file.name,size:file.size,destination},signal}));
      break;
    } catch(error) {
      if (error.status!==410 || step) throw error;
      id=crypto.randomUUID();
      storage.set(id);
    }
  }
  if (init.file) {
    storage.clear();
    return init.file;
  }
  const state=await retry(()=>api("uploads/"+id,{signal}));
  if (state.file) { storage.clear(); return state.file; }
  let offset=state.received || 0;
  progress(offset,file.size);
  while (offset<file.size) {
    const part=file.slice(offset,offset+CHUNK_BYTES);
    const result=await retry(()=>api("uploads/"+id+"/part",{ method:"PUT",binary:part,offset,signal }));
    offset=result.received;
    progress(offset,file.size);
  }
  const finished=await retry(()=>api("uploads/"+id+"/complete",{method:"POST",signal}));
  storage.clear();
  progress(file.size,file.size);
  return finished.file;
}

export { asMiB, uploadTrack };
