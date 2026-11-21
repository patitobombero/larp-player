let database;
function openDrafts() {
  if (!database) database=new Promise((resolve,reject)=>{
    const request=indexedDB.open("larp-studio",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("drafts");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error("Cierra otras pestañas de Larp para abrir el guardado local."));
  }).catch(error=>{database=undefined;throw error;});
  return database;
}

export async function studioDraft(key, snapshot) {
  const db=await openDrafts();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("drafts",snapshot?"readwrite":"readonly");
    const store=tx.objectStore("drafts");
    const request=snapshot?store.put(snapshot,key):store.get(key);
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=tx.onerror=()=>reject(tx.error||request.error);
  });
}
