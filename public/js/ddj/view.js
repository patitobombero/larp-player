import { esc } from "../common.js";
import { barPhase, CUE_COLORS, DECKS, LOOP_BEATS } from "./data.js";
import { harmonyAt, matchHarmony, soundingKey } from "./harmony.js";

const knob=(key,label,min,max,step,id="",unit="")=>`<label class="ddj-knob"><span>${label}</span><i aria-hidden="true"></i>
  <input type="range" min="${min}" max="${max}" step="${step}" data-mix="${key}" data-knob data-unit="${unit}"
    aria-label="${label}${id?" "+id:""}"><output></output></label>`;

const spaceControls=()=>`<section class="ddj-space" aria-label="Espacio estéreo">
  <h3 tabindex="-1">Espacio estéreo</h3>
  <div class="ddj-space-pick" role="group" aria-label="Canal para espacio estéreo">
    ${DECKS.map(id=>`<button type="button" class="g" data-space-deck="${id}" aria-label="Espacio estéreo canal ${id}" aria-pressed="${id==="A"}">${id}</button>`).join("")}
  </div>
  ${DECKS.map(id=>`<div class="ddj-space-panel" data-channel="${id}" data-space-panel ${id==="A"?"":"hidden"}>
    <label class="field">Convolución <select data-mix="spaceMode" aria-label="Modo de convolución ${id}">
      <option value="off">Apagada</option><option value="auto">Automática</option><option value="manual">Manual</option>
    </select></label>
    <div class="ddj-space-knobs">
      ${knob("pan","Paneo",-1,1,.01,id)}${knob("spaceWidth","Anchura",0,150,1,id," %")}
      ${knob("spaceWet","Sala",0,40,1,id," %")}${knob("spaceTone","Tono de sala",900,10500,100,id," Hz")}
      ${knob("spaceFocus","Graves al centro",0,100,1,id," %")}
    </div><output class="ddj-space-status" data-space-status></output>
  </div>`).join("")}</section>`;

export function mixerControls(){
  const channel=id=>`<fieldset data-channel="${id}"><legend>Canal ${id}</legend>
    <div class="ddj-channel-eq">${[["trim","Trim",-18,12,.1],["high","Agudos",-24,9,.1],["mid","Medios",-24,9,.1],["low","Graves",-24,9,.1],["filter","Filtro",-1,1,.01]].map(([key,label,min,max,step])=>
      knob(key,label,min,max,step,id,key==="filter"?"":" dB")).join("")}</div>
    <div class="ddj-fader"><meter min="0" max="1" low=".38" high=".76" optimum=".18" value="0" aria-label="Nivel canal ${id}"></meter>
    <label>Fader<input type="range" min="0" max="1" step=".01" data-mix="level" aria-label="Fader ${id}"></label></div>
    <button class="g" data-ddj-action="prelisten" data-target="${id}" aria-pressed="false" title="Activar preescucha del canal">PFL</button>
    <label class="ddj-toggle"><input type="checkbox" role="switch" data-mix="mute" aria-label="Silenciar canal ${id}">Silencio</label>
    <details><summary>FX</summary><div class="ddj-channel-fx">
      ${knob("wet","FX",0,.65,.01,id)}
    </div><div class="ddj-fx-switches" role="group" aria-label="Efecto canal ${id}">
      ${[["off","Off"],["echo","Eco"],["reverb","Reverb"]].map(([key,label])=>
       `<button type="button" class="g" data-ddj-action="channel-fx" data-fx="${key}" data-target="${id}" aria-pressed="${key==="off"}">${label}</button>`).join("")}
    </div></details></fieldset>`;
  return `<section class="card ddj-mixer"><h2 tabindex="-1">Mezclador</h2><div class="ddj-channels">${DECKS.map(channel).join("")}</div>
    ${spaceControls()}
    <label class="ddj-cross">Crossfader <span><b>A/C</b><input type="range" min="-1" max="1" step=".01" data-mix="cross" aria-label="Crossfader"><b>B/D</b></span></label>
    <label class="field">Curva<select data-mix="curve"><option value="power">Potencia constante</option><option value="linear">Lineal</option><option value="cut">Corte</option></select></label>
    <div class="ddj-master-meter"><div class="section-line"><b>Máster</b><output data-ddj-master-level>−∞ dBFS</output></div>
      <meter min="0" max="1" low=".4" high=".85" optimum=".2" value="0" data-ddj-master-meter aria-label="Nivel del máster"></meter></div>
    <label class="ddj-toggle"><input type="checkbox" role="switch" data-mix="normalize">Nivelar a −18 LUFS</label>
    <div class="ddj-master-knob">${knob("master","Ganancia máster",0,1,.01)}</div>
    <details class="ddj-monitor"><summary>Auriculares / PFL</summary><label class="field">Salida de preescucha
      <select data-pfl-output><option value="">Salida principal</option></select></label>
      <button class="g" type="button" data-pfl-choose>Elegir dispositivo</button><p class="muted" data-pfl-status></p></details>
    <button class="g" data-ddj-action="tempo-to-studio">Enviar BPM al Estudio</button>
  </section>`;
}

