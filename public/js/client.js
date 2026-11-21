import { esc, toast } from "./common.js";

const media = file => "/api/media/" + encodeURIComponent(file);
const download = file => media(file) + "?download=1";
const when = time => new Date(time).toLocaleString([], { dateStyle:"short", timeStyle:"short" });
async function api(path, { method="GET", data, file, binary, offset, signal, raw=false } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-Larp-Request"] = "1";
  if (file) {
    const limit = path.endsWith("/sticker") ? 2 : 20;
    if (file.size > limit * 1024 * 1024) throw new Error("El archivo supera los " + limit + " MiB permitidos.");
    headers["X-File-Name"] = encodeURIComponent(file.name);
    headers["Content-Type"] = "application/octet-stream";
  } else if (binary) {
    headers["Content-Type"] = "application/octet-stream";
    headers["X-Larp-Offset"] = String(offset);
  } else if (data !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch("/api/" + path, { method, headers, signal, body:file || binary || (data === undefined ? undefined : JSON.stringify(data)) });
  if (raw && response.ok) return response;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "No se pudo conectar con Larp Player.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function task(control, action, errorBox) {
  if (control?.disabled) return;
  if (control) control.disabled = true;
  if (errorBox) errorBox.textContent = "";
  try { await action(); }
  catch (error) {
    const message = error.message || "No se pudo completar la operación.";
    if (errorBox) errorBox.textContent = message;
    else toast(message);
  } finally {
    if (control) control.disabled = false;
  }
}

function bindForm(form, action) {
  form.onsubmit = event => {
    event.preventDefault();
    task(form.querySelector('button[type="submit"]'), () => action(new FormData(form)), form.querySelector(".error"));
  };
}

function fileLink(file) {
  return '<a class="file-links" href="' + esc(download(file)) + '">Descargar</a>';
}

function player(file) {
  return '<audio controls preload="none" src="' + esc(media(file)) + '"></audio>';
}

function img(src, css, alt = "", zoom = false) {
  if (!src) return "";
  return '<img class="' + css + '" alt="' + esc(alt) + '" src="' + esc(src) + '"' +
    (zoom ? ' data-zoom role="button" tabindex="0" aria-label="' + esc("Ampliar " + alt) + '"' : "") + '>';
}

function avatar(profile, extra = "") {
  return profile.avatar ? img(profile.avatar,"av " + extra,"Foto de " + profile.name,extra==="avatar-preview") :
    '<span class="av ' + extra + '" aria-hidden="true">' + esc(profile.name.slice(0,1).toUpperCase()) + '</span>';
}

async function picture(file, maxDimension) {
  if (!file || !file.size) return "";
  if (file.size > 16 * 1024 * 1024) throw new Error("Usa una foto de hasta 16 MiB.");
  const url = URL.createObjectURL(file);
  const im = new Image();
  try {
    im.src = url;
    await im.decode().catch(() => { throw new Error("No se pudo abrir la foto. Prueba JPG, PNG, WebP o GIF."); });
    const canvas=document.createElement("canvas");
    const brush=canvas.getContext("2d");
    const scale=Math.min(1,maxDimension/Math.max(im.naturalWidth,im.naturalHeight));
    for (const [fraction,quality] of [[1,.86],[.82,.8],[.65,.74],[.48,.68]]) {
      canvas.width=Math.max(1,Math.round(im.naturalWidth*scale*fraction));
      canvas.height=Math.max(1,Math.round(im.naturalHeight*scale*fraction));
      brush.drawImage(im,0,0,canvas.width,canvas.height);
      let value=canvas.toDataURL("image/webp",quality);
      if (!value.startsWith("data:image/webp;")) {
        brush.globalCompositeOperation="destination-over";
        brush.fillStyle="#181927";
        brush.fillRect(0,0,canvas.width,canvas.height);
        brush.globalCompositeOperation="source-over";
        value=canvas.toDataURL("image/jpeg",quality);
      }
      if (value.length<460_000) return value;
    }
    throw new Error("La foto sigue siendo demasiado grande. Prueba con una resolución menor.");
  } finally { URL.revokeObjectURL(url); }
}

export { api, avatar, bindForm, fileLink, img, media, picture, player, task, when };
