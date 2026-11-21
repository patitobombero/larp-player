import { viewAuth, viewProfile } from "./js/account.js";
import { appearance, appearanceSettings, applyAppearance, loadAccountPreferences } from "./js/appearances.js";
import { applyAudio } from "./js/audio.js";
import { api, task } from "./js/client.js";
import { $, toast } from "./js/common.js";
import { viewCommunity } from "./js/community.js";
import { vEq } from "./js/eq.js";
import { viewFriends } from "./js/friends.js";
import { refreshLibrary, viewLibrary } from "./js/library.js";
import { NAV_ICONS, TABS, navigation, session, studioHooks } from "./js/state.js";
import { vSyn } from "./js/studio.js";
import { updateNoticeIdentity } from "./js/social-panels.js";
import { StudioWorkbench } from "./js/workbench/ui.js";

const legacyStudio = {...studioHooks};
studioHooks.isRecording=()=>legacyStudio.isRecording()||StudioWorkbench.isRecording();
studioHooks.stop=()=>{legacyStudio.stop();StudioWorkbench.stop();};
studioHooks.setTempo=StudioWorkbench.setTempo;
studioHooks.addClip=StudioWorkbench.addClip;
let releaseStudio=()=>{};
window.addEventListener("larp-view-closing",()=>{releaseStudio();releaseStudio=()=>{};});

function openStudio() {
  StudioWorkbench.render();
  releaseStudio=StudioWorkbench.leave;
}

let ddjModule;
let ddjView;
function openDDJ() {
  if(ddjView) return ddjView();
  const view=session.viewVersion;
  $("#main").innerHTML='<section class="page"><h1>Larp DDJ</h1><p class="muted" role="status">Cargando los decks…</p></section>';
  ddjModule ||= import("./js/ddj/index.js");
  ddjModule.then(({showDDJ})=>{
    ddjView=showDDJ;
    if(session.page==="ddj"&&session.viewVersion===view)showDDJ();
  }).catch(error=>{
    ddjModule=null;
    if(session.page==="ddj"&&session.viewVersion===view) {
      $("#main").innerHTML='<section class="page"><h1>Larp DDJ</h1><p class="error" role="alert">No se pudieron cargar los decks.</p></section>';
      toast(error.message);
    }
  });
}

const views = { lib:viewLibrary, syn:openStudio, "syn-legacy":vSyn, ddj:openDDJ, eq:vEq, pl:viewCommunity, fr:viewFriends, pr:viewProfile };
function go(key) {
  session.page = key;
  render();
  $("#main").scrollTop=0;
}

function render() {
  window.dispatchEvent(new Event("larp-view-closing"));
  session.viewVersion++;
  document.body.dataset.page = session.page;
  document.title = (TABS.find(([key])=>key===(session.page==="syn-legacy"?"syn":session.page))?.[1] || "Biblioteca") + " · Larp Player";
  const label = $("#quick-profile .profile-copy b");
  label.textContent=session.user?.name||"Mi cuenta";
  updateNoticeIdentity();
  session.closeChat();
  session.closeChat = () => {};
  $("#nav").querySelectorAll("button").forEach(button => {
    const selected = button.dataset.k === (session.page==="syn-legacy"?"syn":session.page);
    button.classList.toggle("on",selected);
    if (selected) button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  if (!session.user && ["pr","pl","fr"].includes(session.page)) return viewAuth();
  views[session.page]();
}


navigation.go = go;

$("#nav").insertAdjacentHTML("beforeend",TABS.map(([key,name]) =>
  `<button data-k="${key}" title="${name}"><span class="nav-icon" aria-hidden="true">${NAV_ICONS[key]}</span><span class="nav-caption">${name}</span></button>`).join(""));
$("#brand").onclick=()=>go("lib");
$("#quick-profile").onclick=()=>go("pr");
$("#nav").addEventListener("click",event => {
  const button = event.target.closest("[data-k]");
  if (button) go(button.dataset.k);
});

async function start() {
  applyAppearance(appearanceSettings());
  if (session.inviteToken) session.page = "pr";
  render();
  const [sessionResult,invitation] = await Promise.allSettled([
    api("session"), session.inviteToken ? api("invite/" + encodeURIComponent(session.inviteToken)) : Promise.resolve(null)
  ]);
  session.loadingSession = false;
  if (sessionResult.status === "fulfilled") session.user = sessionResult.value.profile;
  else toast(sessionResult.reason.message);
  if (session.user) {
    await loadAccountPreferences(session.user);
    if (session.page==="lib" && !session.inviteToken) session.page=appearance.home;
  }
  if (invitation.status === "fulfilled" && invitation.value) {
    session.invite = invitation.value;
    session.authMode = "register";
    session.page = session.user ? "fr" : "pr";
  } else if (session.inviteToken) {
    session.inviteMessage = invitation.reason?.message || "Invitación no válida.";
    if (session.user) toast(session.inviteMessage);
  }
  applyAudio();
  render();
  if (session.user) task(null,refreshLibrary);
}

start();