const btn=(action,label,title=label,extras="")=>`<button class="g" data-ddj-action="${action}" aria-label="${esc(title)}" ${extras}>${label}</button>`;

export function deckControls(id){
  return `<section class="card ddj-deck ddj-deck-${id.toLowerCase()}" data-deck="${id}">
    <div class="ddj-deck-head"><div class="ddj-deck-id">${id}</div>
      <div class="ddj-track-label"><h2 data-track-name>Sin pista</h2><span data-track-meta>Carga una pista desde la fuente</span></div>
      ${btn("eject","Expulsar","Expulsar pista del deck "+id)}
    </div>
    <div class="ddj-screen">
      <div class="ddj-readout"><div><small data-clock-label>Restante</small><strong data-deck-clock>−0:00.0</strong></div>
        <div><small>BPM</small><strong data-deck-bpm>—</strong></div>
        <div><small>Tempo</small><strong data-deck-rate>+0.00%</strong></div></div>
      <div data-deck-phase class="ddj-phase" aria-label="Fase del compás"></div>
      <div class="ddj-wave" data-wave-box>
        <canvas width="860" height="160" aria-label="Forma de onda de la pista ${id}"></canvas>
        <div data-wave-label>Sin forma de onda</div><i data-wave-playhead></i><div data-wave-marks></div>
        <input type="range" data-deck-seek min="0" max="1000" step="1" value="0" aria-label="Posición deck ${id}">
      </div>
      <div class="ddj-overview"><canvas data-wave-overview width="430" height="24" aria-hidden="true"></canvas><i data-overview-playhead></i></div>
      <div class="ddj-phrases" data-phrases></div>
      <div class="ddj-screen-bottom"><span data-deck-status>En pausa</span><span data-sync-status></span><span data-deck-native></span></div>
    </div>
    <div class="ddj-harmonic"><div class="ddj-key-readout"><strong data-deck-key>—</strong><small data-harmonic-fit></small></div>
      <div class="ddj-key-shift" role="group" aria-label="Key Shift deck ${id}">${btn("key-down","−","Bajar un semitono")}
        ${btn("key-reset","0 st","Restablecer tono")}${btn("key-up","+","Subir un semitono")}</div></div>
    <div class="ddj-pad-group"><div class="section-line"><h3>Hot Cues</h3>${btn("cue-edit","Editar pads","Editar nombres y colores de Hot Cues")}</div>
      <div class="ddj-pads">${Array.from({length:8},(_,i)=>btn("hot",String.fromCharCode(65+i),"Hot Cue "+String.fromCharCode(65+i)+" del deck "+id,`data-index="${i}"`)).join("")}</div></div>
    <div class="ddj-deck-live">
      <div class="ddj-jog-panel"><button class="ddj-jog" data-jog type="button" aria-label="Jog deck ${id}. Usa las flechas para ajustar la posición">
        <i aria-hidden="true"></i><span><b>${id}</b><small data-jog-mode>VINYL</small></span></button>
        <div class="ddj-transport">
          ${btn("cue","CUE","CUE deck "+id)}<button class="b" data-ddj-action="play" aria-label="Reproducir deck ${id}">▶ Play</button>
        </div>
      </div>
      <div class="ddj-performance">
        <div class="ddj-controls-row">${btn("master","Master","Hacer maestro al deck "+id)}${btn("sync","Sync","Sync deck "+id)}
          ${btn("mt","Master Tempo","Master Tempo del deck "+id)}${btn("slip","Slip","Slip Mode del deck "+id)}
          ${btn("vinyl","Vinyl","Cambiar modo Jog")}${btn("quantize","Quantize","Quantize")}</div>
        <div class="ddj-jump-group"><span>Beat Jump</span><div class="ddj-controls-row">
          ${btn("jump-back","−16","Retroceder pulsos deck "+id)}${btn("jump-next","+16","Avanzar pulsos deck "+id)}</div></div>
        ${btn("grid","Beatgrid","Editar beatgrid y memoria")}
      </div>
      <div class="ddj-tempo-group"><label class="ddj-pitch">Tempo<input type="range" data-deck-pitch min="-6" max="6" step=".01" value="0" aria-label="Tempo deck ${id}"></label>
        ${btn("reset-pitch","0 %","Restablecer fader de tempo")}</div>
    </div>
    <div class="ddj-loop-group"><h3>Loop por pulsos</h3><div class="ddj-pads ddj-loop-pads">${LOOP_BEATS.map(n=>
      btn("beat-loop",n===.25?"¼":n===.5?"½":n,n+" pulsos",`data-beats="${n}"`)).join("")}</div>
      <div class="ddj-controls-row">${btn("loop-in","IN","Inicio de loop")}${btn("loop-out","OUT","Fin de loop")}${btn("reloop","Reloop","Entrar o salir del loop")}
        ${btn("loop-half","÷2","Reducir loop a la mitad")}${btn("loop-double","×2","Duplicar longitud del loop")}</div></div>
    <details class="ddj-more"><summary>Beatgrid, interpretación y tono</summary>
      <div class="ddj-controls-row">${btn("cue-save","Mem Cue","Guardar Memory Cue en la posición")}${btn("tag","Tag","Marcar pista para Tag List")}${btn("reverse","Reverse","Invertir reproducción del deck "+id)}${btn("brake","Brake","Frenar deck "+id)}
        ${btn("backspin","Backspin","Backspin deck "+id)}
        ${btn("hot-load","Cargar pads","Cargar Hot Cues guardados")}${btn("analyze","Analizar","Analizar pista para BPM y forma de onda")}</div>
    </details>
  </section>`;
}

