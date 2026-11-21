import { applyAudioPreference } from "./audio.js";
import { api, bindForm } from "./client.js";
import { $, esc, limit, toast } from "./common.js";
import { TABS, djHooks, navigation, session } from "./state.js";

const PALETTES = {
  violeta:{label:"Amatista", accent:"#b4a2ff", signal:"#8cdbbf"},
  estudio:{label:"Estudio", accent:"#edc879", signal:"#a8d4ff"},
  ocean:{label:"Océano", accent:"#8ed7f4", signal:"#8ff0c0"},
  coral:{label:"Coral", accent:"#ffac9f", signal:"#f5d27f"},
  mono:{label:"Monocromo", accent:"#d2d9e3", signal:"#afc5ba"},
  custom:{label:"Personalizada", accent:"#b4a2ff", signal:"#8cdbbf"}
};
const FITTINGS = TABS.map(([key])=>key);
let appearance = appearanceSettings();


function appearanceSettings(input = {}) {
  input = input && typeof input==="object" ? input : {};
  const allowed = (key,options,initial)=>options.includes(input[key]) ? input[key] : initial;
  const color = (key,fallback)=>typeof input[key]==="string" && /^#[a-f\d]{6}$/iu.test(input[key]) ? input[key] : fallback;
  return {
    palette:allowed("palette",Object.keys(PALETTES),"violeta"),
    theme:allowed("theme",["dark","light","system"],"dark"),
    navigation:allowed("navigation",["left","right","top","compact"],"left"),
    player:allowed("player",["bottom","top"],"bottom"),
    density:allowed("density",["comfortable","compact","wide"],"comfortable"),
    edges:allowed("edges",["soft","square","round"],"soft"),
    typeface:allowed("typeface",["studio","system","mono","serif"],"studio"),
    titleface:allowed("titleface",["default","studio","system","mono","serif"],"default"),
    vinyl:allowed("vinyl",["normal","large","small","off"],"normal"),
    background:color("background","#13141d"),
    surface:color("surface","#1c1e2b"),
    customSurfaces:allowed("customSurfaces",["yes","no"],"no"),
    libraryView:allowed("libraryView",["list","grid"],"list"),
    home:allowed("home",FITTINGS,"lib"),
    motion:allowed("motion",["system","reduced","full"],"system"),
    scale:limit(input.scale,90,120,100),
    accent:color("accent",PALETTES.violeta.accent),
    signal:color("signal",PALETTES.violeta.signal)
  };
}

function applyAppearance(input) {
  appearance=appearanceSettings(input);
  const root=document.documentElement;
  for (const key of ["palette","theme","navigation","player","density","edges","typeface","titleface","vinyl","motion","libraryView"]) {
    root.dataset[key]=appearance[key];
  }
  const colors=appearance.palette==="custom" ? appearance : PALETTES[appearance.palette];
  for (const [name,hex] of [["--punch",colors.accent],["--signal",colors.signal]]) {
    root.style.setProperty(name,hex);
  }
  root.style.removeProperty("--bg");
  root.style.removeProperty("--sf");
  root.style.removeProperty("--tx");
  root.style.removeProperty("--mu");
  if (appearance.customSurfaces==="yes") {
    const light=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
      .reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
    const bg=light(appearance.background),surface=light(appearance.surface);
    // Keep primary and secondary text readable on both customized surfaces.
    const dark=bg<.179;
    const safeSurface=(surface<.179)===dark?appearance.surface:appearance.background;
    root.style.setProperty("--bg",appearance.background);
    root.style.setProperty("--sf",safeSurface);
    root.style.setProperty("--tx",dark?"#ffffff":"#10101a");
    root.style.setProperty("--mu",dark?"#f3f2ff":"#191929");
  }
  const channels=[1,3,5].map(i=>parseInt(colors.accent.slice(i,i+2),16)/255)
    .map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
  const luma=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  root.style.setProperty("--on-accent",luma>.179 ? "#10111a" : "#ffffff");
  root.style.setProperty("--ui-size",appearance.scale+"%");
}

async function loadAccountPreferences(profile) {
  if (!profile) return;
  applyAppearance({...appearanceSettings(),theme:profile.theme||"dark"});
  try {
    const prefs=await api("preferences");
    if (profile.id!==session.user?.id) return;
    applyAppearance({...prefs.appearance,theme:prefs.appearance?.theme||profile.theme});
    applyAudioPreference(prefs.audio);
    session.ddjPreferences=prefs.ddj||null;
    djHooks.preferences(session.ddjPreferences);
  } catch (error) {
    if (profile.id===session.user?.id) toast("No se pudieron cargar tus preferencias. " + error.message);
  }
}

function uiSelect(id,label,options) {
  return `<label class="field">${esc(label)}<select name="${id}">${options.map(([value,name])=>
      `<option value="${value}" ${appearance[id]===value?"selected":""}>${esc(name)}</option>`).join("")}</select></label>`;
}

