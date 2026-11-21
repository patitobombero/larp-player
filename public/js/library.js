import { appearance, applyAppearance } from "./appearances.js";
import { au, paintPlayer, play, playNext, restoreLibraryPlayback, setPlayOrder, trackChanged } from "./audio.js";
import { api, bindForm, fileLink, img, media, task } from "./client.js";
import { $, esc, toast } from "./common.js";
import { musicTags } from "./music-tags.js";
import { editPlaylist, picker } from "./playlists.js";
import { AUDIO_EXT, djHooks, navigation, session } from "./state.js";
import { asMiB, uploadTrack } from "./uploads.js";
import { StudioWorkbench } from "./workbench/ui.js";

let librarySearch="";
let librarySort="new";


function entries() {
  const normalized=text=>text.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase().trim();
  const query=normalized(librarySearch);
  const result=session.tracks.filter(file=>normalized([file.name,file.title,file.artist,file.album,file.mime].filter(Boolean).join(" ")).includes(query));
  const newer=(a,b)=>(b.created||0)-(a.created||0);
  const byName=(a,b)=>(a.title||a.name).localeCompare(b.title||b.name,undefined,{sensitivity:"base",numeric:true});
  return result.sort(({new:newer,old:(a,b)=>newer(b,a),name:byName,size:(a,b)=>(b.size||0)-(a.size||0)})[librarySort]||newer);
}

