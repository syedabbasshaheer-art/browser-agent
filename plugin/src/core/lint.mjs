// lint.mjs - is this plan good enough to put in front of a person? Pure: a parsed record in, findings out.
//
// parse.mjs already refuses a BROKEN record (duplicate ids, unknown or circular dependencies, bad
// vocabulary). This checks a plan that parses but would still be a poor board: cards that do not say
// why they exist or how to check them, goals with no end, work nobody can start. The plan command
// (skills/browser-agent/PLAN.md) runs it and fixes every finding before publishing a draft.
//
//   planLint(rec, { first }) -> [{ level: "error" | "warn", card?, goal?, text }]
//
// first: true while the plan is a first draft (being written, or not yet accepted). A first draft is read in
// one sitting by someone who has to accept it, so it is also held to what a trial of six plans showed
// (2026-10-11): names short enough to read at a glance, few enough cards to take in, no card repeated with
// a different number, and detail that thins with distance.
export const FIRST = Object.freeze({ goalWords: 8, cards: 24, goals: 6, laterCards: 4, done: 5 });

const depsOf = (c) => (c.deps === "-" || !c.deps ? [] : c.deps.split(",").map((s) => s.trim()).filter(Boolean));
const has = (c, label) => (c.pts || []).some((p) => new RegExp("^" + label + "\\s*:", "i").test(String(p)));

export function planLint(rec, { first = false } = {}) {
  const out = [], add = (level, text, where = {}) => out.push({ level, text, ...where });
  const cards = rec.cards || [], goals = rec.goals || [];
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));

  if (goals.length === 0) add("error", "The plan has no goals.");
  if (cards.length === 0) add("error", "The plan has no cards.");

  for (const g of goals) {
    const mine = cards.filter((c) => c.g === g.n);
    if (!mine.length) { add("error", `Goal ${g.n} "${g.title}" has no cards.`, { goal: g.n }); continue; }
    if (!g.sub) add("warn", `Goal ${g.n} has no one-line description.`, { goal: g.n });
    // The board shows goals, not phases (owner's review, 2026-10-05), so a very large goal is better split in two.
    if (mine.length > 15)
      add("warn", `Goal ${g.n} has ${mine.length} cards: split it into two goals, each with its own outcome.`, { goal: g.n });
    for (const ph of new Set(mine.map((c) => c.ph).filter(Boolean)))
      if (!(rec.phaseEnd || {})[ph]) add("warn", `Phase "${ph}" has no "Ends with:" line saying what is true when it finishes.`, { goal: g.n });
    // A goal needs somewhere to start: at least one open card whose dependencies are all done or none.
    const open = mine.filter((c) => c.st !== "DONE");
    if (open.length && !open.some((c) => depsOf(c).every((d) => byId[d] && byId[d].st === "DONE")) &&
        !open.some((c) => depsOf(c).some((d) => byId[d] && byId[d].g !== g.n)))
      add("error", `Goal ${g.n} cannot start: every open card waits on another open card in the same goal.`, { goal: g.n });
  }

  for (const c of cards) {
    const w = { card: c.id };
    if (!c.title) add("error", `Card ${c.id} has no title: write it as **Short title.** then the description.`, w);
    if (!c.desc) add("warn", `Card ${c.id} has no description after its title.`, w);
    if (!has(c, "Why")) add("warn", `Card ${c.id} does not say why it exists (add "• Why: …").`, w);
    if (!c.dw || c.dw.length < 8) add("error", `Card ${c.id} has no done-when: nobody could tell when it is finished.`, w);
    if (c.st !== "DONE" && !has(c, "Check") && !has(c, "Step")) add("warn", `Card ${c.id} has neither steps nor a check (add "• Step: …" or "• Check: …").`, w);
    if (c.own === "human" && c.st !== "DONE" && !has(c, "Step")) add("warn", `Card ${c.id} is for a person but has no steps: say exactly what to click or decide.`, w);
    if (depsOf(c).includes(c.id)) add("error", `Card ${c.id} waits on itself.`, w);
  }

  if (first) {
    const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
    for (const g of goals) if (words(g.title) > FIRST.goalWords)
      add("warn", `Goal ${g.n}'s name is ${words(g.title)} words: say its end state in ${FIRST.goalWords} or fewer, and put the detail in its one line.`, { goal: g.n });
    if (goals.length > FIRST.goals) add("warn", `The plan has ${goals.length} goals: a first plan reads best with four to ${FIRST.goals}.`);
    if (cards.length > FIRST.cards)
      add("warn", `The plan has ${cards.length} cards: a first plan is ${FIRST.cards} at most. Plan the first two goals in full and give each later goal two or three larger cards.`);
    goals.slice(2).forEach((g) => { const k = cards.filter((c) => c.g === g.n && c.st !== "DONE").length;
      if (k > FIRST.laterCards) add("warn", `Goal ${g.n} is far off and has ${k} cards: two or three larger cards show the road, and it is split when its turn comes.`, { goal: g.n }); });
    const done = cards.filter((c) => c.st === "DONE").length;
    if (done > FIRST.done) add("warn", `${done} cards are already done: show finished work as ${FIRST.done} cards at most, each standing for a body of work.`);
    // the same card written again with another number ("Write chapters 13 and 14", "Write chapters 15 and 16")
    const shape = (t) => String(t || "").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim(), seen = new Map();
    for (const c of cards) { const k = c.g + "|" + shape(c.title); if (/#/.test(k)) seen.set(k, (seen.get(k) || []).concat(c.id)); }
    for (const ids of seen.values()) if (ids.length > 1) add("warn", `Cards ${ids.join(", ")} differ only by a number: make them one card.`, { card: ids[0] });
  }

  // The finish card, when the plan names one, must exist and everything should lead to it.
  if (rec.finish && !byId[rec.finish]) add("error", `The finish card ${rec.finish} does not exist.`);
  return out;
}

export const lintSummary = (f) => `${f.filter((x) => x.level === "error").length} error(s), ${f.filter((x) => x.level === "warn").length} warning(s)`;
