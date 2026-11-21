import { esc } from "../common.js";
import { configData, DECKS, PRESETS, settings } from "./data.js";

const GROUPS=[
  ["Reproducción",[
    ["loadLock","Load Lock"],["playMode","Play Mode",[["single","Single"],["continue","Continuo"]]],
    ["autoCue","Auto Cue"],["cueLevel","Auto Cue Level",[["memory","Memory"],["signal","Detección por señal"]]],
    ["cueFloor","Umbral de detección",[[-60,"−60 dB"],[-78,"−78 dB"]]],
    ["quantize","Quantize"],["quantizeBeat","Valor de Quantize",[[1,"1 pulso"],[.5,"½ pulso"],[.25,"¼ de pulso"]]],
    ["jump","Beat Jump",[1,2,4,8,16,32,64].map(value=>[value,value+" pulsos"])],
    ["hotLoad","Cargar Hot Cues al abrir"],["hotColor","Colores de Hot Cues"],["ejectLock","Expulsar fuente solo en pausa"]
  ]],
  ["Pantalla",[
    ["wave","Forma de onda",[["3band","3Band"],["rgb","RGB"],["blue","Azul"]]],
    ["division","Divisiones",[["phrase","Frases"],["time","Tiempo"]]],
    ["phase","Medidor de fase",[["blocks","Tipo 2 · bloques"],["bars","Tipo 1 · barra"]]],
    ["time","Tiempo",[["remain","Restante"],["elapsed","Transcurrido"]]],
    ["brightness","Brillo",[1,2,3,4,5].map(value=>[value,"Nivel "+value])],
    ["ring","Aro rojo con canal al aire"],["sourceColor","Color de fuente","color"],
    ["language","Idioma de indicadores",[["es","Español"],["en","English"]]]
  ]],
  ["Jog y tempo",[
    ["jog","Jog Mode",[["vinyl","Vinyl"],["cdj","CDJ"]]],["touch","Frenado al tocar",[0,1.5,.01]],
    ["release","Arranque al soltar",[0,1.5,.01]],["jogAdjust","Sensibilidad del jog",[1,10,1]],
    ["tempoRange","Rango de tempo",[6,10,16,100].map(value=>[value,value===100?"WIDE · −75 / +100 %":"±"+value+" %"])],
    ["masterTempo","Master Tempo"],["slip","Slip Mode"]
  ]]
];

function field([name,label,options],value){
  if(options==="color")return `<label class="field">${label}<input name="${name}" type="color" value="${value}"></label>`;
  if(!options)return `<label class="toggle"><input type="checkbox" name="${name}" ${value?"checked":""}> ${label}</label>`;
  if(typeof options[0]==="number"){
    const [min,max,step]=options;
    return `<label class="field">${label}<input name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
  }
  return `<label class="field">${label}<select name="${name}">${options.map(([key,text])=>
    `<option value="${esc(key)}" ${key===value?"selected":""}>${esc(text)}</option>`).join("")}</select></label>`;
}

export function ddjSettingsBody(value,profiles,scope){
  const apply=[["both","Todos los decks"],...DECKS.map(id=>[id,"Solo deck "+id])];
  return `<header class="section-line"><div><h2>My Settings</h2><p class="muted">Ajustes de Larp DDJ y perfiles portátiles en JSON.</p></div>
    <button class="g" type="button" data-close-ddj>Cerrar</button></header>
    <form id="ddj-settings-form">
      <div class="ddj-settings-short"><label class="field">Aplicar a<select name="scope">${apply.map(([key,label])=>
        `<option value="${key}" ${key===scope?"selected":""}>${label}</option>`).join("")}</select></label>
        <label class="field">Preset<select name="preset"><option value="">Seleccionar</option>
        ${Object.keys(PRESETS).map(key=>`<option value="preset:${esc(key)}">${esc(key)}</option>`).join("")}
        ${profiles.map((item,i)=>`<option value="profile:${i}">${esc(item.name)}</option>`).join("")}</select></label>
        <label class="field">Guardar perfil<input name="profileName" maxlength="36" placeholder="Nombre del perfil"></label></div>
      <div class="ddj-settings-grid">${GROUPS.map(([title,fields])=>`<fieldset><legend>${title}</legend>
        ${fields.map(item=>field(item,value[item[0]])).join("")}</fieldset>`).join("")}</div>
      <p class="muted">Frenado y arranque se expresan en segundos. La sensibilidad del jog controla su respuesta en pantalla. Puedes llevar el JSON en un USB e importarlo en Larp DDJ.</p>
      <div class="error" role="alert"></div>
      <div class="toolbar"><button class="b" type="submit">Aplicar y guardar</button>
       <button class="g" type="button" data-export-settings>Exportar JSON</button>
       <label class="g ddj-file-action">Importar JSON<input class="sr-only" data-import-settings type="file" accept=".json,application/json"></label></div>
    </form>`;
}

export function collectDDJSettings(form){
  const raw={};
  for(const field of form.elements){
    if(!field.name||!Object.hasOwn(PRESETS.Cabina,field.name))continue;
    const initial=PRESETS.Cabina[field.name];
    raw[field.name]=typeof initial==="boolean" ? field.checked : typeof initial==="number" ? Number(field.value) : field.value;
  }
  return settings(raw);
}

export async function readSettingsFile(file){
  if(file.size>128000)throw new Error("El archivo de ajustes es demasiado grande.");
  let value;
  try{value=JSON.parse(await file.text());}catch{throw new Error("El archivo JSON de My Settings es inválido.");}
  if(value?.format!=="larp-ddj"||value.version!==1||!value.settings)throw new Error("Selecciona un archivo My Settings exportado por Larp DDJ.");
  return configData(value.settings);
}