function viewLibrary() {
  $("#main").innerHTML = `<section class="page library-page">
    <header class="page-heading"><div><h1>Biblioteca</h1><p>${session.user?"Tu colección privada, listas y mezclas.":"Reproduce música o inicia sesión para guardar tu colección."}</p></div>
      <label class="b upload-button" for="library-input">＋ ${session.user?"Subir audio":"Abrir audio"}<input id="library-input" type="file" accept="${AUDIO_EXT}" multiple class="sr-only"></label>
    </header>
    <div class="library-snapshot">
      <section class="card library-drop" id="library-drop">
        <div class="drop-graphic" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div><h2>${session.user?"Añade tu música":"Escucha desde este dispositivo"}</h2><p>${session.user?"Arrastra archivos aquí o usa Subir audio.":"Puedes abrir varios archivos para reproducirlos en esta sesión."}</p>
          <p class="muted">${session.user?"MP3, FLAC, WAV, OGG y más · hasta 200 MiB por pista":"Guarda tus pistas y playlists al iniciar sesión."}</p></div>
      </section>
      <section class="card capacity-card" id="storage-card"></section>
    </div>
    <section class="card" id="upload-status" hidden>
      <div class="section-line"><div><h2>Carga en curso</h2><p class="muted" id="upload-message"></p></div>
        <button class="g" id="pause-upload">Pausar</button></div>
      <progress id="upload-progress" value="0" max="100" aria-label="Progreso de carga"></progress>
    </section>
    <p id="library-error" class="error" role="alert"></p>
    <div id="pending-uploads"></div>
    ${session.user?'<section class="card" aria-labelledby="library-project-title"><div class="section-line"><h2 id="library-project-title">Proyectos</h2><button class="g" type="button" id="library-legacy">Proyectos anteriores</button></div><div id="library-projects" role="status">Cargando proyectos…</div></section>':""}
    <section class="card songs-card" aria-labelledby="songs-title">
      <div class="section-line"><div><h2 id="songs-title">Pistas <span id="track-total"></span></h2></div>
      <div class="toolbar"><button class="g" id="play-results" title="Reproducir las pistas visibles">Reproducir</button>
        <button class="g view-toggle" id="library-view" aria-label="Cambiar vista">${appearance.libraryView==="list"?"Cuadrícula":"Lista"}</button></div></div>
      <div class="song-controls"><label class="library-search"><span aria-hidden="true">⌕</span><input id="library-filter" type="search" placeholder="Buscar por título, artista, álbum o formato" aria-label="Buscar en la biblioteca" value="${esc(librarySearch)}"></label>
        <select id="library-sort" aria-label="Ordenar pistas">${[["new","Agregadas recientemente"],["old","Más antiguas"],["name","Título"],["size","Tamaño"]].map(([value,name])=>`<option value="${value}" ${librarySort===value?"selected":""}>${name}</option>`).join("")}</select></div>
      <div id="library-songs"></div>
    </section>
    ${session.user ? `<section class="card">
      <div class="section-line"><div><h2>Playlists privadas</h2><p class="muted">Organiza tu música y reproduce cada lista en su propio orden.</p></div>
        <button class="b" id="new-list">＋ Crear playlist</button></div>
      <div class="playlist-grid">${session.playlists.map(list => `<div class="playlist-card">${list.cover ? img(list.cover,"cover-sm","Portada de " + list.name,true) : '<span class="playlist-placeholder">♫</span>'}
        <div class="sp"><b>${esc(list.name)}</b><div class="muted">${list.tracks.length} ${list.tracks.length===1?"pista":"pistas"}</div></div>
        <button class="g" data-show-list="${list.id}">Abrir</button></div>`).join("") || '<p class="muted">Aún no hay playlists en tu cuenta.</p>'}
      </div><div id="list-detail"></div></section>` : ""}
  </section>`;
  const picker=$("#library-input");
  picker.onchange=event=>{ const files=[...event.target.files]; event.target.value=""; if (files.length) startLibraryBatch(files); };
  const drop=$("#library-drop");
  drop.ondragover=event=>{ event.preventDefault(); drop.classList.add("dragging"); };
  drop.ondragleave=()=>drop.classList.remove("dragging");
  drop.ondrop=event=>{ event.preventDefault(); drop.classList.remove("dragging"); const files=[...event.dataTransfer.files]; if (files.length) startLibraryBatch(files); };
  $("#pause-upload").onclick=()=>session.uploadBatch?.controller.abort();
  $("#library-filter").oninput=event=>{librarySearch=event.target.value;paintSongs();};
  $("#library-sort").onchange=event=>{librarySort=event.target.value;paintSongs();};
  $("#play-results").onclick=()=>{
    const shown=entries();
    if (!shown.length) return;
    setPlayOrder(shown.map(file=>file.id));
    play(session.tracks.indexOf(shown[0]));
  };
  $("#library-view").onclick=event=>{
    applyAppearance({...appearance,libraryView:appearance.libraryView==="list"?"grid":"list"});
    event.currentTarget.textContent=appearance.libraryView==="list"?"Cuadrícula":"Lista";
    paintSongs();
  };
  if ($("#new-list")) $("#new-list").onclick=()=>editPlaylist(null);
  $("#main").querySelectorAll("[data-show-list]").forEach(button=>{
    button.onclick=()=>editPlaylist(session.playlists.find(list=>list.id===button.dataset.showList));
  });
  paintStorage(); paintLibraryUpload(); paintPending(); paintSongs();
  const projects=$("#library-projects");
  if(projects){
    $("#library-legacy").onclick=()=>navigation.go("syn-legacy");
    paintProjects(projects);
  }
}

async function paintProjects(root) {
  try{
    const items=await api("project-files");
    if(!root.isConnected)return;
    root.innerHTML=items.length?`<div class="song-list">${items.map(item=>`<article class="song">
      <div class="song-text"><b>${esc(item.name.replace(/\.larp\.json$/i,""))}</b><span>${asMiB(item.size)}</span></div>
      <div class="song-actions"><button class="b" type="button" data-project-open="${esc(item.id)}">Abrir en Estudio</button>${fileLink(item.id)}<button class="g" type="button" data-project-remove="${esc(item.id)}">Borrar</button></div>
    </article>`).join("")}</div>`:'<p class="muted">Aquí se conservan las copias editables subidas en la versión anterior.</p>';
    root.onclick=event=>{
      const button=event.target.closest("button"),id=button?.dataset.projectOpen||button?.dataset.projectRemove;
      const item=items.find(candidate=>candidate.id===id);
      if(!item)return;
      if(button.dataset.projectOpen)task(button,()=>StudioWorkbench.openLibraryProject(item));
      else if(confirm("¿Borrar este proyecto de tu Biblioteca?"))task(button,async()=>{
        await api("project-files/"+item.id,{method:"DELETE"});
        await Promise.all([paintProjects(root),refreshLibrary()]);
      });
    };
  }catch(error){if(root.isConnected)root.textContent=error.message;}
}

