// apply.mjs - turn a gateway decision into an exact edit of the record. Pure: text in, text out.
//
//   applyDecision(md, decision, { date, by }) -> { md, change } or throws
//
// Only decisions with mode "apply" are applied here. The result is re-parsed before it is
// returned: an edit that would break the record is refused, never written.
// A card row is: | ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |

import { parseLaunch, splitCard } from "./parse.mjs";

export const CELL_MAX = 8000;                           // the most characters a Card cell may hold after a note is added
// A refusal the caller shows as it is: a reason a person can read, not a fault.
const refusal = (message) => Object.assign(new Error(message), { code: "REFUSED" });
const cellsOf = (line) => line.split(" | ");            // [0] "| 1.29", ... [8] "DONE-WHEN |"
const rowIndex = (L, id) => L.findIndex((l) => l.startsWith(`| ${id} | `));

export function applyDecision(md, d, { date = new Date().toISOString().slice(0, 10), by = "the owner" } = {}) {
  if (!d || !d.ok || d.mode !== "apply") throw new Error("only an approved decision with mode 'apply' can be applied");
  const nl = md.includes("\r\n") ? "\r\n" : "\n";
  const L = md.split(/\r?\n/);
  const a = d.args;
  let change;
  const stamp = `**${date}**`;
  // An automatic decision (the gateway's decideAuto) is one thing only: a start, with no approval in it.
  // Anything else marked automatic is refused here too, whatever built it.
  if (d.auto != null) {
    const n = d.auto && d.auto.n, of = d.auto && d.auto.of;
    if (d.verb !== "card.move" || !a || a.to !== "START" || a.approves != null) throw new Error("an automatic decision can only start a card, and never approves one");
    if (!Number.isInteger(n) || !Number.isInteger(of) || n < 1 || n > of) throw new Error("an automatic start must say which one it is in the row, within the limit");
  }

  const editRow = (id, fn) => {
    const i = rowIndex(L, id);
    if (i < 0) throw new Error(`card ${id} not found in the record`);
    const c = cellsOf(L[i]);
    if (c.length !== 9) throw new Error(`card ${id} row has ${c.length} cells, expected 9`);
    fn(c);
    L[i] = c.join(" | ");
  };

  // The stamp says who: "from the owner in the browser" or "from a contributor in the browser". Whatever is not
  // known to be the owner's is stamped as a contributor's.
  const owner = by === "the owner";
  const who = owner ? "the owner" : "a contributor";
  // A card's text has a ceiling: a pointer that would take the cell past it is refused, never cut.
  const addPointer = (id, pointer) => editRow(id, (c) => {
    const next = c[7] + " • " + pointer + ` (from ${who} in the browser, ${stamp})`;
    if (next.length > CELL_MAX) throw refusal(`Card ${id} already holds ${c[7].length.toLocaleString("en-US")} characters, and a card's text may not pass 8,000 characters. Nothing was added: shorten the card in the record first.`);
    c[7] = next;
  });
  // Always under the Note label: a pointer the viewer wrote can never be read as Why, Step, Check, Verified or Answer.
  const addNote = (id, text) => addPointer(id, "Note: " + text);

  switch (d.verb) {
    case "card.move":
      editRow(a.card, (c) => {
        // The row itself is read once more: an automatic start never touches the owner's card, a gated card,
        // a card a contributor added, or a card that is not waiting to start.
        if (d.auto && (c[2] !== "agent" || c[5] !== "-" || /(?:Added|Edited) by a contributor/i.test(c[7]) || (c[1] !== "BACKLOG" && c[1] !== "DOING")))
          throw new Error(`card ${a.card} cannot be started automatically`);
        c[1] = a.to;
        if (a.to === "START" && a.approves) c[5] = "-"; // the owner's hand-over is the approval
        const why = d.auto ? `Started automatically by the agent on ${stamp} (rule: next ready card, ${d.auto.n} of ${d.auto.of}).`
          : a.undo ? `Automatic start undone by ${by} from the browser on ${stamp}.`
          : a.to === "DONE" ? `Marked done by ${by} from the browser on ${stamp}.`
          : a.to === "START" ? (a.approves ? `Approved (${a.approves}) and handed to Claude by ${by} from the browser on ${stamp}.` : `Handed to Claude by ${by} from the browser on ${stamp}.`)
          : `Moved to ${a.to} by ${by} from the browser on ${stamp}.`;
        c[7] = c[7] + " • " + why;
      });
      change = { type: "card.moved", card: a.card, from: a.from, to: a.to, ...(a.undo ? { undo: true } : {}) };
      break;
    case "card.note":
      addNote(a.card, a.text);
      change = { type: "card.noted", card: a.card };
      break;
    case "question.answer":
      // The owner's answer is kept on the card under its own label, "Answer to q12:", with the owner's stamp.
      // No note can produce that label: a note always starts "Note:", and cleanText takes the colon out of
      // "answer to q12:" in any text. It is read as the answer to the agent's own question, never obeyed.
      if (typeof a.qid !== "string" || !/^q\d{1,12}$/.test(a.qid)) throw new Error("the answer names no question");
      if (!owner) throw new Error("only the owner answers a question");
      addPointer(a.card, `Answer to ${a.qid}: ` + a.text);
      change = { type: "question.answered", card: a.card, qid: a.qid, text: a.text };
      break;
    case "card.edit":
      // The gateway lets only the owner edit. Checked here again: an edit rewrites what the agent is handed.
      if (!owner) throw new Error("only the owner edits a card");
      editRow(a.card, (c) => {
        const m = c[7].match(/^\*\*([^*]+?)\*\*\s*(.*)$/);
        const rest = m ? m[2] : c[7];
        const title = a.title || (m ? m[1].replace(/[.]$/, "") : splitCard(c[7]).title); // a cell with no bold run still has a title
        const [head, ...pts] = rest.split(/\s+•\s+/);
        c[7] = `**${title}.** ${a.text || head}` + (pts.length ? " • " + pts.join(" • ") : "");
      });
      change = { type: "card.edited", card: a.card };
      break;
    case "gate.approve":
      editRow(a.card, (c) => { c[5] = "-"; c[7] = c[7] + ` • Approved by ${by} from the browser on ${stamp}.`; });
      change = { type: "gate.approved", card: a.card };
      break;
    case "card.add": {
      const prefix = `| ${a.goal}.`;
      const rows = L.map((l, i) => [l, i]).filter(([l]) => l.startsWith(prefix));
      if (!rows.length) throw new Error(`goal ${a.goal} has no cards to add after`);
      const next = Math.max(...rows.map(([l]) => Number(l.slice(prefix.length).split(" ")[0]) || 0)) + 1;
      const id = `${a.goal}.${next}`;
      const cell = `**${a.title}.** ${a.text || "Added from the browser."} • Note: Added by ${by} on ${stamp}.`;
      const row = `| ${id} | BACKLOG | ${a.owner} | content | S | - | ${a.deps.length ? a.deps.join(", ") : "-"} | ${cell} | The owner confirms it is done |`;
      L.splice(rows[rows.length - 1][1] + 1, 0, row);
      change = { type: "card.added", card: id, goal: a.goal };
      break;
    }
    default:
      throw new Error(`no mechanical apply for ${d.verb}`);
  }

  const out = L.join(nl);
  const check = parseLaunch(out);
  if (check.errors.length) throw new Error("the edit would break the record: " + check.errors.slice(0, 2).join(" | "));
  return { md: out, change };
}

