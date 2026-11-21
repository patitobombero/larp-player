import { api, bindForm, fileLink, img, media, picture, task, when } from "./client.js";
import { au } from "./audio.js";
import { $, esc, toast } from "./common.js";
import { picker } from "./playlists.js";
import { memberButton } from "./social-panels.js";
import { IMAGES, session } from "./state.js";

function viewCommunity() {
  const draft = session.communityDraft;
  session.communityDraft = null;
  let cover = draft?.cover || "";
  $("#main").innerHTML = `<header class="page-heading"><div><h1>Comunidad</h1><p>Escucha lo que está creando tu grupo y comparte tus propias pistas.</p></div></header>
    <details class="card" id="publish-panel" ${draft ? "open" : ""}><summary>Publicar audio o una playlist</summary>
      <form id="publish-form" style="margin-top:12px">
        <label class="field">Título<input name="title" maxlength="80" value="${esc(draft?.title)}" required></label>
        <label class="field">Descripción<textarea name="body" rows="3" maxlength="1000"></textarea></label>
        <div id="publish-cover">${cover ? img(cover,"cover-preview","Portada de publicación",true) : ""}</div>
        <label class="field">Portada opcional<input id="publish-image" type="file" accept="${IMAGES}"></label>
        <fieldset><legend>Pistas (hasta 20)</legend><div id="publish-tracks">${picker(draft?.tracks || [])}</div></fieldset>
        <div class="error" role="alert"></div><div><button class="b" type="submit">Publicar</button></div>
      </form>
    </details>
    <div class="card actions"><input id="community-search" class="sp" aria-label="Buscar publicaciones" placeholder="Buscar por título" maxlength="80">
      <select id="community-sort" aria-label="Ordenar publicaciones">
        <option value="new">Más recientes</option><option value="old">Más antiguas</option>
        <option value="popular">Mejor calificadas</option><option value="name">Título A–Z</option>
      </select></div>
    <div id="feed"></div><button class="g" id="more-posts" hidden>Ver más publicaciones</button>`;
  const view = session.viewVersion;
  const feed = $("#feed");
  const search = $("#community-search");
  const sort = $("#community-sort");
  search.value=session.communityFilter||"";
  session.communityFilter="";
  const form = $("#publish-form");
  const more = $("#more-posts");
  let page = 0;
  let sequence = 0;
  let searchTimer;
  $("#publish-image").onchange = event => task(event.currentTarget,async () => {
    cover = await picture(event.currentTarget.files[0],1024);
    if (view === session.viewVersion) $("#publish-cover").innerHTML = cover ? img(cover,"cover-preview") : "";
  });
  bindForm(form,async fields => {
    const data = { title:fields.get("title"), body:fields.get("body"), cover, tracks:fields.getAll("track") };
    await api("community",{ method:"POST",data });
    toast("Publicado en la comunidad");
    if (view === session.viewVersion) viewCommunity();
  });

  async function load(reset = true) {
    const ticket = ++sequence;
    const next = reset ? 0 : page + 1;
    const params = new URLSearchParams({ q:search.value.trim(), sort:sort.value, page:next });
    more.disabled = true;
    if (reset) feed.textContent = "Cargando publicaciones…";
    try {
      const result = await api("community?" + params);
      if (view !== session.viewVersion || ticket !== sequence) return;
      if (reset) feed.innerHTML = "";
      if (!result.posts.length && !next) feed.innerHTML = '<p class="muted">No hay publicaciones para mostrar.</p>';
      result.posts.forEach(post => appendPost(feed,post,() => load()));
      more.hidden = !result.hasMore;
      page = next;
    } catch (error) {
      if (view === session.viewVersion && ticket === sequence) {
        if (reset) feed.textContent = error.message;
        else toast(error.message);
      }
    } finally {
      if (ticket === sequence) more.disabled = false;
    }
  }
  search.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (view === session.viewVersion) load(); },250);
  };
  sort.onchange = () => load();
  more.onclick = () => load(false);
  load();
}