function paintStorage() {
  const view=$("#storage-card");
  if (!view) return;
  const uploaded=session.savedTracks.reduce((total,file)=>total+file.size,0);
  const used=session.storage?.used??uploaded;
  const maximum=session.storage?.limit??(750*1024*1024);
  const share=Math.min(100,Math.round(used/maximum*100));
  view.innerHTML = session.user ? `<div class="section-line"><h2>Almacenamiento</h2><span>${share}%</span></div>
    <strong class="storage-value">${asMiB(used)} <small>/ ${asMiB(maximum)}</small></strong>
    <progress value="${used}" max="${maximum}" aria-label="Almacenamiento de la cuenta"></progress>
    <p class="muted">Biblioteca y archivos compartidos · 3 GiB para el grupo</p>` :
    `<div class="section-line"><h2>Tu espacio musical</h2></div>
     <p class="muted">Crea playlists, conserva tus proyectos y recupera tu biblioteca en otros dispositivos.</p>
     <button class="g" id="library-account">Ir a mi cuenta</button>`;
  $("#library-account")?.addEventListener("click",()=>navigation.go("pr"));
}

function paintSongs() {
  const shown=entries();
  const root=$("#library-songs");
  if (!root) return;
  $("#track-total").textContent=shown.length===session.tracks.length ? String(shown.length) : shown.length+" de "+session.tracks.length;
  $("#play-results").disabled=!shown.length;
  root.innerHTML = shown.length ? `<div class="song-list ${appearance.libraryView==="grid"?"song-grid":""}">
    ${shown.map((file,index)=>`<article class="song ${session.tracks[session.trackIndex]===file?"on":""}">
      <button class="song-play" data-play="${file.id}" aria-label="Reproducir ${esc(file.name)}"><span aria-hidden="true"></span></button>
      <div class="song-text"><b title="${esc(file.name)}">${esc(file.title||file.name)}</b><span>${[file.artist,file.album].filter(Boolean).map(esc).join(" · ")}${file.artist||file.album?" · ":""}${file.local?"Dispositivo":esc(file.name.split(".").at(-1).toUpperCase())} · ${asMiB(file.size||file.file?.size)}</span></div>
      <div class="song-actions"><button class="g" data-next-track="${file.id}" aria-label="Reproducir ${esc(file.title||file.name)} a continuación">A continuación</button>
       <button class="g" data-edit-tags="${file.id}" aria-label="Editar datos de ${esc(file.title||file.name)}">Datos</button>${!file.local ? `${fileLink(file.id)}<button class="g" data-remove="${file.id}" aria-label="Borrar ${esc(file.name)}">Borrar</button>` :
        session.user ? `<button class="g" data-import="${file.id}">Guardar en mi cuenta</button>` : `<span class="muted">${index+1}</span>`}</div>
    </article>`).join("")}</div>` :
    `<div class="empty-message"><span class="track-icon" aria-hidden="true">♫</span><div><b>${librarySearch?"Sin coincidencias":"Tu biblioteca está vacía"}</b>
      <p class="muted">${librarySearch?"Prueba con otro título o formato.":"Sube una pista para comenzar a escuchar."}</p></div></div>`;
  root.onclick=event=>{
    const button=event.target.closest("button");
    if (!button) return;
    if (button.dataset.play) {
      const index=session.tracks.findIndex(file=>file.id===button.dataset.play);
      if (index===session.trackIndex && !au.paused) return au.pause();
      setPlayOrder(entries().map(file=>file.id));
      return play(index);
    }
    if (button.dataset.nextTrack) return playNext(button.dataset.nextTrack);
    if (button.dataset.editTags) return editTags(session.tracks.find(track=>track.id===button.dataset.editTags));
    if (button.dataset.remove && confirm("¿Borrar esta pista de tu biblioteca?")) {
      task(button,async()=>{
        await api("library/"+button.dataset.remove,{method:"DELETE"});
        await refreshLibrary();
      });
    }
    if (button.dataset.import) task(button,async()=>{
      const track=session.localTracks.find(file=>file.id===button.dataset.import);
      if (!track) return;
      await addLibraryFile(track.file);
      if (session.tracks[session.trackIndex]===track) resetPlayer();
      session.localTracks=session.localTracks.filter(file=>file!==track);
      URL.revokeObjectURL(track.url);
      syncLibrary(); paintSongs(); paintStorage();
    });
  };
  paintPlayer();
}

