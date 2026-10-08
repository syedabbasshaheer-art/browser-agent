// Apply a theme to a built board page: swap the page stylesheet for proto.css + the
// theme's tokens. Since the board was rebuilt from the settled design (card 10.10), proto.css carries that
// design's own tokens on :root after the theme's, so the five palettes in themes.mjs no longer change the
// page's look; the mechanism, the fonts and the data-proto attribute are kept. Used by build.mjs (production, one theme, no switcher) and by
// build-proto.mjs (all five, with a switcher). Light only, by decision (2026-09-27).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "./themes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Source+Sans+3:wght@400;500;600&family=Manrope:wght@400;500;600&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">`;

const decl = (tk, font) => Object.entries(tk).map(([k, v]) => `${k}:${v};`).join("") +
  `--font:"${font}";--font-num:"IBM Plex Mono";--violet:var(--accent);--rule:var(--line-2);--ink3:var(--ink-3);--go:var(--st-done);--warn:var(--st-active);--stop:var(--st-blocked);`;

// The given theme goes on bare :root, so the page is right even before any script runs.
export function themeCSS(defaultId, all) {
  const def = THEMES.find((t) => t.id === defaultId) || THEMES[0];
  const out = [`:root{color-scheme:light;${decl(def.light, def.font)}}`];
  (all ? THEMES : [def]).forEach((t) => {
    out.push(`:root[data-proto="${t.id}"],:root[data-proto="${t.id}"][data-theme]{color-scheme:light;${decl(t.light, t.font)}}`);
  });
  return out.join(NL);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function protobar(id) {
  const meta = THEMES.map((x) => ({ id: x.id, name: x.name, idea: x.idea, why: x.why, bench: x.bench }));
  return `<div class="protobar" role="group" aria-label="Theme prototypes">
  <span>Prototype theme</span>
  <span class="seg">${THEMES.map((x) => `<button type="button" data-proto-btn="${x.id}" aria-pressed="${x.id === id}">${esc(x.name)}</button>`).join("")}</span>
  <span class="about" id="proto-about"></span>
</div>
<script>
(function(){
  var M=${JSON.stringify(meta).split("<").join("&lt;")};
  function set(id){
    document.documentElement.setAttribute("data-proto",id);
    var m=M.filter(function(x){return x.id===id})[0];
    document.getElementById("proto-about").innerHTML="<b>"+m.name+"</b> · "+m.idea+" "+m.why+" <i>Benchmarks: "+m.bench+"</i>";
    [].forEach.call(document.querySelectorAll("[data-proto-btn]"),function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-proto-btn")===id))});
  }
  document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-proto-btn]");if(b)set(b.getAttribute("data-proto-btn"))});
  set(${JSON.stringify(id)});
})();
</script>`;
}

export function applyTheme(html, id, { switcher = false } = {}) {
  const t = THEMES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown theme "${id}"; one of ${THEMES.map((x) => x.id).join(", ")}`);
  const css = fs.readFileSync(path.join(HERE, "proto.css"), "utf8");
  const a = html.indexOf('<link rel="preconnect" href="https://fonts.googleapis.com">');
  const so = html.indexOf("<style>", a), sc = html.indexOf("</style>", so);
  if (a < 0 || so < 0 || sc < 0) throw new Error("page no longer has the expected font link + style block");
  let h = html.slice(0, a) + FONTS + NL + "<style>" + NL + themeCSS(id, switcher) + NL + css + NL + "</style>" + html.slice(sc + 8);
  const title = h.match(/<title>([^<]*)<[/]title>/);
  if (title) h = h.replace(title[0], `<title>${title[1]}${switcher ? " · " + t.name : ""}</title>` + NL +
    `<script>document.documentElement.setAttribute("data-proto",${JSON.stringify(id)})</script>`);
  if (switcher) {
    const w = h.indexOf('<div class="wrap">') + '<div class="wrap">'.length;
    h = h.slice(0, w) + NL + protobar(id) + h.slice(w);
  }
  return h;
}