function appendPost(feed, post, reload) {
  const path = "community/" + post.id;
  const article = document.createElement("article");
  article.className = "card";
  article.innerHTML = `
    ${post.cover ? `<figure class="post-cover">${img(post.cover,"cover","Portada de " + post.title,true)}</figure>` : ""}
    <div class="row">${memberButton({id:post.owner,name:post.author})}<div class="sp"><h3>${esc(post.title)}</h3>
      <p class="muted">${esc(post.author)} · ${esc(when(post.created))}</p></div>
      ${post.owner === session.user.id ? '<button class="g" data-delete-post>Borrar publicación</button>' : ""}</div>
    ${post.body ? `<p class="comment">${esc(post.body)}</p>` : ""}
    <div class="actions"><div class="rating" role="group" aria-label="Calificación de 1 a 5">
      ${[1,2,3,4,5].map(stars => `<button class="g" data-stars="${stars}" aria-label="${stars} de 5">☆</button>`).join("")}</div>
      <span class="muted" data-score></span><button class="g" data-clear-rating>Quitar mi voto</button>
    </div>
    <div class="post-listen">
      ${post.tracks.length>1?`<label class="field">Pista<select data-listening>${post.tracks.map(file=>
        `<option value="${file.id}">${esc(file.name)}</option>`).join("")}</select></label>`:""}
      <audio controls preload="none" aria-label="Audio de la publicación" src="${esc(media(post.tracks[0].id))}"></audio>
      <div class="toolbar"><span data-download-post>${fileLink(post.tracks[0].id)}</span>
        <button class="g" type="button" data-comment-now>Comentar este momento</button></div>
    </div>
    <details data-comments><summary>Comentarios (${post.comment_count})</summary>
      <button class="g" data-older-comments hidden>Ver comentarios anteriores</button>
      <div data-comment-list></div>
      <form class="post-comment-form"><div class="toolbar" data-attached-time hidden><span></span><button class="g" data-clear-time type="button">Quitar momento</button></div>
        <div class="row"><input class="sp" name="body" maxlength="1000" aria-label="Comentario" placeholder="Escribe un comentario…" required>
        <button class="b" type="submit">Comentar</button></div><div class="error" role="alert"></div></form>
    </details>`;
  feed.append(article);
  const score = article.querySelector("[data-score]");
  const clear = article.querySelector("[data-clear-rating]");
  const stars = [...article.querySelectorAll("[data-stars]")];
  const remove = article.querySelector("[data-delete-post]");
  const voteButtons = [...stars, clear];
  let votePending = false;
  function paintRating() {
    score.textContent = post.votes ? Number(post.average).toFixed(1) + " de 5 · " + post.votes + (post.votes === 1 ? " voto" : " votos") : "Sin calificaciones";
    clear.hidden = !post.my_rating;
    stars.forEach(button => {
      const value = Number(button.dataset.stars);
      button.textContent = value <= (post.my_rating || 0) ? "★" : "☆";
      button.setAttribute("aria-pressed",String(value === post.my_rating));
    });
  }
  async function rate(value) {
    if (votePending) return;
    votePending = true;
    voteButtons.forEach(button => { button.disabled = true; });
    try {
      Object.assign(post,await api(path + "/rating",{ method:"PUT",data:{ stars:value } }),{ my_rating:value });
      paintRating();
    } catch (error) {
      toast(error.message);
    } finally {
      votePending = false;
      voteButtons.forEach(button => { button.disabled = false; });
    }
  }
  stars.forEach(button => { button.onclick = () => rate(Number(button.dataset.stars)); });
  clear.onclick = () => rate(0);
  paintRating();
  if (remove) remove.onclick = () => {
    if (!confirm("¿Borrar esta publicación y sus comentarios y calificaciones?")) return;
    task(remove,async () => {
      await api(path,{ method:"DELETE" });
      if (article.isConnected) await reload();
    });
  };
  mountComments(article,post,path,mountPostAudio(article,post));
}

function timestamp(seconds) {
  return Math.floor(seconds/60)+":"+String(Math.floor(seconds%60)).padStart(2,"0");
}

