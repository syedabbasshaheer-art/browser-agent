# /browser-agent plan: turn a project into a board

Read this when the user runs `/browser-agent plan` (or asks you to plan the project, or `init` has just run on a real
project). You write the plan; the scripts check it. `$P` is the plugin root, two folders above this file.

The result is a **draft**: the user reviews it on the board and accepts it there. Nothing starts before that.

## 0. Make sure the cockpit is on

If the project has no `.cockpit/config.json`, you are in a first run: follow `start` in SKILL.md, which opens a
placeholder board (`init --planning`) before you come back here. You replace the placeholder's cards with the real plan.

## 1. Read the project first

Spend your effort here. A plan made from what is really in the folder beats one made from questions.

- The project's own words: `README*`, `docs/`, any notes, plans, TODO lists, issue lists, `CLAUDE.md`, `AGENTS.md`.
- What exists: the folder layout, the package or build files, the entry points, the tests, the deploy or CI files.
- What happened: `git log --oneline -30` and uncommitted changes, to see what is finished and what is under way.
- If `.cockpit/BOARD.md` already holds a real plan (not the five starter cards), you are **revising**, not
  replacing: keep every card id, keep DONE cards as they are, and change only what the user asked or what is wrong.

Write down, for yourself: what the project is, who it is for, what "finished" would be, what is already done, what
is clearly missing, and what you could not find out.

## 2. Do not ask before the board: assume, and ask on the board

The person's first minutes belong to the board, not to a list of questions in the terminal. So do not use the
AskUserQuestion tool here. For everything the folder does not answer (where data lives, what finished means, a
price, a limit, a date, what is out of scope):

- Take the most reasonable answer and write the plan with it.
- Record it in the Decisions table starting with "Assumed:", so it is visible on the board.
- Keep a list of the assumptions that would change the plan if they were wrong: four at most. Step 5 turns each
  into a question on the board, with your assumption as the first choice.

Never ask what the folder already answers. If the person has already told you something in this conversation,
that is an answer, not an assumption.

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

## 5. Publish it as a draft, say so, and ask on the board

1. `node "$P/src/cli/cockpit.mjs" planned`. It ends the "plan is being written" state, keeps the plan a draft, and
   runs `lint` and `build` once more. (In a project that was never in that state, set `"plan": "draft"` in
   `.cockpit/config.json` and run `build`.)
2. Publish to the board's address (the `publish` command in SKILL.md).
3. `say "Your plan is ready: N cards in G goals. Reload this page to see it, then accept it." --kind result`, and
   send its batch.
4. For each assumption on your list, at most four:
   `ask "<the question, in one plain sentence>" --card <the card it changes> --topic <a short key> --choices "<your assumption>, <the alternative>, <another>"`.
   Your assumption comes first. Send the batch each prints. They appear under Needs you; the answers arrive
   through `inbox`, and you then correct the cards and the Decisions row.
5. Tell the person, with the table in SKILL.md's `start`: the address, what to do on the board, what to leave to
   you, and that nothing more is needed in the terminal.

## Keeping the plan alive

The plan changes as the project does. When the user asks for a change, in the terminal or on the board, edit the
record: add a card with the next free id in its goal, split a card (keep the old id for the first half), change a
dependency, move a card to another phase. Never delete a DONE card. Then `lint`, `build` and publish. When work
reveals something the plan did not have, add the card yourself and say so.
