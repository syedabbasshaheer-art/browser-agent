// Parse the record, .cockpit/BOARD.md (the system of record) into plain data, and validate it.
// A record that does not parse must never reach the board, so every problem here
// is either an ERROR (build refuses) or a WARNING (build proceeds, prints it).

// START = handed to Claude to execute now; it leaves Start only for DONE (confirmed) or BLOCKED.
const ST = ["BACKLOG", "BLOCKED", "DOING", "START", "DONE"];

// A card is CONFIRMED when its text carries "• Verified: <evidence>": what was observed, by
// whom, that proves its done-when. Nothing reaches DONE without it (see build.mjs, gateway.mjs).
export const isVerified = (c) => (c.pts || []).some((p) => /^Verified\s*:/i.test(String(p)) && !/\(from [^)]*browser|Added by a contributor/i.test(String(p)));
const OWN = ["agent", "human"];
const TYPE = ["code", "config", "account", "content", "verify", "decision"];
const EFF = ["Q", "S", "L"];
const GATE = ["-", "approval", "money"];

// Markdown → the plain text the page shows. The page escapes HTML itself.
export const plain = (s) => String(s)
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
  .replace(/`([^`]+)`/g, "$1")
  .trim();

// Markdown → text that keeps **bold** (the page turns it into <b>) and drops the rest.
export const lite = (s) => String(s)
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

// The card template. A Card cell is written as
//     **Short title.** One or two plain sentences. • A pointer. • Another pointer.
// title = the leading bold run · desc = the text before the first " • " · pts = each " • " item.
// A cell without a leading bold run still works: its first clause becomes the title.
export function splitCard(cell) {
  const parts = String(cell).split(/\s+•\s+/);
  let head = parts.shift().trim(), title = "", desc = "";
  const m = head.match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
  if (m) { title = m[1]; desc = m[2]; }
  else {
    const cut = head.search(/[.:;]\s|\s[—–]\s/);
    if (cut > 0) { title = head.slice(0, cut); desc = head.slice(cut + 1).replace(/^[—–]?\s*/, ""); }
    else { title = head; }
  }
  title = plain(title).replace(/[.:]$/, "").trim();
  desc = lite(desc).replace(/^[—–:]\s*/, "");
  if (!desc && !parts.length && title.split(/\s+/).length > 14) {
    // one long unstructured sentence: keep it whole as the description, headline its opening words
    desc = title + "."; title = title.split(/\s+/).slice(0, 8).join(" ") + "…";
  }
  return { title, desc, pts: parts.map(lite).filter(Boolean) };
}

const cellsOf =(line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/\s\|\s/).map((c) => c.trim());

export function parseLaunch(md) {
  const lines = md.split(/\r?\n/);
  const out = { goals: [], cards: [], decisions: [], watch: [], state: [], phaseEnd: {}, decGoal: {}, watchGoal: {}, errors: [], warnings: [] };
  let section = "", goal = null, ph = "";

  lines.forEach((line, i) => {
    const ln = i + 1;
    const h2 = line.match(/^## (.+)/), h3 = line.match(/^### (.+)/);
    if (h2) {
      section = h2[1].trim(); ph = "";
      const g = section.match(/^GOAL (\d+)\b/);
      goal = g ? +g[1] : null;
      return;
    }
    if (h3) { if (goal) ph = h3[1].trim(); return; }
    if (goal && ph && /^Ends with:/i.test(line.trim())) { out.phaseEnd[ph] = line.trim(); return; }
    if (!line.startsWith("|") || /^\|\s*-{3}/.test(line)) return;
    const cells = cellsOf(line);

    if (section === "GOALS") {
      const m = plain(cells[0]).match(/^(\d+)$/);
      if (m) out.goals.push({ n: +m[1], title: plain(cells[1]), sub: plain(cells[2]), cards: +plain(cells[3]) || null, state: plain(cells[4] || "") });
      return;
    }
    if (goal && /^\d+\.\d+$/.test(cells[0])) {
      if (cells.length !== 9) { out.errors.push(`line ${ln}: card ${cells[0]} has ${cells.length} cells, expected 9 (a stray "|" inside a cell?)`); return; }
      const [id, st, own, type, eff, gateRaw, deps, t, dw] = cells;
      const gate = plain(gateRaw);
      const { title, desc, pts } = splitCard(t);
      const c = { id, st, own, type, eff, gate, deps: deps.trim() || "-", g: goal, ph,
        t: plain(t.replace(/\s+•\s+/g, " ")), title, desc, pts, dw: plain(dw), line: ln };
      const bad = (v, list, f) => { if (!list.includes(v)) out.errors.push(`line ${ln}: card ${id} ${f}="${v}" not in ${list.join("|")}`); };
      bad(st, ST, "ST"); bad(own, OWN, "OWN"); bad(type, TYPE, "TYPE"); bad(eff, EFF, "EFF"); bad(gate, GATE, "GATE");
      if (+id.split(".")[0] !== goal) out.errors.push(`line ${ln}: card ${id} sits under GOAL ${goal} — the id prefix must match its goal`);
      out.cards.push(c);
      return;
    }
    if (/^D\d+$/.test(cells[0]) && cells.length >= 3) {
      out.decisions.push([cells[0], plain(cells[1]), plain(cells[2])]);
      if (/^\d+$/.test(plain(cells[3] || ""))) out.decGoal[cells[0]] = +plain(cells[3]);
      return;
    }
    if (/^W\d+$/.test(cells[0]) && cells.length >= 4) {
      out.watch.push([cells[0], plain(cells[1]), plain(cells[2]), plain(cells[3])]);
      if (/^\d+$/.test(plain(cells[4] || ""))) out.watchGoal[cells[0]] = +plain(cells[4]);
      return;
    }
    if (/^Where this stands/.test(section) && cells.length >= 2 && cells[0] && !/^\d+$/.test(cells[0]) && cells[0] !== "#") {
      out.state.push([plain(cells[0]), plain(cells[1])]);
    }
  });

  validate(out);
  return out;
}

function validate(out) {
  const ids = Object.create(null); // a card id or dependency named "constructor" must not find Object's own
  out.cards.forEach((c) => {
    if (ids[c.id]) out.errors.push(`card ${c.id} is defined twice (lines ${ids[c.id].line} and ${c.line})`);
    ids[c.id] = c;
  });
  const depsOf = (c) => (c.deps === "-" ? [] : c.deps.split(",").map((s) => s.trim()).filter(Boolean));

  out.cards.forEach((c) => {
    depsOf(c).forEach((d) => {
      if (!ids[d]) out.errors.push(`card ${c.id} depends on ${d}, which does not exist`);
      else if (c.st === "DONE" && ids[d].st !== "DONE") out.warnings.push(`card ${c.id} is DONE but its dependency ${d} is ${ids[d].st}`);
    });
    const words = c.title.split(/\s+/).length;
    if (words > 10) out.warnings.push(`card ${c.id} title is ${words} words; the card template wants a short header (10 or fewer)`);
    if (c.st === "START") {
      const open = depsOf(c).filter((d) => ids[d] && ids[d].st !== "DONE");
      if (open.length) out.errors.push(`card ${c.id} is in START but waits on ${open.join(", ")}: a card starts only when every dependency is done`);
    }
    if (c.st === "BLOCKED" && !/blocked/i.test(c.t)) out.warnings.push(`card ${c.id} is BLOCKED but its text never says what outside the repo blocks it`);
  });

  // Cycle check: a cycle means nothing in it can ever become ready.
  const color = {};
  const visit = (id, path) => {
    if (color[id] === 2 || !ids[id]) return;
    if (color[id] === 1) { out.errors.push(`dependency cycle: ${[...path, id].join(" → ")}`); return; }
    color[id] = 1;
    depsOf(ids[id]).forEach((d) => visit(d, [...path, id]));
    color[id] = 2;
  };
  out.cards.forEach((c) => visit(c.id, []));

  out.goals.forEach((g) => {
    const n = out.cards.filter((c) => c.g === g.n).length;
    if (g.cards != null && g.cards !== n) out.warnings.push(`GOALS table says goal ${g.n} has ${g.cards} cards; the record has ${n}`);
  });
  if (!out.goals.length) out.errors.push("no GOALS table found");
  if (!out.cards.length) out.errors.push("no cards found");
}
