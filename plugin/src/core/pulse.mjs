// pulse.mjs - the capped pulse (card 11.6): one factual line made by a script, never written by a model.
// Pure: the record's text, the event log, this session's edited files and a time in; a decision out.
//
//   "Working on 8.1 for 12 minutes: 6 files changed since the last update (template.html, proto.css and 4 more)."
//
// Every fact comes from what the hooks already record:
//   the card in progress           a row of the record whose state is START
//   "for 12 minutes"               since the card's last move to START in the event log, rounded down
//   "6 files changed"              the files THIS session edited after the agent's last line about the card
//                                  (the after-tool hook writes each edit and its time); the board's own files are left out
//   the step, when there is one    the last `say --step` for the card (carried as fields, not in the sentence)
// What cannot be known is not said: no start in the log means no "for N minutes"; a card with neither a line
// nor a start in the log gets no pulse at all, because "since the last update" would have no meaning.
//
//   pulseDecision({ cards, entries, touched, auto, now, skip })
//       -> { pulse: true, card, text, files, names, minutes, since, step?, of? } or { pulse: false, why }
//     cards    [{ id, text }] the cards in progress (cardsInProgress(recordText))
//     entries  the event log, oldest first
//     touched  { "<repo path>": <milliseconds it was last edited> } for this session
//     auto     the config's auto block (pulseGapMin, pulsePerHour)
//     skip     path prefixes that are never counted (the board's own folders)
//
// The rules: a card is in progress; the agent's last line about it is at least auto.pulseGapMin minutes old;
// fewer than auto.pulsePerHour pulses were written in the last hour; at least one file was edited since that
// line (silence is not news). With several cards in progress there is still ONE pulse: for the card whose
// text names the most of the changed files, or, when none is named, the card in progress longest.

const MIN = 60000, HOUR = 60 * MIN;
export const NAMES_SHOWN = 2;
// A line the agent (or this script) wrote about a card. Each resets the gap.
export const CARD_LINES = Object.freeze(["claude.said", "claude.asked", "claude.auto", "claude.pulse", "turn.ended"]);

const time = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));
const slash = (p) => String(p == null ? "" : p).replaceAll("\\", "/");
const parts = (p) => slash(p).split("/").filter(Boolean);
const tidy = (s) => { const t = String(s).replace(/[\u0000-\u001f\u007f|*·•→]/g, " ").replace(/\s+/g, " ").trim(); return t.length > 40 ? t.slice(0, 39) + "…" : t; };

// The record's rows in START, each with its whole row as text (what the card says about itself).
export function cardsInProgress(recordText) {
  return String(recordText == null ? "" : recordText).split(/\r?\n/).map((l) => { const m = l.match(/^\| (\d+\.\d+) \| START \|/); return m ? { id: m[1], text: l } : null; }).filter(Boolean);
}

// Base names, in the order given. Two files with the same base name are told apart by their folder.
export function shortNames(paths) {
  const base = paths.map((p) => parts(p).pop() || "");
  return paths.map((p, i) => {
    const twice = base.some((b, j) => j !== i && b === base[i]);
    const seg = parts(p);
    return tidy(twice && seg.length > 1 ? seg.slice(-2).join("/") : base[i]);
  });
}

// The sentence. `files` are repo paths, newest first; `minutes` is whole minutes or null when not known.
export function pulseSentence({ card, minutes = null, files = [], since = "update" }) {
  const n = files.length;
  const names = shortNames(files.slice(0, NAMES_SHOWN)), more = n - names.length;
  const whole = Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : null;
  const how = whole == null ? "" : whole < 1 ? " for less than a minute" : ` for ${whole} minute${whole === 1 ? "" : "s"}`;
  return `Working on ${card}${how}: ${n} file${n === 1 ? "" : "s"} changed ${since === "start" ? "since it started" : "since the last update"} (${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}).`;
}

// Does the card's own text name this file? The file name, or its stem when that is long enough to be distinctive.
const names = (text, p) => { const base = parts(p).pop() || "", stem = base.replace(/\.[^.]+$/, ""); return !!base && (text.includes(base) || (stem.length >= 5 && text.includes(stem))); };

