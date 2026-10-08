// quiet.mjs - which cards in progress has the board not heard about lately? Pure: text and events in, a list out.
//
// A card is in progress when its record state is START. It is "quiet" when the newest line the agent said
// about it (or, if it said nothing yet, the moment it was started) is older than `limitMin` minutes.
// The after-tool hook uses this to remind the agent to post an update; the page uses the same idea to show
// "No update for N min".
export const QUIET_MIN = 6;    // minutes of silence before a reminder: the promise is a line about every eight minutes
export const UNSENT_MIN = 2;   // a logged line older than this that is not on the board yet earns a reminder to send it

// Lines the agent logged that the board does not have. Pure: the lines waiting, and the clock, in.
export function unsentDue(waiting, now = Date.now(), minAge = UNSENT_MIN) {
  const list = (waiting || []).filter((e) => e && e.at);
  if (!list.length) return null;
  const oldest = Math.min(...list.map((e) => Date.parse(e.at)).filter((t) => !isNaN(t)));
  const minutes = Math.floor((now - oldest) / 60000);
  return minutes >= minAge ? { count: list.length, minutes } : null;
}
export const NUDGE_GAP_MIN = 5; // at most one reminder in this many minutes

export function quietCards(recordText, events, now = Date.now(), limitMin = QUIET_MIN) {
  const started = String(recordText).split(/\r?\n/).map((l) => l.match(/^\| (\d+\.\d+) \| START \|/)).filter(Boolean).map((m) => m[1]);
  const out = [];
  for (const card of started) {
    let last = 0, queued = false;
    for (const e of events) {
      const about = e.card === card || e.id === card;
      if (!about) continue;
      if (e.type === "claude.said" || (e.type === "card.moved" && e.to === "START")) { const t = Date.parse(e.at); if (t >= last) { last = t; queued = e.type === "claude.said" && (e.kind === "queued" || e.say === "queued"); } }
    }
    if (queued) continue;   // a queued card is expected to be silent
    const minutes = last ? Math.floor((now - last) / 60000) : null;
    if (minutes === null || minutes >= limitMin) out.push({ card, minutes });
  }
  return out;
}

export function nudgeText(list) {
  return list.map((q) => `[board] Card ${q.card} is in progress and the board has had ${q.minutes === null ? "no update at all" : "no update for " + q.minutes + " min"}. `
    + `The user is watching the board. Post one now: cockpit.mjs say "<what is true now, in one plain sentence>" --card ${q.card} --step <done>/<total>, then send the ArtifactData call it prints.`).join("\n");
}