function editTags(track) {
  if (!track) return;
  const dialog=document.createElement("dialog");
  dialog.className="audio-dialog";
  dialog.innerHTML=`<form><h2>Datos de la pista</h2><p class="muted">${esc(track.name)}</p>
    ${[["title","Título"],["artist","Artista"],["album","Álbum"]].map(([key, label])=>
      `<label class="field">${label}<input name="${key}" maxlength="160" value="${esc(track[key])}"></label>`).join("")}
    <div class="error" role="alert"></div><div class="toolbar">
      <button type="button" class="g" data-read-tags>Leer etiquetas del archivo</button><button class="b">Guardar</button>
      <button type="button" class="g" data-close>Cerrar</button></div></form>`;
  $("#main").append(dialog);
  const form=dialog.querySelector("form");
  dialog.onclose=()=>dialog.remove();
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  dialog.querySelector("[data-read-tags]").onclick=event=>task(event.currentTarget,async()=>{
    const tags=await musicTags(track);
    if (!dialog.isConnected) return;
    if (!Object.values(tags).some(Boolean)) return toast("El archivo no contiene etiquetas ID3 o FLAC legibles.");
    for (const [key,value] of Object.entries(tags)) if (value) form.elements[key].value=value;
  });
  bindForm(form,async fields=>{
    const data=Object.fromEntries(fields);
    if (track.local) Object.assign(track,data);
    else {
      const result=await api("library/"+track.id+"/tags",{method:"PUT",data});
      const saved=session.savedTracks.find(item=>item.id===track.id);
      if (saved) Object.assign(saved,result);
    }
    dialog.close();
    syncLibrary();
    paintSongs();
  });
  dialog.showModal();
}

function paintPending() {
  const root = $("#pending-uploads");
  if (!root) return;
  const rows = session.pendingUploads;
  root.innerHTML = session.user && rows.length && !session.uploadBatch ? `<details class="card"><summary>Cargas pendientes (${rows.length})</summary>
    <p class="muted">Selecciona el mismo archivo para continuar. Las cargas caducan en 24 horas.</p>
    ${rows.map(item=>`<div class="tr"><div class="sp file-name"><b>${esc(item.name)}</b> <span class="muted">${asMiB(item.size)} · ${({library:"Biblioteca",project:"Proyecto",chat:"Chat"}[item.destination]||"Chat")}</span></div>
      <button class="g" data-discard="${item.id}">Cancelar carga</button></div>`).join("")}</details>` : "";
  root.onclick = event => {
    const button = event.target.closest("[data-discard]");
    if (button) task(button,async () => {
      await api("uploads/"+button.dataset.discard,{method:"DELETE"});
      await refreshUploadStatus();
      toast("Carga cancelada");
    });
  };
}

async function refreshUploadStatus() {
  const owner = session.user?.id;
  if (!owner) return;
  const [storage,uploads] = await Promise.all([api("storage"),api("uploads")]);
  if (session.user?.id!==owner) return;
  session.storage = storage;
  session.pendingUploads = uploads;
  paintStorage();
  paintPending();
}

function paintLibraryUpload() {
  const card=$("#upload-status");
  if (!card) return;
  const batch=session.uploadBatch;
  card.hidden=!batch;
  if ($("#pending-uploads")) $("#pending-uploads").hidden=Boolean(batch);
  if (batch) {
    const percent=batch.size ? Math.round(batch.received/batch.size*100) : 0;
    $("#upload-message").textContent=(batch.index+1)+" de "+batch.count+" · "+batch.name+" · "+percent+" %";
    $("#upload-progress").value=percent;
  }
}

