import { clearInvite } from "./account.js";
import { api, avatar, bindForm, fileLink, img, media, player, task, when } from "./client.js";
import { $, esc, toast } from "./common.js";
import { AUDIO_EXT, IMAGES, STICKERS, navigation, session } from "./state.js";
import { memberButton } from "./social-panels.js";
import { asMiB, uploadTrack } from "./uploads.js";

async function validateSticker(file) {
  if(file.size>2*1024*1024)throw new Error("El sticker supera 2 MiB.");
  if(!/\.(mp4|webm)$/iu.test(file.name))return;
  const preview=document.createElement("video"),url=URL.createObjectURL(file);
  preview.preload="metadata";
  try {
    const duration=await new Promise((resolve,reject)=>{
      preview.onloadedmetadata=()=>resolve(preview.duration);
      preview.onerror=()=>reject(new Error("El navegador no pudo abrir el sticker de vídeo."));
      preview.src=url;
    });
    if(!Number.isFinite(duration)||duration>8)throw new Error("El sticker de vídeo debe durar hasta 8 segundos.");
  } finally { URL.revokeObjectURL(url); }
}

function viewFriends() {
  $("#main").innerHTML = `<header class="page-heading"><div><h1>Amigos</h1><p>Comparte música y mantén tus conversaciones en privado.</p></div></header>
    ${session.invite ? `<div class="card"><div class="actions"><span class="sp">${esc(session.invite.name)} quiere conectar contigo.</span>
      <button class="b" id="accept-invite">Aceptar invitación</button><button class="g" id="ignore-invite">Omitir</button></div></div>` : ""}
    <div class="card"><div class="actions"><b class="sp">Invita a un amigo a Larp Player</b><button class="b" id="make-invite">Crear enlace</button></div>
      <p class="muted">Cada enlace sirve para una persona y caduca en 7 días.</p><div class="invite-box" id="invite-link"></div></div>
    <div class="friends-layout"><div class="card" id="friends-list">Cargando amigos…</div><div id="conversation"></div></div>`;
  const list = $("#friends-list");
  $("#make-invite").onclick = event => task(event.currentTarget, async () => {
    const result = await api("invite",{ method:"POST" });
    const url = new URL(location.origin + "/");
    url.searchParams.set("invite",result.token);
    const link = $("#invite-link");
    if (!link) return;
    link.innerHTML = `<label class="field">Enlace de invitación<input readonly value="${esc(url.href)}"></label>
      <button class="g" type="button" style="margin-top:8px">Copiar enlace</button>`;
    const input = link.querySelector("input");
    link.querySelector("button").onclick = async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        toast("Enlace copiado");
      } catch {
        input.focus();
        input.select();
      }
    };
  });
  if ($("#accept-invite")) {
    $("#accept-invite").onclick = event => task(event.currentTarget,async () => {
      const result = await api("invite/" + session.inviteToken,{ method:"PUT" });
      clearInvite();
      toast("Ahora puedes chatear con " + result.name);
      if (session.page === "fr") navigation.go("fr");
    });
    $("#ignore-invite").onclick = () => { clearInvite(); navigation.go("fr"); };
  }
  refreshFriends();
  async function refreshFriends() {
   try {
    const friends = await api("friends");
    if (!list.isConnected) return;
    list.innerHTML = `<h3>Mis amigos</h3>${friends.map(friend =>
      `<div class="friend-entry" data-friend-entry="${friend.id}">${memberButton(friend)}
        <button type="button" class="g friend-button" data-chat="${friend.id}" aria-pressed="${friend.id===session.activeFriend}">
          <span class="sp"><b>${esc(friend.name)}</b><span class="muted"> @${esc(friend.handle)}</span></span>
          <span data-unread="${friend.id}" class="chat-badge" ${friend.unread?"":"hidden"}>${friend.unread} sin leer</span>
        </button></div>`).join("") ||
        '<p class="muted">Cuando alguien acepte tu enlace aparecerá aquí.</p>'}`;
    list.querySelectorAll("[data-chat]").forEach(button => {
      const friend = friends.find(row => row.id === button.dataset.chat);
      button.onclick = () => openChat(friend);
    });
    const active = friends.find(friend => friend.id === session.activeFriend);
    if (active) openChat(active);
    window.addEventListener("larp-view-closing",()=>clearInterval(badges),{once:true});
    const badges=setInterval(async()=>{
      if(!list.isConnected||document.visibilityState!=="visible")return;
      try {
        const updated=await api("friends");
        if(!list.isConnected)return;
        if(updated.length!==list.querySelectorAll("[data-chat]").length ||
          updated.some(friend=>!list.querySelector(`[data-chat="${friend.id}"]`))) return navigation.go("fr");
        const entries=[...list.querySelectorAll("[data-friend-entry]")];
        const ordered=updated.map(friend=>entries.find(row=>row.dataset.friendEntry===friend.id));
        if(ordered.some((row,i)=>row!==entries[i]))list.append(...ordered);
        for(const friend of updated)paintUnread(friend.id,friend.unread);
      } catch {}
    },7000);
   } catch (error) { if(list.isConnected)list.textContent=error.message; }
  }
}

