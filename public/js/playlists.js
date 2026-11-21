import { play, setPlayOrder } from "./audio.js";
import { api, bindForm, img, picture, task } from "./client.js";
import { $, esc, toast } from "./common.js";
import { refreshLibrary } from "./library.js";
import { IMAGES, navigation, session } from "./state.js";

function picker(selected, name = "track") {
  return session.savedTracks.length ? `<div class="check-list">${session.savedTracks.map(file =>
    `<label><input type="checkbox" name="${name}" value="${file.id}" ${selected.includes(file.id) ? "checked" : ""}> <span class="file-name">${esc(file.name)}</span></label>`).join("")}</div>` :
    '<p class="muted">Primero sube audio a tu biblioteca.</p>';
}

function editPlaylist(list) {
  let cover = list?.cover || "";
  let order=(list?.tracks||[]).filter(id=>session.savedTracks.some(track=>track.id===id));
  const detail = $("#list-detail");
  detail.innerHTML = `<form class="card library-card">
    <label class="field">Nombre de la playlist<input name="name" value="${esc(list?.name)}" required maxlength="60"></label>
    <div id="list-cover">${cover ? img(cover,"cover-preview","Portada de la playlist",true) : ""}</div>
    <label class="field">Portada<input id="list-image" type="file" accept="${IMAGES}"></label>
    <fieldset><legend>Pistas de la playlist</legend>${picker(order)}</fieldset>
    <fieldset><legend>Orden de reproducción</legend><ol data-playlist-order></ol></fieldset>
    ${list ? `<div class="actions">${list.tracks.filter(id => session.savedTracks.some(file => file.id === id)).map(id =>
      `<button type="button" class="g" data-list-play="${id}">▶ ${esc(session.savedTracks.find(file => file.id === id).name)}</button>`).join("")}</div>` : ""}
    <div class="error" role="alert"></div>
    <div class="actions"><button class="b" type="submit">Guardar playlist</button>
      ${list ? '<button class="g" type="button" id="play-list">▶ Reproducir playlist</button><button class="g" type="button" id="delete-list">Borrar playlist</button><button class="g" type="button" id="publish-list">Publicar en comunidad</button>' : ""}
      <button class="g" type="button" id="close-list">Cerrar</button>
    </div></form>`;
  const ordered=detail.querySelector("[data-playlist-order]");
  const form=detail.querySelector("form");
  function paintOrder(focus) {
    ordered.innerHTML=order.map((id,index)=>{
      const track=session.savedTracks.find(file=>file.id===id);
      const name=esc(track.title||track.name);
      return `<li><span>${name}</span><button type="button" class="g" data-move="-1" data-track="${id}" aria-label="Subir ${name}" ${index===0?"disabled":""}>↑</button>
        <button type="button" class="g" data-move="1" data-track="${id}" aria-label="Bajar ${name}" ${index===order.length-1?"disabled":""}>↓</button></li>`;
    }).join("");
    if (focus) (ordered.querySelector(`[data-track="${focus.track}"][data-move="${focus.move}"]:enabled`)||
      ordered.querySelector(`[data-track="${focus.track}"]:enabled`))?.focus();
  }
  form.addEventListener("change", event=>{
    const input=event.target;
    if (input.name!=="track") return;
    order=input.checked ? [...order,input.value] : order.filter(id=>id!==input.value);
    paintOrder();
  });
  ordered.onclick=event=>{
    const button=event.target.closest("[data-move]");
    if(!button) return;
    const index=order.indexOf(button.dataset.track);
    const next=index+Number(button.dataset.move);
    if(index<0 || next<0 || next>=order.length)return;
    [order[index],order[next]]=[order[next],order[index]];
    paintOrder(button.dataset);
  };
  paintOrder();
  const preview = $("#list-cover");
  $("#list-image").onchange = event => task(event.currentTarget,async () => {
    cover = await picture(event.currentTarget.files[0],1024);
    preview.innerHTML = cover ? img(cover,"cover-preview") : "";
  });
  $("#close-list").onclick = () => { detail.innerHTML = ""; };
  detail.querySelectorAll("[data-list-play]").forEach(b => {
    b.onclick = () => {
      setPlayOrder(order);
      play(session.tracks.findIndex(file => file.id === b.dataset.listPlay));
    };
  });
  if (list) {
    $("#play-list").onclick=()=>{
      setPlayOrder(order);
      const first=order.find(id=>session.tracks.some(item=>item.id===id));
      if (first) play(session.tracks.findIndex(file=>file.id===first));
    };
    $("#delete-list").onclick = event => {
      if (!confirm("¿Borrar esta playlist?")) return;
      task(event.currentTarget, async () => {
        await api("playlists/" + list.id,{ method:"DELETE" });
        await refreshLibrary();
      });
    };
    $("#publish-list").onclick = () => {
      session.communityDraft = { title:list.name, tracks:list.tracks, cover:list.cover };
      navigation.go("pl");
    };
  }
  bindForm(detail.querySelector("form"),async fields => {
    const data = { name:fields.get("name"), tracks:order, cover };
    await api("playlists" + (list ? "/" + list.id : ""),{ method:list ? "PUT" : "POST",data });
    await refreshLibrary();
    toast("Playlist guardada");
  });
}

export { editPlaylist, picker };
