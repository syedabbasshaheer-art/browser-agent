// heartbeat.mjs - should this tick of the heartbeat do anything? (card 11.8). Pure: settings, the event log
// and a time in; a decision out. No files, no clock of its own, no model, no network.
//
// What a heartbeat is. Measured on 2026-10-06: an agent turn started with no window (`claude -p`) has no tool
// to read or write the board's page database. So the heartbeat is NOT a task of the operating system. It is a
// turn of an OPEN Claude Code session that wakes itself with its own timer (`/loop 30m /browser-agent heartbeat`).
// Each tick the session runs `cockpit heartbeat`; this file decides, and the command prints either
// `SKIP: <reason>` or the checklist below. Nothing here starts a timer, a task or a process.
//
//   heartbeatDecision({ auto, entries, now, minuteOfDay, lock })
//       -> { run: true, n, of } or { run: false, why: <key>, reason: "<plain sentence>" }
//     auto         the config's auto block (heartbeat: { everyMin, from, to, perDay })
//     entries      the event log, oldest first
//     now          a Date, milliseconds or an ISO time
//     minuteOfDay  the local time as minutes after midnight (the caller's clock; see minuteOfDay())
//     lock         null, or { ageMin } for a lock file that says a heartbeat is in progress
//
// The checks, in this order. The first that fails is the reason given:
//   1 hours   the local time is outside auto.heartbeat.from to auto.heartbeat.to
//   2 paused  auto.paused
//   3 cap     heartbeats that ran in the last 24 hours have reached auto.heartbeat.perDay
//   4 gap     the last heartbeat that ran was less than everyMin minus one minute ago
//   5 busy    another agent line was written in the last 3 minutes (a session is working: do not interrupt it)
//   6 lock    a lock younger than 10 minutes shows a heartbeat in progress
// A setting that is missing or of the wrong type skips ("settings"): this function never guesses a limit.

export const BUSY_MIN = 3;    // an agent line this fresh means a session is at work
export const LOCK_MIN = 10;   // a lock older than this belonged to a heartbeat that never finished: ignored and replaced
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// The lines an agent writes while it works. session.started is not one: the session that runs the timer writes it too.
export const AGENT_LINES = Object.freeze(["claude.said", "claude.asked", "claude.auto", "claude.pulse", "turn.ended"]);
// Every reason a tick is skipped, as the status command names it.
export const SKIPS = Object.freeze({
  hours: "outside the active hours", paused: "automatic work was paused", cap: "the limit for 24 hours was reached",
  gap: "too soon after the last heartbeat", busy: "a session was already working", lock: "another heartbeat was in progress",
  settings: "the heartbeat settings could not be used",
});

const time = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));
const isEvent = (e) => !!e && typeof e === "object" && typeof e.type === "string";
const clock = (v) => { const m = typeof v === "string" ? v.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null; return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

// The local time of `now` on this computer, as minutes after midnight.
export const minuteOfDay = (now) => { const d = new Date(time(now)); return d.getHours() * 60 + d.getMinutes(); };

// Is `minute` inside the window? `from` is inside, `to` is not. A window whose end is before its start crosses
// midnight (22:00 to 06:00). The same time twice means the whole day.
export function inHours(minute, from, to) {
  const a = clock(from), b = clock(to);
  if (a == null || b == null || !Number.isInteger(minute)) return false;
  if (a === b) return true;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

// "12 minutes ago", always rounded down: it never says more time passed than did.
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "at a time that could not be read";
  const m = Math.floor(ms / MIN);
  if (m < 1) return "less than a minute ago";
  if (m < 120) return count(m, "minute") + " ago";
  if (m < 48 * 60) return count(Math.floor(m / 60), "hour") + " ago";
  return count(Math.floor(m / 1440), "day") + " ago";
}

// What the log says about heartbeats, counted once.
export function heartbeatFacts(entries, now) {
  const t = time(now);
  let ran24 = 0, lastRan = null, lastLine = null, lastSkip = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isEvent(e)) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    if (e.type === "heartbeat.ran") { if (at > t - DAY) ran24++; if (lastRan == null || at > lastRan) lastRan = at; }
    else if (e.type === "heartbeat.skipped") { if (!lastSkip || at >= lastSkip.at) lastSkip = { at, why: typeof e.why === "string" ? e.why : "" }; }
    else if (AGENT_LINES.includes(e.type)) { if (lastLine == null || at > lastLine) lastLine = at; }
  }
  return { ran24, lastRan, lastLine, lastSkip };
}