function appearancePanel() {
  return `<section class="card appearance-panel" id="appearance-panel">
    <div class="section-line"><div><h2>Apariencia</h2><p class="muted">Cambia la distribución, el color y la densidad. Verás los cambios al momento.</p></div>
      <button class="g" type="button" id="reset-ui">Restaurar ajustes</button></div>
    <form id="appearance-form">
      <fieldset class="palette-field"><legend>Paleta</legend><div class="palette-picks">
        ${Object.entries(PALETTES).map(([id,palette])=>`<label class="palette-pick" style="--sample1:${palette.accent};--sample2:${palette.signal}">
          <input name="palette" type="radio" value="${id}" ${appearance.palette===id?"checked":""}><i></i>${palette.label}</label>`).join("")}
      </div></fieldset>
      <div class="custom-colors" ${appearance.palette==="custom"?"":"hidden"}><label>Color de acento <input name="accent" type="color" value="${appearance.accent}"></label>
        <label>Color de señal <input name="signal" type="color" value="${appearance.signal}"></label></div>
      <div class="custom-options">
        ${uiSelect("theme","Modo", [["dark","Oscuro"],["light","Claro"],["system","Del dispositivo"]])}
        ${uiSelect("navigation","Navegación", [["left","Izquierda"],["right","Derecha"],["top","Superior"],["compact","Barra compacta"]])}
        ${uiSelect("player","Reproductor", [["bottom","Abajo"],["top","Arriba"]])}
        ${uiSelect("density","Densidad", [["comfortable","Normal"],["compact","Compacta"],["wide","Amplia"]])}
        ${uiSelect("edges","Bordes", [["soft","Suaves"],["square","Rectos"],["round","Redondeados"]])}
        ${uiSelect("typeface","Tipografía", [["studio","Estudio"],["system","Sistema"],["mono","Mono"],["serif","Serif"]])}
        ${uiSelect("titleface","Tipografía de títulos", [["default","Del tema"],["studio","Estudio"],["system","Sistema"],["mono","Mono"],["serif","Serif"]])}
        ${uiSelect("vinyl","Disco del reproductor", [["normal","Normal"],["large","Grande"],["small","Pequeño"],["off","Oculto"]])}
        ${uiSelect("customSurfaces","Fondos personalizados", [["no","Según el tema"],["yes","Usar mis colores"]])}
        <label class="field">Fondo <input name="background" type="color" value="${appearance.background}"></label>
        <label class="field">Tarjetas <input name="surface" type="color" value="${appearance.surface}"></label>
        ${uiSelect("libraryView","Biblioteca", [["list","Lista"],["grid","Cuadrícula"]])}
        ${uiSelect("home","Pantalla al entrar", TABS)}
        ${uiSelect("motion","Movimiento", [["system","Del dispositivo"],["reduced","Reducido"],["full","Activado"]])}
        <label class="field">Tamaño de texto <span class="row"><input type="range" name="scale" min="90" max="120" step="5" value="${appearance.scale}"><output id="ui-scale">${appearance.scale}%</output></span></label>
      </div>
      <div class="appearance-preview">
        <div><b>Larp Player</b><span data-ui-swatch>Muestra de texto y señal</span></div>
        <span id="appearance-status" class="muted" role="status"></span>
      </div>
      <div class="error" role="alert"></div><div class="toolbar"><button class="b" type="submit">Guardar apariencia</button>
      <button class="g" id="undo-preview" type="button" disabled>Descartar vista previa</button></div>
    </form>
  </section>`;
}

function mountAppearance(saved={...appearance},draft=false) {
  const panel=$("#appearance-panel");
  const form=$("#appearance-form");
  const collect=()=>{
    const fields=Object.fromEntries(new FormData(form));
    return appearanceSettings({...fields,scale:Number(fields.scale)});
  };
  let committed=saved;
  const ownerId=session.user.id;
  function status() {
    const changed=JSON.stringify(collect())!==JSON.stringify(committed);
    $("#appearance-status").textContent=changed?"Vista previa sin guardar":"Apariencia guardada";
    $("#undo-preview").disabled=!changed;
  }
  const preview=()=>{
    applyAppearance(collect());
    $(".custom-colors").hidden=appearance.palette!=="custom";
    $("#ui-scale").textContent=appearance.scale+"%";
    status();
  };
  form.oninput=preview;
  form.onchange=preview;
  function leave() {
    if (session.user?.id===ownerId) applyAppearance(committed);
  }
  window.addEventListener("larp-view-closing",leave,{once:true});
  function replace(settings){
    window.removeEventListener("larp-view-closing",leave);
    applyAppearance(settings);
    panel.outerHTML=appearancePanel();
    mountAppearance(committed,true);
  }
  $("#reset-ui").onclick=()=>replace(appearanceSettings());
  $("#undo-preview").onclick=()=>replace(committed);
  if (draft) preview(); else status();
  bindForm(form,async()=>{
    const prefs=collect();
    const owner=session.user.id;
    await api("preferences/appearance",{method:"PUT",data:prefs});
    if (session.user?.id===owner) {
      committed=prefs;
      if (form.isConnected) preview();
      else applyAppearance(prefs);
      toast("Apariencia guardada en tu cuenta");
    }
  });
}

function zoomImage(target) {
  const dialog=$("#image-zoom");
  const preview=dialog.querySelector("img");
  preview.src=target.currentSrc||target.src;
  preview.alt=target.alt;
  dialog.querySelector("figcaption").textContent=target.alt;
  dialog.showModal();
}

document.addEventListener("click",event=>{
  if (event.target.matches("img[data-zoom]")) zoomImage(event.target);
});
document.addEventListener("keydown",event=>{
  if (event.target.matches?.("img[data-zoom]") && ["Enter"," "].includes(event.key)) {
    event.preventDefault();
    zoomImage(event.target);
  }
  if (event.altKey && !event.ctrlKey && /^\d$/u.test(event.key)) {
    const tab=TABS[Number(event.key)-1];
    if (tab) {
      event.preventDefault();
      navigation.go(tab[0]);
    }
  }
});
$("#image-zoom").onclick=event=>{
  if (event.target===event.currentTarget) event.currentTarget.close();
};

export { appearance, appearancePanel, appearanceSettings, applyAppearance, loadAccountPreferences, mountAppearance };
