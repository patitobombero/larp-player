import { au, ctx, play, setPlaybackRoute, setPlayOrder, sound } from "./audio.js";
import { readAudioFormat, referenceWav } from "./audio-format.js";
import { task } from "./client.js";
import { esc } from "./common.js";
import { addDeviceFile } from "./library.js";
import { session } from "./state.js";

const kHz=rate=>new Intl.NumberFormat("es",{maximumFractionDigits:3}).format(rate/1000)+" kHz";
let mounted;
let reference;

export function outputCheckMarkup() {
  return `<section class="card output-check" id="output-check"><div class="section-line">
    <div><h2>Resolución y salida</h2><p class="muted">Comprueba archivos WAV y FLAC y elige cómo reproducirlos.</p></div>
    <button class="g" id="output-test">Reproducir referencia 96 kHz / 24 bits</button>
  </div>
  <div class="output-fields"><label class="field">Ruta del reproductor
    <select id="playback-route"><option value="dsp">Web Audio · con EQ y dinámica</option><option value="direct">Directa · sin EQ ni dinámica de Larp</option></select>
  </label><label class="field">Archivo para comprobar<select id="inspect-audio"></select></label></div>
  <dl class="output-facts">
    <div><dt>Formato del archivo</dt><dd id="output-format">Elige una pista</dd></div>
    <div><dt>Motor del reproductor</dt><dd id="output-engine"></dd></div>
    <div><dt>Señal recibida por el DAC</dt><dd>Sin lectura desde el navegador</dd></div>
  </dl>
  <p class="muted" id="output-assessment" role="status"></p>
  <p class="muted" id="output-route-note"></p>
  <details class="output-help"><summary>Cómo verificar la salida física</summary>
    <p class="muted">Selecciona tu DAC como salida, configura el sistema a 96 kHz y 24 bits si lo admite y activa la ruta directa. Pausa el Estudio o los decks si están sonando. Reproduce la referencia de 997 Hz a −24 dBFS y compara lo que indica el DAC con los datos del archivo. En esta ruta, 100 % evita la atenuación de volumen de Larp.</p>
    <p class="muted">La lectura del panel confirma el encabezado del archivo. La pantalla del DAC puede indicar la frecuencia recibida. La profundidad de bits y una salida sin remuestreo requieren una medición de la cadena.</p>
  </details></section>`;
}

export function mountOutputCheck() {
  mounted?.abort();
  const panel=document.querySelector("#output-check");
  if (!panel) return;
  const source=panel.querySelector("#inspect-audio");
  const route=panel.querySelector("#playback-route");
  const format=panel.querySelector("#output-format");
  const engine=panel.querySelector("#output-engine");
  const note=panel.querySelector("#output-route-note");
  const assessment=panel.querySelector("#output-assessment");
  let header;
  let currentKey;
  let controller;

  function outputDetails() {
    if (!panel.isConnected) return;
    route.value=sound.route;
    if (sound.route==="direct") {
      engine.textContent="Reproducción directa del navegador";
      const volume=au.muted ? "Silenciado" : `Volumen del reproductor ${Math.round(au.volume*100)} %`;
      note.textContent=volume+". La mezcla del sistema y el dispositivo determinan la señal de salida.";
    } else {
      const current=session.tracks[session.trackIndex];
      const track=selectedTrack();
      engine.textContent=ctx ? "Web Audio · "+kHz(ctx.sampleRate) : "Web Audio · " + (sound.settings.rate?kHz(sound.settings.rate)+" solicitados":"frecuencia automática");
      if (ctx && header && current?.id===track?.id && header.rate!==ctx.sampleRate) {
        note.textContent=`Web Audio convierte de ${kHz(header.rate)} a ${kHz(ctx.sampleRate)}. La frecuencia física del DAC puede diferir.`;
      } else {
        note.textContent="La frecuencia del motor describe el procesamiento de Larp. La mezcla del sistema y el dispositivo determinan la señal física.";
      }
    }
  }

  function selectedTrack() {
    return source.value ? session.tracks.find(track=>track.id===source.value) : session.tracks[session.trackIndex];
  }

  function paintHeader(track, info) {
    header=info;
    if (!track) {
      format.textContent="Elige una pista";
      assessment.textContent="Selecciona un audio de la biblioteca o reproduce la señal de referencia.";
    } else if (!info) {
      format.textContent="Resolución sin confirmar";
      assessment.textContent="La lectura identifica WAV PCM y FLAC. Una extensión, por sí sola, no indica la frecuencia ni los bits.";
    } else {
      const encoding=info.encoding==="float" ? " · flotante" : "";
      format.textContent=`${info.format} · ${kHz(info.rate)} / ${info.bits} bits${encoding}`;
      if (info.encoding==="float") {
        assessment.textContent="El contenedor declara PCM flotante. Esa cifra es el formato del archivo.";
      } else if (info.bits>=24 && info.rate>=96000) {
        assessment.textContent="El archivo alcanza la referencia digital de 96 kHz / 24 bits.";
      } else {
        assessment.textContent="El archivo queda por debajo de la referencia digital de 96 kHz / 24 bits.";
      }
    }
    outputDetails();
  }

  async function inspect() {
    const track=selectedTrack();
    const key=track ? track.id+":"+track.size : "";
    if (key===currentKey) {
      outputDetails();
      return;
    }
    currentKey=key;
    controller?.abort();
    controller=new AbortController();
    const {signal}=controller;
    header=null;
    if (!track) {
      paintHeader(null,null);
      return;
    }
    format.textContent="Leyendo encabezado…";
    assessment.textContent="";
    outputDetails();
    try {
      const info=await readAudioFormat(track,signal);
      if (panel.isConnected&&!signal.aborted) paintHeader(track,info);
    } catch {
      if (panel.isConnected&&!signal.aborted) {
        format.textContent="Lectura pendiente";
        assessment.textContent="No se pudo leer el encabezado. Vuelve a seleccionar el archivo para intentarlo de nuevo.";
        currentKey=undefined;
      }
    }
  }

  function fillTracks() {
    if (!panel.isConnected) return;
    const old=source.value;
    source.innerHTML='<option value="">Pista en el reproductor</option>'+session.tracks.map(track=>
      `<option value="${esc(track.id)}">${esc(track.name)}</option>`).join("");
    if (session.tracks.some(track=>track.id===old)) source.value=old;
    inspect();
  }

  route.onchange=()=>task(route,async()=>{
    try { await setPlaybackRoute(route.value); }
    finally { outputDetails(); }
  });
  source.onchange=inspect;
  panel.querySelector("#output-test").onclick=event=>task(event.currentTarget,async()=>{
    if (!reference||!session.localTracks.includes(reference)) reference=addDeviceFile(referenceWav());
    source.value="";
    currentKey=undefined;
    setPlayOrder([reference.id]);
    await play(session.tracks.findIndex(track=>track.id===reference.id));
  });
  mounted={fillTracks,inspect,outputDetails,abort:()=>controller?.abort()};
  fillTracks();
  outputDetails();
}

window.addEventListener("larp-library-updated",()=>mounted?.fillTracks());
window.addEventListener("larp-track-changed",()=>mounted?.inspect());
window.addEventListener("larp-output-changed",()=>mounted?.outputDetails());