function paintUnread(id, count) {
  const badge=document.querySelector(`[data-unread="${id}"]`);
  if(badge) {
    badge.hidden=!count;
    badge.textContent=count+" sin leer";
  }
}

function openChat(friend) {
  session.closeChat();
  session.activeFriend = friend.id;
  for(const button of document.querySelectorAll("[data-chat]"))button.setAttribute("aria-pressed",String(button.dataset.chat===friend.id));
  const account = session.user.id;
  const endpoint = "friends/" + friend.id;
  const root = $("#conversation");
  root.innerHTML = `<section class="card"><div class="section-line"><div class="row">${memberButton(friend)}<h3>Chat con ${esc(friend.name)}</h3></div>
    <button type="button" class="g" id="remove-friend">Eliminar amigo</button></div>
    <details class="chat-shared"><summary>Audios compartidos</summary><div id="shared-audio"></div><button class="g" id="more-shared" hidden>Ver audios anteriores</button></details>
    <button class="g" id="chat-older" hidden>Ver mensajes anteriores</button>
    <div class="chat-scroll" id="chat-log" role="log" aria-label="Conversación"></div><div id="chat-status" class="muted"></div>
    <form class="row chat-compose" id="send-message">
      <input class="sp" name="body" aria-label="Mensaje" placeholder="Escribe un mensaje…" maxlength="2000" required>
      <button class="b" type="submit">Enviar</button><div class="error" role="alert"></div>
    </form>
    <div class="actions" style="margin-top:10px">
      <label class="g chat-attach" title="Adjuntar audio">↥ Audio<input aria-label="Adjuntar audio" id="chat-audio" type="file" accept="${AUDIO_EXT}"></label>
      <label class="g chat-attach" title="Adjuntar sticker">⌑ Sticker<input aria-label="Adjuntar sticker" id="chat-image" type="file" accept="${IMAGES},video/mp4,video/webm,.mp4,.webm"></label>
    </div>
    <details style="margin-top:10px"><summary>Stickers</summary><div class="actions">${STICKERS.map(s =>
      `<button class="g sticker" data-sticker="${s}" aria-label="Enviar sticker ${s}">${s}</button>`).join("")}</div></details>
    <p class="muted">Hasta 200 MiB por audio y 2 MiB por sticker. Los stickers de vídeo duran hasta 8 segundos.</p></section>`;
  const log = $("#chat-log");
  const status = $("#chat-status");
  const older = $("#chat-older");
  const controller = new AbortController();
  let alive = true;
  let newest = 0;
  let oldest = 0;
  let pending = null;
  let newestRead=0;
  const tick = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 5000);
  const resumePoll = () => { if (document.visibilityState === "visible") poll(); };
  document.addEventListener("visibilitychange",resumePoll);
  session.closeChat = () => {
    alive = false;
    clearInterval(tick);
    controller.abort();
    document.removeEventListener("visibilitychange",resumePoll);
  };

  $("#remove-friend").onclick=event=>{
    if(!confirm("¿Eliminar a "+friend.name+" de tus amigos? El chat dejará de estar disponible para ambos. Podrás volver a conectar con una invitación."))return;
    task(event.currentTarget,async()=>{
      await api(endpoint,{method:"DELETE"});
      if(!alive)return;
      session.activeFriend="";
      navigation.go("fr");
      toast("Amigo eliminado");
    });
  };
  const shared=$("#shared-audio");
  const moreShared=$("#more-shared");
  let sharedBefore=0;
  let sharedLoaded=false;
  async function loadShared(older=false) {
    const rows=await api(endpoint+"/audio"+(older?"?before="+sharedBefore:""),{signal:controller.signal});
    if(!alive)return;
    sharedLoaded=true;
    if(!older)shared.replaceChildren();
    if(!rows.length&&!older)shared.textContent="Aún no hay audios compartidos.";
    shared.insertAdjacentHTML("beforeend",rows.map(row=>
      `<div class="shared-file"><b>${esc(row.name)}</b><span class="muted">${asMiB(row.size)} · ${esc(when(row.created))}</span>
      ${player(row.file)} ${fileLink(row.file)}</div>`).join(""));
    sharedBefore=rows.at(-1)?.id||0;
    moreShared.hidden=rows.length<30;
  }
  shared.parentElement.ontoggle=()=>{if(shared.parentElement.open&&!sharedLoaded)task(moreShared,()=>loadShared());};
  moreShared.onclick=()=>task(moreShared,()=>loadShared(true));
  async function markRead() {
    if(!alive||document.visibilityState!=="visible"||!newest||newest<=newestRead||
      log.scrollHeight-log.scrollTop-log.clientHeight>90) return;
    const last=newest;
    newestRead=last;
    try {
      await api(endpoint+"/read",{method:"PUT",data:{last},signal:controller.signal});
      if(alive)paintUnread(friend.id,0);
    } catch {if (newestRead===last) newestRead=0;}
  }
  log.addEventListener("scroll",markRead);

  function markup(message) {
    return `<div class="msg ${message.sender === account ? "me" : ""}">
      ${message.body ? `<div class="comment">${esc(message.body)}</div>` : ""}
      ${message.sticker ? `<span class="sticker">${esc(message.sticker)}</span>` : ""}
      ${message.file ? `<div class="message-file">${message.mime?.startsWith("image/") ?
        img(media(message.file),"sticker-image","Sticker de " + friend.name) :
        message.mime?.startsWith("video/") ? `<video class="sticker-video" src="${esc(media(message.file))}" controls playsinline loop muted preload="metadata"></video>` :
        `<div>${esc(message.name)}</div>${player(message.file)}`}${fileLink(message.file)}</div>` : ""}
      <time class="muted" style="color:inherit;font-size:.8rem">${esc(when(message.created))}</time></div>`;
  }

  function poll() {
    if (pending || !alive) return pending;
    pending = (async () => {
      try {
        const initial = !newest;
        const messages = await api(endpoint + (newest ? "?after=" + newest : ""),{ signal:controller.signal });
        if (!alive) return;
        if (messages.length) {
          const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
          if (!oldest) oldest = messages[0].id;
          newest = messages.at(-1).id;
          if (initial) older.hidden = messages.length < 50;
          log.insertAdjacentHTML("beforeend",messages.map(markup).join(""));
          if (initial || nearBottom) log.scrollTop = log.scrollHeight;
          if (messages.some(message=>message.file&&message.mime?.startsWith("audio/"))) {
            sharedLoaded=false;
            if (shared.parentElement.open) await loadShared();
          }
        }
        await markRead();
        status.textContent = newest ? "" : "Todavía no hay mensajes.";
      } catch (error) {
        if (alive && error.status===404) {session.activeFriend="";navigation.go("fr");}
        else if (alive) status.textContent = error.message;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  older.onclick = () => task(older,async () => {
    const messages = await api(endpoint + "?before=" + oldest,{ signal:controller.signal });
    if (!alive) return;
    const height = log.scrollHeight;
    log.insertAdjacentHTML("afterbegin",messages.map(markup).join(""));
    if (messages.length) oldest = messages[0].id;
    older.hidden = messages.length < 50;
    log.scrollTop += log.scrollHeight - height;
  });

  async function sent() {
    if (pending) await pending;
    await poll();
    if (alive) log.scrollTop = log.scrollHeight;
  }

  const form = $("#send-message");
  bindForm(form,async fields => {
    await api(endpoint,{ method:"POST", data:{ body:fields.get("body") } });
    form.reset();
    await sent();
  });
  for (const [selector, kind] of [["#chat-audio","audio"],["#chat-image","sticker"]]) {
    $(selector).onchange = event => {
      const input = event.currentTarget;
      const file = input.files[0];
      if (!file) return;
      task(input,async () => {
        if (kind==="audio") {
          await uploadTrack(file,friend.id,(loaded,total)=> {
            if (alive) status.textContent = "Subiendo " + file.name + " · " + Math.round(loaded/total*100) + " %";
          });
          if (session.user?.id===account) session.storage=await api("storage").catch(()=>session.storage);
        } else {
          await validateSticker(file);
          await api(endpoint + "/sticker",{ method:"POST", file });
        }
        input.value = "";
        await sent();
      });
    };
  }
  root.querySelectorAll("[data-sticker]").forEach(button => {
    button.onclick = () => task(button,async () => {
      await api(endpoint,{ method:"POST",data:{ sticker:button.dataset.sticker } });
      await sent();
    });
  });
  poll();
}

export { viewFriends };