export function heartbeatDecision({ auto = null, entries = [], now = null, minuteOfDay: minute = null, lock = null } = {}) {
  const skip = (why, reason) => ({ run: false, why, reason });
  const A = auto && typeof auto === "object" ? auto : {};
  const H = A.heartbeat && typeof A.heartbeat === "object" ? A.heartbeat : {};
  const t = time(now);
  if (!Number.isFinite(t)) return skip("settings", "The time is not known, so no limit can be checked.");
  if (!Number.isInteger(H.everyMin) || H.everyMin < 2 || !Number.isInteger(H.perDay) || H.perDay < 1 || clock(H.from) == null || clock(H.to) == null || typeof A.paused !== "boolean")
    return skip("settings", "The heartbeat settings (auto.heartbeat and auto.paused in .cockpit/config.json) are missing or not valid, so nothing runs.");
  const m = Number.isInteger(minute) && minute >= 0 && minute < 1440 ? minute : null;
  if (m == null) return skip("settings", "The local time is not known, so the active hours cannot be checked.");

  if (!inHours(m, H.from, H.to)) return skip("hours", `It is ${hhmm(m)}, outside the active hours (${H.from} to ${H.to}).`);
  if (A.paused) return skip("paused", "Automatic work is paused by the owner.");
  const f = heartbeatFacts(entries, t);
  if (f.ran24 >= H.perDay) return skip("cap", `${count(f.ran24, "heartbeat")} ran in the last 24 hours, which is the limit (${H.perDay}).`);
  if (f.lastRan != null && t - f.lastRan < (H.everyMin - 1) * MIN) return skip("gap", `The last heartbeat ran ${ago(t - f.lastRan)}; the next may run ${count(H.everyMin - 1, "minute")} after it.`);
  if (f.lastLine != null && t - f.lastLine < BUSY_MIN * MIN && t - f.lastLine >= 0) return skip("busy", `An agent line was written ${ago(t - f.lastLine)}: a session is already working, and a heartbeat does not interrupt it.`);
  if (lock && Number.isFinite(lock.ageMin) && lock.ageMin < LOCK_MIN) return skip("lock", `A heartbeat that started ${ago(Math.max(0, lock.ageMin) * MIN)} is still in progress.`);
  return { run: true, n: f.ran24 + 1, of: H.perDay };
}

// A skip is written to the log at most once per reason per hour, so a timer that ticks all night does not fill it.
export function shouldLogSkip(entries, why, now) {
  const t = time(now);
  return !(Array.isArray(entries) ? entries : []).some((e) => isEvent(e) && e.type === "heartbeat.skipped" && e.why === why && Date.parse(e.at) > t - HOUR);
}

// How old the lock is, in minutes, from what the lock file holds ({ at: milliseconds }) or, failing that, from
// the file's own time. null when there is no lock.
export function lockAgeMin(lock, now) {
  if (!lock || typeof lock !== "object") return null;
  const t = time(now);
  const at = Number.isFinite(lock.at) && lock.at <= t ? lock.at : Number.isFinite(lock.mtime) ? lock.mtime : null;
  if (at == null) return LOCK_MIN; // a lock that carries no readable time cannot be shown to be fresh: it is replaced
  return (t - at) / MIN;
}