const clock=sec=>{
  const n=Math.max(0,sec);
  return Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0")+"."+Math.floor(n%1*10);
};
const field=(root,key)=>root.querySelector("[data-"+key+"]");
const value=(root,key,content)=>{
  const element=field(root,key);
  if(element.textContent!==content)element.textContent=content;
};
const action=(root,key)=>root.querySelector(`[data-ddj-action="${key}"]`);
const press=(root,key,yes)=>action(root,key).setAttribute("aria-pressed",String(Boolean(yes)));

export function paintDeck(root,deck,mixer,tagged){
  const opts=deck.opts,state=deck.position(),ratio=deck.duration?state/deck.duration:0, english=opts.language==="en";
  const bpm=deck.baseBpm();
  value(root,"track-name",deck.track?.title||deck.track?.name||"Sin pista");
  value(root,"track-meta",deck.loading?"Analizando…":deck.track?
    [clock(deck.duration),deck.readyGrid?(deck.analysis?"Beatgrid disponible":"Beatgrid guardado"):"Sin beatgrid",deck.metadata.key].filter(Boolean).join(" · "):"Carga una pista desde la fuente");
  value(root,"deck-clock",(opts.time==="remain"?"−":"")+clock(opts.time==="remain"?deck.duration-state:state));
  value(root,"clock-label",opts.time==="remain"?(english?"Remain":"Restante"):(english?"Elapsed":"Transcurrido"));
  const effective=bpm*deck.rate;
  const target=(deck.sync||mixer.syncSource===deck.id)&&!["range","hold"].includes(deck.syncState)?mixer.syncClock.bpm:0;
  value(root,"deck-bpm",(target||effective)?(target||effective).toFixed(2):"—");
  field(root,"deck-bpm").title=target?`BPM real de la pista ${effective.toFixed(2)}`:"";
  value(root,"deck-native",bpm?`${bpm.toFixed(2)} BPM origen`:"");
  value(root,"deck-rate",(deck.pitch>=0?"+":"")+deck.pitch.toFixed(2)+"%");
  const buffering=deck.mode==="media"&&deck.media.readyState<3;
  value(root,"deck-status",deck.loading?"Cargando":buffering?"Cargando audio":deck.scratch?"Scratch":deck.playing?(english?"Playing":"Reproduciendo"):(english?"Paused":"En pausa"));
  const sync={ready:"Tempo igualado",aligning:"Ajustando fase",locked:"Fase alineada",hold:"Corrección en pausa",range:"Fuera del rango"};
  const status=field(root,"sync-status");
  const error=deck.syncError;
  status.dataset.error=error===null?"":error.toFixed(1);
  value(root,"sync-status",[mixer.syncSource===deck.id?"Maestro":"",deck.sync?(sync[deck.syncState]||"Sync"):"",deck.sync&&deck.syncScale!==1?(deck.syncScale===2?"Doble tiempo":"Medio tiempo"):""].filter(Boolean).join(" · "));
  status.title=error===null?"":`Error de fase ${error.toFixed(1)} ms`;
  action(root,"key-reset").textContent=(deck.shift>0?"+":"")+deck.shift+" st";
  for(const command of ["key-up","key-down","key-reset"])action(root,command).disabled=!deck.track;
  value(root,"jog-mode",opts.jog.toUpperCase());
  const seek=field(root,"deck-seek");
  if(document.activeElement!==seek)seek.value=ratio*1000;
  seek.disabled=!deck.duration;
  field(root,"overview-playhead").style.left=Math.max(0,Math.min(100,ratio*100))+"%";
  field(root,"wave-playhead").style.left=Math.max(0,Math.min(100,ratio*100))+"%";
  const angle=state*200%360;
  const jog=field(root,"jog");
  jog.style.setProperty("--jog-angle",angle+"deg");
  root.classList.toggle("on-air",Boolean(opts.ring&&deck.playing&&!mixer.config[deck.id].mute&&
    mixer.config.master>.01&&mixer.config[deck.id].level>.01&&
    (DECKS.indexOf(deck.id)%2===0?mixer.config.cross<.98:mixer.config.cross>-.98)));
  const screen=root.querySelector(".ddj-screen");
  screen.style.setProperty("--screen-level",( .6 + opts.brightness*.12).toFixed(2));
  const play=action(root,"play");
  play.textContent=deck.playing?"❚❚ Pausa":"▶ Play";
  play.setAttribute("aria-label",(deck.playing?"Pausar":"Reproducir")+" deck "+deck.id);
  play.disabled=Boolean(deck.loading);
  const pitch=field(root,"deck-pitch");
  const clockOwnsTempo=deck.sync&&mixer.syncSource!==deck.id;
  pitch.disabled=clockOwnsTempo;
  pitch.title=clockOwnsTempo?"Controlado por Reloj BPM":"";
  action(root,"reset-pitch").disabled=clockOwnsTempo;
  pitch.min=Math.min(-Math.min(75,opts.tempoRange),deck.sync?Math.floor(deck.pitch):0);
  pitch.max=Math.max(opts.tempoRange,deck.sync?Math.ceil(deck.pitch):0);
  if(document.activeElement!==pitch||deck.sync)pitch.value=String(deck.pitch);
  press(root,"master",(mixer.syncSource||mixer.master)===deck.id);press(root,"sync",deck.sync);press(root,"mt",opts.masterTempo);
  press(root,"slip",opts.slip);press(root,"vinyl",opts.jog==="vinyl");press(root,"quantize",opts.quantize);
  press(root,"tag",tagged);press(root,"reloop",deck.loop.on);press(root,"reverse",deck.reverse);
  press(root,"loop-in",deck.loop.in!==null); press(root,"loop-out",deck.loop.out!==null);
  action(root,"jump-back").textContent="−"+opts.jump;
  action(root,"jump-next").textContent="+"+opts.jump;
  for(const button of root.querySelectorAll("[data-index]")){
    const index=Number(button.dataset.index);
    const cue=deck.cues[index];
    const color=opts.hotColor?cue?.color||CUE_COLORS[index]:"#7ed59b";
    button.setAttribute("aria-pressed",String(Boolean(cue)));
    button.style.setProperty("--cue-color",color);
    if(cue)button.title=(cue.name||"Hot Cue "+String.fromCharCode(65+index))+" · "+clock(cue.time);
    else button.removeAttribute("title");
  }
  const phase=field(root,"deck-phase");
  const bar=deck.readyGrid?barPhase(deck.grid(),state):{beat:-1,fraction:0,meter:4};
  const key=opts.phase+":"+bar.meter;
  if(phase.dataset.mode!==key){
    phase.dataset.mode=key;
    phase.innerHTML=opts.phase==="blocks"?Array.from({length:bar.meter},()=>"<i></i>").join(""):"<i></i>";
    phase.classList.toggle("phase-bar",opts.phase==="bars");
  }
  if(opts.phase==="blocks")[...phase.children].forEach((block,i)=>block.classList.toggle("active",i===bar.beat));
  else phase.firstElementChild.style.width=Math.max(0,(bar.beat+bar.fraction+1)/bar.meter*100)+"%";
}

