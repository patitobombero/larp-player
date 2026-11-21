import { api, avatar, bindForm, fileLink, task, when } from "./client.js";
import { $, esc, toast } from "./common.js";
import { navigation, session } from "./state.js";

const networks={instagram:"Instagram",soundcloud:"SoundCloud",spotify:"Spotify",linkedin:"LinkedIn"};
const actions={message:"Mensaje",comment:"Comentario",rating:"Calificación",post:"Publicación"};
const notifications=$("#notice-panel");
const badge=$("#notice-count");
let requestId=0;
let noticeRequest=0;
let activity=null;

function memberButton(profile) {
  return '<button type="button" class="g member-avatar" data-member="'+esc(profile.id)+'" aria-label="Ver perfil de '+esc(profile.name)+'">'+avatar(profile)+'</button>';
}

function openPost(post) {
  session.communityFilter=post;
  navigation.go("pl");
}

async function openMember(id) {
  const dialog=$("#member-panel"),content=dialog.querySelector("[data-member-content]");
  const owner=session.user?.id;
  if(!owner)return;
  content.textContent="Cargando perfil…";
  if(!dialog.open)dialog.showModal();
  const ticket=++requestId;
  try {
    const {profile,settings,posts,playlists}=await api("member-profile/"+encodeURIComponent(id));
    if(ticket!==requestId||session.user?.id!==owner||!dialog.open)return;
    const selectedPosts=id===owner?posts.filter(post=>settings.posts.includes(post.id)):posts;
    const selectedLists=id===owner?playlists.filter(list=>settings.playlists.includes(list.id)):playlists;
    content.innerHTML='<div class="member-intro">'+avatar(profile)+'<div><h3>'+esc(profile.name)+'</h3><p class="muted">@'+esc(profile.handle)+'</p></div></div>'+
      (settings.country||settings.gender?'<p>'+[settings.country,settings.gender].filter(Boolean).map(esc).join(" · ")+'</p>':'')+
      (profile.bio?'<p class="comment">'+esc(profile.bio)+'</p>':'')+
      (profile.tastes.length?'<p class="muted">'+profile.tastes.map(esc).join(" · ")+'</p>':'')+
      '<div class="actions">'+Object.entries(settings.links).map(([key,url])=>'<a class="button-link" target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">'+esc(networks[key])+'</a>').join("")+'</div>'+
      (selectedPosts.length?'<h4>Publicaciones</h4><ul>'+selectedPosts.map(post=>'<li><button type="button" class="g" data-member-post="'+esc(post.title)+'">'+esc(post.title)+'</button></li>').join("")+'</ul>':'')+
      (selectedLists.length?'<h4>Playlists</h4><ul>'+selectedLists.map(list=>'<li>'+esc(list.name)+' · '+list.tracks+' pistas</li>').join("")+'</ul>':'');
    for(const button of content.querySelectorAll("[data-member-post]"))button.onclick=()=>{dialog.close();openPost(button.dataset.memberPost);};
  } catch(error) {
    if(ticket===requestId&&dialog.open)content.textContent=error.message;
  }
}

async function mountMemberSettings(container) {
  const owner=session.user.id;
  try {
    const {settings,posts,playlists}=await api("member-profile/"+owner);
    if(!container.isConnected||session.user?.id!==owner)return;
    const checkboxes=(items,key,property,label)=>items.length ?
      '<fieldset><legend>'+label+'</legend><div class="member-toggles">'+items.map(item=>
        '<label class="tag"><input type="checkbox" name="'+key+'" value="'+esc(item.id)+'" '+(settings[key].includes(item.id)?"checked":"")+'> '+esc(item[property])+'</label>'
      ).join("")+'</div></fieldset>':'';
    container.innerHTML='<form class="form-card"><div class="custom-options"><label class="field">País <input name="country" maxlength="48" value="'+esc(settings.country)+'"></label>'+
      '<label class="field">Género <input name="gender" maxlength="48" value="'+esc(settings.gender)+'"></label>'+
      Object.entries(networks).map(([key,label])=>'<label class="field">'+label+' <input type="url" name="'+key+'" maxlength="250" value="'+esc(settings.links[key])+'"></label>').join("")+
      '</div>'+checkboxes(posts,"posts","title","Publicaciones que aparecen en tu perfil")+checkboxes(playlists,"playlists","name","Playlists que aparecen en tu perfil")+
      '<div class="error" role="alert"></div><div class="actions"><button class="b" type="submit">Guardar tarjeta de perfil</button>'+
      '<button class="g" type="button" data-preview-profile>Ver mi tarjeta</button></div></form>';
    container.querySelector("[data-preview-profile]").onclick=()=>openMember(owner);
    bindForm(container.querySelector("form"),async fields=>{
      const links=Object.fromEntries(Object.keys(networks).map(key=>[key,fields.get(key)]));
      await api("preferences/profile-card",{method:"PUT",data:{
        country:fields.get("country"),gender:fields.get("gender"),links,posts:fields.getAll("posts"),playlists:fields.getAll("playlists")
      }});
      if(session.user?.id===owner)toast("Tarjeta de perfil guardada.");
    });
  } catch(error) {
    if(container.isConnected)container.textContent=error.message;
  }
}