// The checklist the agent follows when a tick runs. One sentence and one exact command per step, in this order.
// Every command is one the agent already has; nothing on the never-automatic list is among them.
export const CHECKLIST_COMMANDS = Object.freeze([
  "cockpit pack", "cockpit inbox --from <dir>", "cockpit next --start", 'cockpit say "<what changed>"',
  'cockpit turn-end "<what happened>" --next "<what is next>"', "cockpit push --sent <number>",
]);
export function heartbeatChecklist({ n, of }) {
  const C = CHECKLIST_COMMANDS;
  return [
    `HEARTBEAT ${n} of ${of} in 24 hours. Follow these six steps in order, and stay silent unless there is news. If steps 1 to 3 changed nothing, skip steps 4 to 6, post nothing, and run: cockpit heartbeat --done`,
    `1. Read the wake-up pack: ${C[0]}`,
    `2. Fetch the board's waiting requests (export the page database to a folder, as the skill's "Exporting the page's database" says) and apply them: ${C[1]}`,
    `3. If nothing is in progress, or every card in progress has posted its result: ${C[2]}`,
    `4. Only if something changed (a request applied or refused, a card started, a question that needs the owner), say it in one line, and otherwise say nothing: ${C[3]}`,
    `5. End the turn: ${C[4]}`,
    `6. Send the batch file the last command printed with one ArtifactData batch call, then record it: ${C[5]}`,
    "A heartbeat never approves a gate, accepts the plan, marks a card Done, starts the owner's or a contributor's card, edits or deletes a card, or changes the settings.",
  ];
}

// What `cockpit heartbeat --status` prints. It reports the settings and what the log shows, and nothing else:
// this code cannot see whether a session timer is running, so it never says one is.
export function heartbeatStatus({ auto = null, entries = [], now = null, minuteOfDay: minute = null, lock = null } = {}) {
  const A = auto && typeof auto === "object" ? auto : {};
  const H = A.heartbeat && typeof A.heartbeat === "object" ? A.heartbeat : {};
  const t = time(now);
  const f = heartbeatFacts(entries, t);
  const every = Number.isInteger(H.everyMin) ? H.everyMin : 30;
  const out = [];
  out.push(H.installed === true
    ? "Heartbeat: the settings say it is on (auto.heartbeat.installed is true: the owner marked the session timer as turned on)."
    : "Heartbeat: the settings say it is off (auto.heartbeat.installed is false: the owner has not marked the session timer as turned on).");
  out.push(`Hours: ${H.from} to ${H.to}, local time${H.from === H.to ? " (the whole day)" : ""}; one heartbeat every ${count(every, "minute")} at most.`);
  out.push(`Cap: at most ${H.perDay} in 24 hours. ${f.ran24} of ${H.perDay} ran in the last 24 hours.`);
  out.push(f.lastRan == null ? "No heartbeat has ever run in this project." : f.ran24 === 0
    ? `No heartbeat has run in the last 24 hours. The last heartbeat ran ${ago(t - f.lastRan)}.`
    : `The last heartbeat ran ${ago(t - f.lastRan)}.`);
  out.push(f.lastSkip ? `The last recorded skip was ${ago(t - f.lastSkip.at)}: ${SKIPS[f.lastSkip.why] || "for a reason this version does not know"}. (A skip is recorded once per reason per hour.)` : "No skipped heartbeat is recorded.");
  if (A.paused === true) out.push("Automatic work is paused by the owner, so every heartbeat skips until it is switched back on.");
  const d = heartbeatDecision({ auto, entries, now, minuteOfDay: minute, lock });
  out.push(d.run ? "If a heartbeat came now, it would run." : "If a heartbeat came now, it would skip: " + d.reason);
  out.push(`To turn it on: In an open Claude Code session, type: /loop ${every}m /browser-agent heartbeat. It runs while that session stays open.`);
  out.push("This command cannot see a timer. It reports only what the event log shows.");
  return out;
}
