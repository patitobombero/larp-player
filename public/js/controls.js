import { esc, limit } from "./common.js";

function valueControl(field,value,attribute,key) {
  const [name,label,min,max,step,suffix] = field;
  const target = attribute + '="' + esc(key ? key + "/" + name : name) + '"';
  return `<label class="value-control"><span>${esc(label)} <small>${esc(suffix.trim())}</small></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" ${target} aria-label="${esc(label)}">
    <input class="number-value" type="number" min="${min}" max="${max}" step="${step}" value="${value}" ${target} aria-label="${esc(label)} (valor exacto)">
  </label>`;
}

function editableControl(root,selector,change) {
  const update = event => {
    const input = event.target.closest("input[" + selector + "]");
    if (!input) return;
    if (event.type==="input" && input.type==="number") return;
    const key = input.getAttribute(selector);
    const value = limit(Number(input.value),Number(input.min),Number(input.max),Number(input.min));
    for (const matching of root.querySelectorAll("input[" + selector + "]")) 
      if (matching.getAttribute(selector)===key) matching.value = value;
    change(key,value);
  };
  root.addEventListener("input",update);
  root.addEventListener("change",update);
}

export { editableControl, valueControl };
