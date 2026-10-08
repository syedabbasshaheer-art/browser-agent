# /browser-agent plan: turn a project into a board

Read this when the user runs `/browser-agent plan` (or asks you to plan the project, or `init` has just run on a real
project). You write the plan; the scripts check it. `$P` is the plugin root, two folders above this file.

The result is a **draft**: the user reviews it on the board and accepts it there. Nothing starts before that.

## 0. Make sure the cockpit is on

If the project has no `.cockpit/config.json`, run `node "$P/src/cli/cockpit.mjs" init` first. It creates the config
and a starter record with five sample cards; you will replace those cards with the real plan.

## 1. Read the project first

Spend your effort here. A plan made from what is really in the folder beats one made from questions.

- The project's own words: `README*`, `docs/`, any notes, plans, TODO lists, issue lists, `CLAUDE.md`, `AGENTS.md`.
- What exists: the folder layout, the package or build files, the entry points, the tests, the deploy or CI files.
- What happened: `git log --oneline -30` and uncommitted changes, to see what is finished and what is under way.
- If `.cockpit/BOARD.md` already holds a real plan (not the five starter cards), you are **revising**, not
  replacing: keep every card id, keep DONE cards as they are, and change only what the user asked or what is wrong.

Write down, for yourself: what the project is, who it is for, what "finished" would be, what is already done, what
is clearly missing, and what you could not find out.

## 2. Ask only what you could not find

Ask three to six questions, all at once, with the AskUserQuestion tool. Offer choices; recommend one. Typical gaps:

- What does finished look like, and by when? (This becomes the finish card.)
- What must the user decide, pay for or sign off themselves? (These become human cards with gates.)
- What is out of scope?
- Anything the folder contradicts itself about.

Never ask what the folder already answers. If you cannot ask (a run with nobody there), do not stop: take the most
reasonable answer and record it in the Decisions table starting with "Assumed:", so the user can correct it on the
board.

## 3. Write the plan into `.cockpit/BOARD.md`

Keep the header block from the template. Then, in this order:

**Goals** (3 to 7). A goal is an outcome someone would recognise, not a category of work. One line each.

```
## GOALS

| # | Goal | One line | Cards | State |
|---|---|---|---|---|
| **1** | **Short name** | What is true when this goal is reached | 6 | ACTIVE |
```

`Cards` must equal the number of card rows under that goal. `State` is ACTIVE, NEXT or LATER.

**Each goal's section**, with one or more phases. A phase ends in a state you could check.

```
## GOAL 1 — Short name

### Phase 1 · Name of the phase

Ends with: what is true when this phase is finished

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | BACKLOG | agent | code | S | - | - | **Short title.** One or two plain sentences saying what this is. • Why: the reason it matters. • Where: the files, page or place. • Step: first thing to do. • Step: next thing. • Check: how to confirm it. | What can be observed when it is done |
```

The columns, exactly:

| Column | Allowed | Meaning |
|---|---|---|
| ID | `<goal>.<n>` | Never reused, never renumbered |
| ST | `BACKLOG`, `DOING`, `DONE`, `BLOCKED` | New work is `BACKLOG`. Use `DONE` only for work you saw finished in the folder, and add `• Verified: <what you saw>`. Never write `START`: that is the user's hand-over |
| OWN | `agent`, `human` | `human` = only the user can do it: a decision, a payment, an account, a sign-off |
| TYPE | `code`, `content`, `config`, `verify`, `account`, `decision` | The kind of work |
| EFF | `Q`, `S`, `L` | About 15 minutes, about an hour, more than an hour |
| GATE | `-`, `approval`, `money` | The user must approve (or pay) before this card can be done. Use it on any card, agent or human, that should not happen without their yes |
| DEPS | `-` or ids, comma separated | The cards that must be DONE first. Only real dependencies: each one delays the card |
| Card | see below | Title, description, then labelled pointers |
| DONE-WHEN | plain text | Something observable. "Tests pass" is observable; "works well" is not |

The Card cell: `**Title.**` (ten words or fewer, starting with a verb), then one or two sentences, then pointers
separated by ` • `. Use these labels so the board can lay the card out: `Why:` (always), `Where:`, `Step:` (one per
step; for a human card, say exactly what to click or decide), `Check:`, `Note:`. No `|` inside a cell.

**How to write a card's words.** The card is read by someone who was not in the conversation. Write for them.

- **What** (the sentences after the title): say what gets made and what it does, in one or two full sentences with a
  verb. "Add a rule on GitHub that stops anyone from deleting the main branch" is a What. "Branch protection" is not,
  and neither is "A plan in nine phases, with a log".
- **Why:** say what goes wrong without it, or what it makes possible, in terms of a consequence. "Every release is
  cut from the main branch. One mistaken command could erase weeks of work" is a Why. "Important for safety" is not.
- **Where:** the exact place: a file, a folder, a page, a screen and the button on it.
- **Step:** one action each, in the order they are done, starting with a verb. For a card that belongs to the user,
  name what to open and what to press.
- **Check:** what to run or look at, and what result means it worked.
- Use the plain name of a thing, then explain it once if a newcomer would not know it. No shorthand from the
  conversation, no clipped fragments, no slogans, no words that only add emphasis.
- Read it back as a stranger. If a sentence could be on any card in any project, it says nothing: replace it.

**Sizing.** A card is one sitting of work with one clear finish. If it needs "and" twice, split it. If it takes five
minutes, fold it into its neighbour. Thirty to sixty cards is normal for a real project; do not pad.

**Decisions and risks**, after the last goal. The Goal column places each row under its goal on the board.

```
## Decisions — settled, with the reason

| # | Decision | Why | Goal |
|---|---|---|---|
| D1 | What was decided | The reason | 1 |

## Watch list — conditions, not cards

| # | Watch for | Why it matters | If it fires | Goal |
|---|---|---|---|---|
| W1 | A condition that could change the plan | The damage | What to do | 2 |
```

**The finish.** Put the id of the card that means "the project is finished" in `.cockpit/config.json` as
`"finish": "<id>"`. Everything it depends on, directly or not, becomes the finish path on the board.

## 4. Check it, and fix every finding

```
node "$P/src/cli/cockpit.mjs" lint
node "$P/src/cli/cockpit.mjs" build
```

`lint` prints what a reader would trip on: a card with no reason or no way to check it, a goal that cannot start, a
phase with no end state. Fix all errors and all warnings, then run both again until they are clean. Do not publish a
plan with findings.

## 5. Publish it as a draft, and say so

Set `"plan": "draft"` in `.cockpit/config.json`, then publish (the `publish` command in SKILL.md). Tell the user, in
a few lines: the goals, how many cards, what you assumed, and that the board is a draft to review and accept there.

## Keeping the plan alive

The plan changes as the project does. When the user asks for a change, in the terminal or on the board, edit the
record: add a card with the next free id in its goal, split a card (keep the old id for the first half), change a
dependency, move a card to another phase. Never delete a DONE card. Then `lint`, `build` and publish. When work
reveals something the plan did not have, add the card yourself and say so.
