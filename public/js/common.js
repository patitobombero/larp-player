const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[char]));
let toastTimer;
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.style.display = "none"; }, 3700);
}
const DB = value => 10 ** (value / 20);
const limit = (value, min, max, fallback = min) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max,Math.max(min,value));
};
const permitted = (value, options, fallback) => options.includes(value) ? value : fallback;

export { $, DB, esc, limit, permitted, toast };
