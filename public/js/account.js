import { appearance, appearancePanel, appearanceSettings, applyAppearance, loadAccountPreferences, mountAppearance } from "./appearances.js";
import { applyAudioPreference, resetPlaybackIdentity, savePlayback, setPlayOrder } from "./audio.js";
import { api, avatar, bindForm, picture, task } from "./client.js";
import { $, esc, toast } from "./common.js";
import { refreshLibrary, resetPlayer, syncLibrary } from "./library.js";
import { IMAGES, TASTES, djHooks, navigation, session } from "./state.js";
import { mountMemberSettings } from "./social-panels.js";
import { persistStudioDraft, resetStudio } from "./studio.js";

function clearInvite() {
  session.inviteToken = "";
  session.invite = null;
  session.inviteMessage = "";
  const url = new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState(null,"",url);
}

function viewAuth() {
  if (session.loadingSession) {
    $("#main").innerHTML = '<div class="card">Cargando tu cuenta…</div>';
    return;
  }
  const registering = session.authMode === "register";
  const recovering = session.authMode === "recover";
  $("#main").innerHTML = `<h2>${registering ? "Crear cuenta" : recovering ? "Recuperar cuenta" : "Iniciar sesión"}</h2>
    <div class="card form-card">
      ${session.invite ? `<p><b>${esc(session.invite.name)}</b> te invitó a Larp Player.</p>` : ""}
      ${session.inviteMessage ? `<p class="error">${esc(session.inviteMessage)}</p>` : ""}
      <form id="auth">
        ${registering ? '<label class="field">Nombre de perfil<input name="name" autocomplete="nickname" required maxlength="40"></label>' : ""}
        <label class="field">Usuario<input name="handle" autocomplete="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" autocapitalize="none" spellcheck="false" placeholder="p. ej. dj_larp"></label>
        ${recovering ? '<label class="field">Código de recuperación<input name="code" autocomplete="off" required maxlength="64" spellcheck="false"></label>' : ""}
        <label class="field">${recovering?"Contraseña nueva":"Contraseña"}<input type="password" name="password" autocomplete="${registering||recovering ? "new-password" : "current-password"}" required minlength="10" maxlength="128"></label>
        ${registering && !session.invite ? '<label class="field">Código de invitación inicial<input name="code" required maxlength="128"></label>' : ""}
        <div class="error" role="alert"></div>
        <div class="actions">
          <button class="b" type="submit">${registering ? "Crear cuenta" : recovering ? "Recuperar" : "Entrar"}</button>
          <button class="g" type="button" id="switch-auth">${registering||recovering ? "Volver a iniciar sesión" : "Crear cuenta"}</button>
          ${!registering&&!recovering?'<button class="g" type="button" id="recover-auth">Recuperar cuenta</button>':""}
        </div>
      </form>
    </div>`;
  $("#switch-auth").onclick = () => {
    session.authMode = registering||recovering ? "login" : "register";
    viewAuth();
  };
  if ($("#recover-auth")) $("#recover-auth").onclick=()=>{session.authMode="recover"; viewAuth();};
  bindForm($("#auth"), async fields => {
    const data = Object.fromEntries(fields);
    if (registering && session.invite) data.code = session.inviteToken;
    const result = await api(registering ? "register" : recovering ? "recover" : "login", { method:"POST", data });
    await persistStudioDraft();
    resetStudio();
    session.user = result.profile;
    session.authMode="login";
    if (recovering) toast("Cuenta recuperada. Genera otro código en tu perfil.");
    await loadAccountPreferences(session.user);
    if (registering && session.invite) {
      clearInvite();
      navigation.go("fr");
    } else {
      navigation.go(session.invite ? "fr" : appearance.home);
    }
    await refreshLibrary();
  });
}