async function startLibraryBatch(files) {
  if (session.uploadBatch) return toast("Ya hay una carga en curso.");
  const owner=session.user?.id;
  const controller=new AbortController();
  const batch={controller,count:files.length,index:0,name:"",size:0,received:0};
  session.uploadBatch=batch;
  const errors=[];
  let added=0;
  try {
    for (const [index,file] of files.entries()) {
      if (controller.signal.aborted || session.user?.id!==owner) break;
      Object.assign(batch,{index,name:file.name,size:file.size,received:0});
      paintLibraryUpload();
      try {
        await addLibraryFile(file,(received,size)=>{
          Object.assign(batch,{received,size}); paintLibraryUpload();
        },controller.signal);
        added++;
        if (session.page==="lib") { paintSongs(); paintStorage(); }
      } catch(error) {
        if (!controller.signal.aborted) errors.push(file.name+" · "+error.message);
      }
    }
  } finally {
    if (session.uploadBatch===batch) session.uploadBatch=null;
    paintLibraryUpload();
    if (controller.signal.aborted && session.user?.id===owner) errors.push("Carga pausada. Selecciona los mismos archivos pendientes para continuar.");
    if (session.page==="lib" && $("#library-error")) $("#library-error").textContent=errors.join(" · ");
    if (added) toast(added===1?"Pista añadida":added+" pistas añadidas");
    if (owner && session.user?.id===owner) {
      try { await refreshUploadStatus(); } catch {}
    }
  }
}

function resetPlayer() {
  session.trackIndex = -1;
  au.pause();
  au.removeAttribute("src");
  au.load();
  $("#now").textContent = "Sin pista";
  $("#now").removeAttribute("title");
  $("#player-source").textContent = "Biblioteca";
  $("#seek").value = 0;
  $("#tm").textContent = "0:00";
  $("#duration").textContent = "0:00";
  paintPlayer();
  trackChanged();
}

function syncLibrary() {
  const previous = session.tracks[session.trackIndex];
  session.tracks = session.savedTracks.map(file => ({ ...file, url:media(file.id) })).concat(session.localTracks);
  if (previous) {
    session.trackIndex = session.tracks.findIndex(file => file.id === previous.id);
    if (session.trackIndex < 0 && previous.local) session.trackIndex = session.tracks.findIndex(file => file === previous);
    if (session.trackIndex < 0) resetPlayer();
  }
  window.dispatchEvent(new Event("larp-library-updated"));
}

async function refreshLibrary() {
  const active = session.user;
  if (!active) return;
  const [tracks,lists,storage,uploads] = await Promise.all([api("library"),api("playlists"),api("storage"),api("uploads")]);
  if (session.user?.id !== active.id) return;
  session.savedTracks = tracks;
  session.libraryLoadedOwner=active.id;
  session.playlists = lists;
  session.storage=storage;
  session.pendingUploads=uploads;
  syncLibrary();
  restoreLibraryPlayback();
  djHooks.refresh();
  if (session.page === "lib") viewLibrary();
  const postTracks = $("#publish-tracks");
  if (postTracks) postTracks.innerHTML = picker([...postTracks.querySelectorAll("input:checked")].map(input => input.value));
}

function addDeviceFile(file, tags={}) {
  const row = {...tags,id:crypto.randomUUID(),name:file.name,local:true,file,url:URL.createObjectURL(file),size:file.size,created:Date.now()};
  session.localTracks.push(row);
  syncLibrary();
  return row;
}

async function addLibraryFile(file, progress, signal) {
  const active = session.user;
  const tags=await musicTags({file}).catch(()=>({}));
  if (signal?.aborted) throw new DOMException("Carga cancelada","AbortError");
  if (!active) return addDeviceFile(file,tags);
  if (session.user?.id !== active.id) throw new Error("La cuenta cambió durante la carga.");
  const row = await uploadTrack(file,"library",progress,signal);
  if (session.user?.id === active.id) {
    if (Object.values(tags).some(Boolean)) {
      try { Object.assign(row,await api("library/"+row.id+"/tags",{method:"PUT",data:tags,signal})); }
      catch { if (!signal?.aborted) toast("El audio se guardó. Puedes editar sus etiquetas en Datos."); }
    }
    if (session.user?.id !== active.id) return row;
    if (!session.savedTracks.some(file=>file.id===row.id)) {
      session.savedTracks.push(row);
      if (session.storage) session.storage.used+=row.size;
    }
    syncLibrary();
  }
  return row;
}

export { addDeviceFile, addLibraryFile, refreshLibrary, resetPlayer, syncLibrary, viewLibrary };
