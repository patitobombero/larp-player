import { esc, toast } from "../common.js";
import { media } from "../client.js";
import { session } from "../state.js";

const $=(selector,root=document)=>root.querySelector(selector);
const out=$("#main");
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const uid=()=>crypto.randomUUID();
const fmt=seconds=>Math.floor((seconds||0)/60)+":"+String(Math.floor((seconds||0)%60)).padStart(2,"0");
const names=["Do","Do♯","Re","Re♯","Mi","Fa","Fa♯","Sol","Sol♯","La","La♯","Si"];
const palette=["#b6a4ff","#86dfb5","#f4ba8b","#87cafa","#e9a5c7","#eed47d","#90d7d9","#a3aae9"];
const btn=(text,attributes="",className="")=>'<button type="button" '+attributes+' class="'+className+'">'+text+'</button>';
const isOpen=()=>session.page==="syn";
const sources=()=>session.tracks.map(track=>({
  ...track,title:track.title||track.name,url:track.local?track.url:media(track.id),rawFile:track.file
}));

const noiseByContext=new WeakMap();
function noiseFor(context) {
  if (!noiseByContext.has(context)) {
    const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate);
    const samples=buffer.getChannelData(0);
    let seed=29349;
    for (let i=0;i<samples.length;i++) {
      seed=(Math.imul(1664525,seed)+1013904223)>>>0;
      samples[i]=seed/2147483648-1;
    }
    noiseByContext.set(context,buffer);
  }
  return noiseByContext.get(context);
}

function openPreview(track,accept,release) {
  const dialog=document.createElement("dialog");
  dialog.className="audio-dialog workbench-preview";
  dialog.innerHTML='<h2></h2><audio controls preload="metadata"></audio><div class="actions"><button class="b" type="button">Añadir al arreglo</button><form method="dialog"><button class="g">Cerrar</button></form></div>';
  dialog.querySelector("h2").textContent=track.title;
  const player=dialog.querySelector("audio");
  const add=dialog.querySelector("button");
  player.src=track.url;
  let importing=false;
  dialog.addEventListener("close",()=>{
    player.pause();
    if(!importing)release?.();
    dialog.remove();
  },{once:true});
  add.onclick=async()=>{
    importing=true;
    dialog.close();
    try { await accept(track); }
    catch(error) { toast(error.message); }
    finally { release?.(); }
  };
  document.body.append(dialog);
  dialog.showModal();
}

export { $, btn, clamp, esc, fmt, isOpen, names, noiseFor, openPreview, out, palette, sources, toast, uid };