function viewProfile() {
  let currentAvatar = session.user.avatar;
  let avatarPending = Promise.resolve();
  const profileId = session.user.id;
  $("#main").innerHTML = `<section class="page account-page"><header class="page-heading"><div><h1>Mi perfil</h1>
    <p>Tu identidad y tu espacio de trabajo, guardados en tu cuenta.</p></div></header>
    <div class="profile-grid"><form class="card form-card" id="profile"><h2>Perfil público del grupo</h2>
      <div class="actions"><span id="avatar-preview">${avatar(session.user,"avatar-preview")}</span>
        <label class="field">Foto de perfil<input id="avatar-input" type="file" accept="${IMAGES}"></label>
        <button class="g" id="remove-avatar" type="button">Quitar foto</button>
      </div>
      <label class="field">Nombre visible<input name="name" required maxlength="40" value="${esc(session.user.name)}"></label>
      <p class="muted">Usuario para iniciar sesión <b>@${esc(session.user.handle)}</b></p>
      <label class="field">Biografía<textarea name="bio" rows="3" maxlength="280">${esc(session.user.bio)}</textarea></label>
      <fieldset><legend>Gustos musicales</legend><div class="actions">${TASTES.map(taste =>
        `<label class="tag"><input type="checkbox" name="taste" value="${esc(taste)}" ${session.user.tastes.includes(taste) ? "checked" : ""}> ${esc(taste)}</label>`).join("")}</div></fieldset>
      <div class="error" role="alert"></div>
      <div><button class="b" type="submit">Guardar perfil</button></div>
    </form>
    ${appearancePanel()}</div>
    <details class="card form-card"><summary>Tarjeta del perfil</summary><div id="member-settings">Cargando…</div></details>
    <details class="card form-card"><summary>Cambiar contraseña</summary>
      <form id="password">
        <label class="field">Contraseña actual<input name="current" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label>
        <label class="field">Contraseña nueva<input name="replacement" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
        <div class="error" role="alert"></div>
        <div><button class="b" type="submit">Cambiar contraseña</button></div>
      </form>
    </details>
    <details class="card form-card"><summary>Recuperación de cuenta</summary>
      <p class="muted">Guarda el código fuera de Larp. Solo se muestra al generarlo, se usa una vez y cada código nuevo sustituye al anterior.</p>
      <form id="recovery-code"><label class="field">Contraseña actual<input type="password" name="current" autocomplete="current-password" required minlength="10" maxlength="128"></label>
        <div class="error" role="alert"></div><button class="g" type="submit">Generar código</button></form>
      <output id="recovery-result" aria-live="polite"></output>
    </details>
    <button class="g" id="logout">Cerrar sesión</button></section>`;
  mountAppearance();
  const member=$("#member-settings");
  function loadMember(){
    if(!member.parentElement.open)return;
    member.parentElement.removeEventListener("toggle",loadMember);
    mountMemberSettings(member);
  }
  member.parentElement.addEventListener("toggle",loadMember);
  const preview = $("#avatar-preview");
  $("#avatar-input").onchange = event => {
    const file = event.currentTarget.files[0];
    if (file) {
      const input = event.currentTarget;
      avatarPending = task(input,async () => {
        const photo = await picture(file,720);
        if (!preview.isConnected || !input.files.length) return;
        currentAvatar = photo;
        preview.innerHTML = avatar({...session.user, avatar:currentAvatar},"avatar-preview");
      });
    }
  };
  $("#remove-avatar").onclick = () => {
    currentAvatar = "";
    $("#avatar-input").value = "";
    preview.innerHTML = avatar({...session.user, avatar:""},"avatar-preview");
  };
  bindForm($("#profile"), async fields => {
    await avatarPending;
    const data = { ...Object.fromEntries(fields), tastes:fields.getAll("taste"), avatar:currentAvatar,theme:session.user.theme };
    const result = await api("profile",{ method:"PUT",data });
    if (session.user?.id !== profileId) return;
    session.user = result.profile;
    $("#quick-profile .profile-copy b").textContent=session.user.name;
    toast("Perfil guardado");
  });
  const passwordForm = $("#password");
  bindForm(passwordForm,async fields => {
    await api("password",{ method:"PUT",data:Object.fromEntries(fields) });
    passwordForm.reset();
    toast("Contraseña actualizada");
  });
  const recovery=$("#recovery-code");
  bindForm(recovery,async fields=>{
    const {code}=await api("recovery-code",{method:"POST",data:Object.fromEntries(fields)});
    if (recovery.isConnected) {
      recovery.reset();
      $("#recovery-result").textContent=code;
    }
  });
  $("#logout").onclick = event => task(event.currentTarget, async () => {
    savePlayback(true);
    await persistStudioDraft();
    await api("logout",{ method:"POST" });
    resetPlaybackIdentity();
    if (session.uploadBatch) session.uploadBatch.controller.abort();
    session.user = null;
    session.savedTracks = [];
    session.libraryLoadedOwner="";
    session.playlists = [];
    session.storage=null;
    session.pendingUploads=[];
    session.activeFriend = "";
    session.ddjPreferences=null;
    djHooks.reset();
    resetStudio();
    resetPlayer();
    setPlayOrder(null);
    syncLibrary();
    applyAppearance(appearanceSettings());
    applyAudioPreference();
    navigation.go("pr");
  });
}

export { clearInvite, viewAuth, viewProfile };
