// clock.mjs (src/core) - how fast the three loops between the board and the agent turn, from what was logged.
// Pure: it is handed the events and the record of sends, and returns numbers. Nothing is estimated.
//
//   1  you -> agent     a click on the board, until the agent took it        (askedAt -> action.received)
//   2  agent -> board   a line the agent logged, until it was on the board   (line.at -> the send that carried it)
//   3  agent -> you     a question the agent asked, until you answered it    (claude.asked -> question.answered)
//
//   loopClock({ events, sends, since })  -> { click, feed, answer, open }
//   clockLines(c)                        -> the three sentences `cockpit clock` prints
const secs = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;
const ok = (n) => Number.isFinite(n) && n >= 0;

export function stat(list) {
  const v = list.filter(ok).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, worst: null };
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { n: v.length, median: Math.round(m), worst: Math.round(v[v.length - 1]) };
}

export function loopClock({ events = [], sends = [], since = 0 } = {}) {
  const at = (e) => new Date(e.at).getTime();
  const ev = events.filter((e) => e && e.at && at(e) >= since);
  const click = ev.filter((e) => e.type === "action.received" && e.askedAt).map((e) => secs(e.askedAt, e.at));
  const feed = sends.filter((s) => s && s.at && new Date(s.at).getTime() >= since).flatMap((s) => (Array.isArray(s.lags) ? s.lags : []));
  const asked = new Map(ev.filter((e) => e.type === "claude.asked").map((e) => ["q" + e.offset, e]));
  const answer = [];
  for (const e of ev) if (e.type === "question.answered" && asked.has(e.qid)) { answer.push(secs(asked.get(e.qid).at, e.at)); asked.delete(e.qid); }
  return { click: stat(click), feed: stat(feed), answer: stat(answer), open: asked.size };
}

export function span(s) {
  if (s < 90) return s + " second" + (s === 1 ? "" : "s");
  const m = Math.round(s / 60);
  if (m < 90) return m + " minute" + (m === 1 ? "" : "s");
  const h = Math.round(m / 60);
  return h + " hour" + (h === 1 ? "" : "s");
}
const say = (st, what) => (st.n ? `${what}: usually ${span(st.median)}, at worst ${span(st.worst)} (${st.n} measured).` : `${what}: nothing measured yet.`);

export function clockLines(c) {
  return [
    say(c.click, "1. You to the agent. A click on the board, until the agent took it"),
    say(c.feed, "2. The agent to the board. A line the agent logged, until it was on the board"),
    say(c.answer, "3. The agent to you. A question on the board, until you answered it") + (c.open ? ` ${c.open} still wait${c.open === 1 ? "s" : ""} for an answer.` : ""),
  ];
}