export function drawDeck(root,deck){
  const opts=deck.opts;
  value(root,"wave-label",deck.analysis?"":deck.track ? "Sin análisis de onda" : "Sin forma de onda");
  field(root,"wave-marks").innerHTML=deck.duration?deck.cues.map((cue,index)=>cue?
    `<i style="left:${100*Math.min(1,cue.time/deck.duration)}%;--cue-color:${opts.hotColor?cue.color:"#7ed59b"}">${String.fromCharCode(65+index)}</i>`:"").join(""):"";
  const markers=deck.metadata.phrases.length?deck.metadata.phrases:deck.analysis?.phrases||[];
  const active=opts.division==="phrase"&&deck.duration?markers.filter(mark=>mark.time<deck.duration):[];
  const parts=field(root,"phrases");
  if(active.length){
    parts.innerHTML=active.map((item,i)=>{
      const end=active[i+1]?.time??deck.duration;
      return `<button type="button" data-ddj-action="phrase" data-time="${item.time}" style="width:${(end-item.time)/deck.duration*100}%"
        title="${esc(item.name)}">${esc(item.name)}</button>`;
    }).join("");
  } else if(deck.duration&&opts.division==="time"){
    parts.innerHTML=Array.from({length:5},(_,i)=>`<button type="button" data-ddj-action="phrase" data-time="${deck.duration*i/5}" style="width:20%">${clock(deck.duration*i/5).slice(0,-2)}</button>`).join("");
  }else parts.innerHTML="";
}

export function paintHarmony(root,deck,reference){
  if(!deck.track){
    value(root,"deck-key","—");value(root,"harmonic-fit","");
    return;
  }
  const local=harmonyAt(deck.analysis?.harmony,deck.position(),deck.metadata.key);
  const shift=deck.soundingShift();
  value(root,"deck-key",soundingKey(local?.key,shift)||"Tonalidad sin estimar");
  const other=reference&&reference!==deck?harmonyAt(reference.analysis?.harmony,reference.position(),reference.metadata.key):null;
  const result=matchHarmony(other,local,reference?.soundingShift()||0,shift,deck.shift);
  const label=field(root,"harmonic-fit");
  label.dataset.score=result?.score??"";
  if(!result){
    value(root,"harmonic-fit",other&&local?"Afinidad incierta":"");
    if(label.title)label.title="";
    return;
  }
  const semitones=result.recommend;
  const suggestion=semitones?` · ${semitones>0?"+":""}${semitones} st sugeridos`:"";
  value(root,"harmonic-fit",`Afinidad con ${reference.id} ${result.score}/100${suggestion}`);
  label.title=`Mezcla armónica difusa · confianza tonal ${Math.round(100*result.confidence)} %`;
}