function paintNotices() {
  if(!activity)return;
  const unread=activity.rows.filter(row=>row.created>activity.seen).length;
  badge.textContent=String(unread);
  badge.hidden=activity.muted||!unread;
  const muted=$("#notice-mute");
  muted.textContent=activity.muted?"Activar avisos":"Silenciar avisos";
  muted.setAttribute("aria-pressed",String(activity.muted));
  $("#notice-read").disabled=!unread;
  const filter=$("#notice-filter").value;
  const items=activity.rows.filter(row=>filter==="all"||row.kind===filter);
  $("#notice-items").innerHTML=items.map(row=>'<li class="'+(row.created>activity.seen?"notice-new":"")+'"><div><b>'+
    esc(actions[row.kind])+' de '+esc(row.author)+'</b><p>'+esc(row.title)+'</p><time class="muted">'+esc(when(row.created))+'</time></div>'+
    '<div class="actions">'+(row.kind==="message"?'<button class="g" type="button" data-notice-chat="'+esc(row.peer)+'">Abrir chat</button>':
      '<button class="g" type="button" data-notice-post="'+esc(row.title)+'">Ver publicación</button>')+
    (row.file?fileLink(row.file):'')+'</div></li>').join("")||'<li class="muted">Aún no hay avisos de este tipo.</li>';
}

async function refreshNotices() {
  const ticket=++noticeRequest;
  const user=session.user?.id;
  $("#notice-button").hidden=!user;
  if(!user){activity=null;badge.hidden=true;if(notifications.open)notifications.close();return;}
  const data=await api("notices");
  if(session.user?.id===user&&ticket===noticeRequest){activity=data;paintNotices();}
}

$("#notice-button").onclick=()=>{
  if(!notifications.open)notifications.showModal();
  task(null,refreshNotices);
};
$("#notice-filter").onchange=paintNotices;
async function updateActivity(control,values) {
  await task(control,async()=>{
    const user=session.user?.id;
    if(!activity||!user)return;
    const saved=await api("preferences/notices",{method:"PUT",data:{seen:activity.seen,muted:activity.muted,...values}});
    if(session.user?.id!==user||!activity)return;
    noticeRequest++;
    Object.assign(activity,saved);
    paintNotices();
  });
}
$("#notice-read").onclick=event=>updateActivity(event.currentTarget,{seen:activity?.now});
$("#notice-mute").onclick=event=>updateActivity(event.currentTarget,{muted:!activity?.muted});
notifications.onclick=event=>{
  const chat=event.target.closest("[data-notice-chat]"),post=event.target.closest("[data-notice-post]");
  if(chat){notifications.close();session.activeFriend=chat.dataset.noticeChat;navigation.go("fr");}
  if(post){notifications.close();openPost(post.dataset.noticePost);}
};
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-member]");
  if(button)openMember(button.dataset.member);
});
let noticeIdentity=null;
function updateNoticeIdentity() {
  const identity=session.user?.id||"";
  if(identity===noticeIdentity)return;
  noticeIdentity=identity;
  refreshNotices().catch(()=>{});
}
setInterval(()=>{if(session.user&&document.visibilityState==="visible")refreshNotices().catch(()=>{});},15000);

export { memberButton, mountMemberSettings, updateNoticeIdentity };