function mountPostAudio(article,post) {
  const audio=article.querySelector("audio");
  const tracks=new Set(post.tracks.map(item=>item.id));
  const picker=article.querySelector("[data-listening]");
  let current=post.tracks[0].id;
  function choose(id) {
    if(!tracks.has(id)||current===id)return;
    audio.pause();
    current=id;
    audio.src=media(id);
    article.querySelector("[data-download-post]").innerHTML=fileLink(id);
    if(picker)picker.value=id;
  }
  if(picker)picker.onchange=()=>choose(picker.value);
  audio.onplay=()=>{
    au.pause();
    for(const other of $("#feed")?.querySelectorAll("audio")||[])if(other!==audio) other.pause();
  };
  return {
    point:()=>({file:current,seconds:audio.currentTime}),
    seek:async(id,seconds)=>{
      if(!tracks.has(id))return;
      choose(id);
      audio.currentTime=audio.readyState ? Math.min(seconds,audio.duration||seconds) : seconds;
      await audio.play();
    }
  };
}

function mountComments(article, post, path, playback) {
  const details = article.querySelector("[data-comments]");
  const list = details.querySelector("[data-comment-list]");
  const older = details.querySelector("[data-older-comments]");
  const form = details.querySelector("form");
  const summary = details.querySelector("summary");
  let position=null;
  const attached=form.querySelector("[data-attached-time]");
  const titleFor=id=>post.tracks.find(track=>track.id===id)?.name||"Pista";
  article.querySelector("[data-comment-now]").onclick=()=>{
    position=playback.point();
    attached.querySelector("span").textContent=titleFor(position.file)+" · "+timestamp(position.seconds);
    attached.hidden=false;
    details.open=true;
    form.elements.body.focus();
  };
  form.querySelector("[data-clear-time]").onclick=()=>{
    position=null;
    attached.hidden=true;
  };
  let first = 0;
  let sequence = 0;
  async function load(before = 0) {
    const ticket = ++sequence;
    const comments = await api(path + "/comments" + (before ? "?before=" + before : ""));
    if (ticket !== sequence || !article.isConnected) return;
    first = comments[0]?.id || first;
    older.hidden = comments.length < 30;
    if (!before) list.innerHTML = "";
    list.insertAdjacentHTML("afterbegin",comments.map(row =>
      `<div class="comment"><b>${esc(row.name)}</b> <span class="muted">${esc(when(row.created))}</span><div>${esc(row.body)}</div>
        ${row.file!=null ? `<button class="g comment-time" type="button" data-jump-file="${esc(row.file)}" data-jump-time="${Number(row.seconds)}"
        aria-label="Escuchar ${esc(titleFor(row.file))} desde ${timestamp(row.seconds)}">▶ ${timestamp(row.seconds)} · ${esc(titleFor(row.file))}</button>` : ""}
        ${row.author === session.user.id ? `<button class="g" data-delete-comment="${row.id}">Borrar comentario</button>` : ""}</div>`).join(""));
  }
  details.ontoggle = () => { if (details.open) task(null,() => load()); };
  older.onclick = () => task(older,() => load(first));
  list.onclick = event => {
    const jump=event.target.closest("[data-jump-file]");
    if(jump) return task(jump,()=>playback.seek(jump.dataset.jumpFile,Number(jump.dataset.jumpTime)));
    const button = event.target.closest("[data-delete-comment]");
    if (!button || !confirm("¿Borrar tu comentario?")) return;
    task(button,async () => {
      await api(path + "/comments/" + button.dataset.deleteComment,{ method:"DELETE" });
      post.comment_count = Math.max(0,post.comment_count - 1);
      summary.textContent = "Comentarios (" + post.comment_count + ")";
      await load();
    });
  };
  bindForm(form,async fields => {
    await api(path + "/comments",{ method:"POST",data:{ body:fields.get("body"),position } });
    form.reset();
    position=null;
    attached.hidden=true;
    summary.textContent = "Comentarios (" + ++post.comment_count + ")";
    await load();
  });
}

export { viewCommunity };