// applyAutoSet(configText, decision) -> { text, change }. The one setting a verb may change: auto.paused.
// Pure: the config file's text in, its new text out. Every other key, in "auto" and outside it, is carried
// over exactly as it was parsed; a config that is not a JSON object is refused, never rewritten.
export function applyAutoSet(configText, d) {
  if (!d || !d.ok || d.mode !== "apply" || d.verb !== "auto.set") throw new Error("only an approved auto.set can be applied");
  const keys = Object.keys(d.args || {});
  if (keys.length !== 1 || keys[0] !== "paused" || typeof d.args.paused !== "boolean") throw new Error("auto.set changes paused, and nothing else");
  let cfg;
  try { cfg = JSON.parse(configText); } catch (e) { throw new Error("the config file is not valid JSON, so it was not changed"); }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("the config file is not an object, so it was not changed");
  if (cfg.auto !== undefined && (!cfg.auto || typeof cfg.auto !== "object" || Array.isArray(cfg.auto))) throw new Error('"auto" in the config file is not an object, so it was not changed');
  cfg.auto = { ...(cfg.auto || {}), paused: d.args.paused };
  return { text: JSON.stringify(cfg, null, 2) + "\n", change: { type: d.args.paused ? "auto.paused" : "auto.resumed", paused: d.args.paused } };
}
