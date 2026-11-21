import { esc } from "./common.js";

const names=["Do","Do♯","Re","Re♯","Mi","Fa","Fa♯","Sol","Sol♯","La","La♯","Si"];
const dark=new Set([1,3,6,8,10]);
const octaveKeys=Array.from({length:25},(_,i)=>{
  const name=names[i%12];
  return {name,black:dark.has(i%12),number:i};
});

export function pianoMarkup(lane,keys){
  const percussion=lane.kind==="drums"||lane.kind==="clip";
  const options=lane.kind==="clip"?["Disparar clip"]:["Bombo","Caja","Palmas","Hi-hat","Hi-hat abierto","Tom"];
  const key=(i,label,css,style="")=>`<button class="${css}" type="button" ${style} data-piano-key="${i}" aria-label="${esc(label)}">
    <span>${esc(label)}</span>${keys[i]?`<kbd>${keys[i].toUpperCase()}</kbd>`:""}</button>`;
  let white=0;
  const piano=octaveKeys.map(({number,black,name})=>{
    const label=name+Math.floor(number/12+4+lane.octave);
    if(black)return key(number,label,"black-key",`style="--key-left:${white/15*100}%"`);
    white++;return key(number,label,"white-key");
  });
  return `<div class="section-line"><div><h2>${percussion?"Pads manuales":"Piano manual"}</h2>
    <p class="muted">${esc(lane.name)} · ${percussion?"dispara con el ratón, el tacto o las teclas indicadas":"toca, arrastra sobre las teclas o usa los atajos"}</p></div>
    ${percussion?"":`<label class="piano-octave">Octava<select id="piano-octave" aria-label="Octava del piano manual">
      ${[-2,-1,0,1,2].map(value=>`<option value="${value}" ${lane.octave===value?"selected":""}>${value>0?"+":""}${value}</option>`).join("")}</select></label>`}</div>
    <div id="manual-piano" class="${percussion?"manual-drum":"manual-piano"}">${percussion?options.map((label,i)=>key(i,label,"drum-key")).join(""):piano.join("")}</div>`;
}

export function bindPiano(root,on,off){
  const surface=root.querySelector("#manual-piano");
  const held=new Map();
  const note=element=>{
    const key=element?.closest("[data-piano-key]");
    return key&&surface.contains(key)?Number(key.dataset.pianoKey):null;
  };
  const release=pointer=>{
    const index=held.get(pointer);
    held.delete(pointer);
    if(index!=null&&![...held.values()].includes(index))off(index);
  };
  const press=(pointer,index)=>{
    if(held.get(pointer)===index)return;
    release(pointer);
    if(index==null)return;
    const first=![...held.values()].includes(index);
    held.set(pointer,index);
    if(first)on(index);
  };
  surface.onpointerdown=event=>{
    const index=note(event.target);
    if(index===null)return;
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    press(event.pointerId,index);
  };
  surface.onpointermove=event=>{
    if(!surface.hasPointerCapture(event.pointerId))return;
    press(event.pointerId,note(document.elementFromPoint(event.clientX,event.clientY)));
  };
  surface.onpointerup=surface.onpointercancel=surface.onlostpointercapture=event=>release(event.pointerId);
  surface.onclick=event=>{
    const index=note(event.target);
    if(index!=null&&event.detail===0){on(index);setTimeout(()=>off(index),230);}
  };
}