export function pulseDecision({ cards = [], entries = [], touched = {}, auto = null, now = null, skip = [] } = {}) {
  const none = (why) => ({ pulse: false, why });
  const A = auto && typeof auto === "object" ? auto : {};
  const t = time(now);
  if (!Number.isInteger(A.pulseGapMin) || A.pulseGapMin < 1 || !Number.isInteger(A.pulsePerHour) || A.pulsePerHour < 0) return none("The settings auto.pulseGapMin and auto.pulsePerHour are missing or not valid, so no pulse is written.");
  if (!Number.isFinite(t)) return none("The time is not known.");
  const doing = (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c.id === "string");
  if (!doing.length) return none("No card is in progress.");
  if (A.pulsePerHour === 0) return none("Pulses are off (auto.pulsePerHour is 0).");
  const log = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === "object" && typeof e.type === "string");
  const inHour = log.filter((e) => e.type === "claude.pulse" && Date.parse(e.at) > t - HOUR).length;
  if (inHour >= A.pulsePerHour) return none(`${inHour} pulse${inHour === 1 ? " was" : "s were"} written in the last hour, which is the limit (${A.pulsePerHour}).`);

  const edits = Object.entries(touched && typeof touched === "object" && !Array.isArray(touched) ? touched : {})
    .map(([p, at]) => ({ p: slash(p), at: Number(at) }))
    .filter((f) => f.p && Number.isFinite(f.at) && f.at > 0 && f.at <= t && !(Array.isArray(skip) ? skip : []).some((s) => typeof s === "string" && s && f.p.startsWith(s)))
    .sort((a, b) => b.at - a.at || a.p.localeCompare(b.p));

  const waiting = [], silent = [], unknown = [], ready = [];
  for (const c of doing) {
    let started = 0, line = 0, step = null, queued = false, saidAt = 0;
    for (const e of log) {
      if (e.card !== c.id && e.id !== c.id) continue;
      const at = Date.parse(e.at);
      if (!Number.isFinite(at) || at > t) continue;
      if (e.type === "card.moved" && e.to === "START") { if (at > started) { started = at; step = null; } }
      else if (CARD_LINES.includes(e.type)) {
        if (at >= line) line = at;
        // Only the agent's own words end a queued state: a pulse, or any machine-written line, does not.
        if (e.type === "claude.said" && at >= saidAt) { saidAt = at; queued = e.say === "queued" || e.kind === "queued"; }
        if (e.type === "claude.said" && Number.isInteger(e.step) && Number.isInteger(e.of) && e.of > 0 && e.step >= 0 && e.step <= e.of && at >= started) step = { step: e.step, of: e.of };
      }
    }
    // A card the agent marked queued is not being worked on: a file edited meanwhile belongs to another card.
    if (queued && saidAt >= started) { silent.push(c.id); continue; }
    const anchor = Math.max(started, line);
    if (!anchor) { unknown.push(c.id); continue; }
    const age = Math.floor((t - anchor) / MIN);
    if (age < A.pulseGapMin) { waiting.push({ id: c.id, age }); continue; }
    const files = edits.filter((f) => f.at > anchor).map((f) => f.p);
    if (!files.length) { silent.push(c.id); continue; }
    ready.push({ card: c.id, files, started, since: line > started ? "update" : "start", step,
      named: files.filter((p) => names(String(c.text || ""), p)).length });
  }
  if (!ready.length) {
    if (waiting.length) return none(`The agent's last line about ${waiting[0].id} is ${waiting[0].age} minute${waiting[0].age === 1 ? "" : "s"} old; a pulse waits for ${A.pulseGapMin}.`);
    if (silent.length) return none(`No file was edited since the last line about ${silent[0]}: silence is not news.`);
    return none(`The log does not say when ${unknown[0]} started or was last spoken about, so nothing can be counted.`);
  }
  // One pulse: the card whose text names the most changed files; when none is named, the one in progress longest.
  const oldest = (a, b) => (a.started || Infinity) - (b.started || Infinity) || String(a.card).localeCompare(String(b.card), "en", { numeric: true });
  ready.sort((a, b) => b.named - a.named || oldest(a, b));
  const r = ready[0];
  const minutes = r.started ? Math.floor((t - r.started) / MIN) : null;
  const out = { pulse: true, card: r.card, files: r.files.length, names: shortNames(r.files.slice(0, NAMES_SHOWN)), minutes, since: r.since,
    text: pulseSentence({ card: r.card, minutes, files: r.files, since: r.since }) };
  if (r.step) { out.step = r.step.step; out.of = r.step.of; }
  return out;
}

// The event the hook appends: the contract's fields for a line, and the numbers the sentence was made from.
export function pulseEvent(d) {
  return { text: d.text, say: "pulse", card: d.card, files: d.files, ...(d.minutes != null ? { minutes: d.minutes } : {}), ...(d.step != null ? { step: d.step, of: d.of } : {}) };
}
