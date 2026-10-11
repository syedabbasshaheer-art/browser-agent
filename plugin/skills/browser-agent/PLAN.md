# /browser-agent plan: turn a project into a board

Read this when the user runs `/browser-agent plan` (or asks you to plan the project, or `init` has just run on a real
project). You write the plan; the scripts check it. `$P` is the plugin root, two folders above this file.

The result is a **draft**: the user reviews it on the board and accepts it there. Nothing starts before that.

**The first draft is the whole first impression.** Most folders hold no roadmap, no goals and no task list: only the
work itself, and often not code at all (videos, designs, documents, a spreadsheet, a shop's photos). A plan that
could belong to any project ("Improve quality", "Grow the audience") tells the person the board did not understand
them, and they leave. A plan that names their own files, their own field's next steps and a future they recognise
as theirs is why they stay. Nine tenths of the work is getting the goals right. Spend your effort on steps 1 to 4.

## The order of work: goal 1 first, the rest behind it

A person waits calmly when something real is in front of them. So the plan is written in two passes, and the
first one is short.

1. **Pass one, a few minutes: goal 1.** Do step 1 (read the folder) and only the Now and Next rungs of step 3.
   Write goal 1 alone into the record: the next step any practitioner would take, built on what exists, with its
   cards in full, and one or two `DONE` cards for the finished work you saw. No field study yet and no web
   search: goal 1 comes from the folder. `lint`, `build`, publish, and say so (SKILL.md gives the exact line).
   The board now shows something that is plainly theirs.
2. **Pass two: everything after.** Now do step 2 (know the field), the rest of step 3 (the ladder) and step 4,
   and write the goals that follow goal 1. Goal 1 may be sharpened by what you learned, but its card ids stay.
   Then steps 6 and 7.

The plan check (`lint`) holds a first draft to the limits in step 5: a goal name of eight words or fewer,
twenty-four cards at most, later goals of two or three cards, no card repeated with another number. Fix every
warning; they are the difference between a plan that is read and one that is closed.

## 0. Make sure the cockpit is on

If the project has no `.cockpit/config.json`, you are in a first run: follow `start` in SKILL.md, which opens a
placeholder board (`init --planning`) before you come back here. You replace the placeholder's cards with the real plan.

## 1. Read the project, whatever it is made of

A plan made from what is really in the folder beats one made from questions.

**Every project:**

- The project's own words: `README*`, `docs/`, any notes, plans, briefs, TODO lists, `CLAUDE.md`, `AGENTS.md`.
- What happened: `git log --oneline -30` and uncommitted changes if it is a repository; otherwise the files' dates.
- If `.cockpit/BOARD.md` already holds a real plan (not the starter or placeholder cards), you are **revising**, not
  replacing: keep every card id, keep DONE cards as they are, and change only what the user asked or what is wrong.

**A codebase:** the folder layout, the package or build files, the entry points, the tests, the deploy or CI files.

**Anything else (media, documents, designs, data):** the files are the evidence. Take an inventory before you judge:

- Count the files by kind, and list their names, sizes and dates. Names and folders show how the person thinks
  about the work (`final_v3`, `reel-for-insta`, `client-acme/`). Dates show the rhythm: one burst, or one a week.
- Open what you can. Read documents and scripts. Look at images and video frames (the Read tool shows images; if
  `ffprobe` or a similar tool is installed, read a video's length, size and shape, otherwise infer from the file).
  A tall 9:16 file under a minute is a short for a phone feed; a wide 16:9 file of ten minutes is something else.
- Note the tools the files betray (an export name, a project file, a watermark, metadata), the subjects, the
  languages, how polished the newest piece is against the oldest, and anything made for someone else (a client, a
  channel, a class).
- Note what is absent: no scripts, no thumbnails, no captions, no schedule, no record of what was published or how
  it did. What a practitioner of this field would expect to find and did not is where the next work lies.

**Count, do not guess.** Every number you will put in the plan comes from the folder, worked out by you: the
files of each kind, the words in a manuscript (from the files, not from a note that claims a total), the sums in
a sheet, the gap between dates. When a file claims one thing and the folder shows another ("about 31,000 words"
beside nine short files), believe the folder, and record the difference as a Decision.

Write down, for yourself: what the project is, who it is for, what is already done (with counts), what the person
is plainly good at, what is missing, and what you could not find out. Then list every file, or group of like
files, with what it tells you. Step 6 checks that list against the plan.

## 2. Know the field before you plan in it

Name the field in one sentence ("short AI-generated cooking videos for social feeds", "a bookkeeping tool for
freelancers", "a wedding photographer's portfolio"). Then learn how that field works, because the plan must sound
like it was written by someone who does this for a living:

- **How the work is made:** the usual stages from idea to finished piece, and the tools at each stage, from the
  simple ones the person uses to the ones professionals use.
- **How people get better at it:** what separates a beginner's piece from a professional's (in video: script,
  pacing, sound, consistency of a character or style, a hook in the first seconds; in software: tests, releases,
  support). These become the craft steps of the plan.
- **Where the work goes:** the channels, formats and audiences of the field, and what each one demands.
- **What success is measured by:** the numbers practitioners watch (retention, saves, enquiries, paying users),
  and how the work turns into income or standing, if that is where the person may be heading.
- **What is changing:** a new tool or format that someone in this field would want to try this year.

If a web search tool is available, use it: three or four searches at most, on the points above, for this exact
field. If none is available, use what you know, and say so in a Decisions row ("Assumed from general knowledge of
the field, not checked"). Never invent a statistic, a price or a tool's feature: state only what you found or know.

## 3. Place the person, and draw the ladder

The board looks forward. What is done is done: it is shown, briefly, and never re-planned. Write, for yourself,
the four rungs of **this** project:

| Rung | What it is | Example: a folder of 14 short AI-made cooking videos, all one style, none published |
|---|---|---|
| **Now** | What the folder proves, with counts | 14 finished shorts of 20 to 40 seconds, one tool, one look, no scripts kept, no channel |
| **Next** | The step any practitioner would take next week, built on what exists | Publish the best five on one channel, on a fixed weekly rhythm, and write down how each did |
| **Further** | The same work made deeper and wider | A recurring series with a kept script format and sound; a second subject; the same pieces re-cut for two more channels |
| **Evolved** | Where this leads if it is taken seriously | A small studio: a repeatable pipeline, a style people recognise, a longer flagship piece, first paid work |

Stretch the project along the lines that fit it. Pick three to five; do not use all of them:

- **Depth:** the same thing, made better (longer, more detailed, better finished).
- **Range:** the same skill on a new subject, field or format.
- **Reach:** more channels, a wider or better-chosen audience, other languages.
- **Craft:** better tools and techniques; from simple to professional.
- **System:** from one-off pieces to a repeatable way of working: templates, a rhythm, a checklist, a library.
- **Outcome:** from a pastime to a result: a portfolio, a following, clients, income.

The person's own ambition decides how far the ladder goes. Read it from the folder (a hobbyist's folder and an
agency's look different): a price list, a client's name, a deadline, a target written down are signals; so is
their absence. Do not end every plan in money or strangers. Where the folder gives no signal, the last goal
names two futures the work could grow into and makes choosing between them the person's card, and the choice is
one of your questions on the board (step 4).

**Nothing about the person is stated as fact unless the folder says it.** "This turns a pastime into a result"
claims it is a pastime. Either it is in the folder, or it is an "Assumed:" row, or it is not written.

## 4. Do not ask before the board: assume, and ask on the board

The person's first minutes belong to the board, not to a list of questions in the terminal. So do not use the
AskUserQuestion tool here. For everything the folder does not answer:

- Take the most reasonable answer and write the plan with it.
- Record it in the Decisions table starting with "Assumed:", so it is visible on the board.
- Keep a list of the assumptions that would change the plan if they were wrong: four at most. Step 7 turns each
  into a question on the board, with your assumption as the first choice.

The questions worth a slot are the ones that move the ladder: what this is for (a pastime, a portfolio, an income),
who it is for (which audience or channel comes first), how much time a week it gets, and what may be spent on
tools. Never ask what the folder already answers. If the person has already told you something in this
conversation, that is an answer, not an assumption.

## 5. Write the plan into `.cockpit/BOARD.md`

Read `.cockpit/BOARD.md` first (your file tool needs that before it will overwrite it), then write the whole plan
with one file write, not a shell command. Keep the header block from the template, and remove the placeholder's
own sentence and its goal. Three rules the checker enforces, so write to them from the start: a card's title is
ten words or fewer; every `human` card has at least one `Step:`; `Cards` in the goals table equals the rows
under that goal. Then, in this order:

**Goals** (4 to 6), in the order of the ladder. A goal is an outcome someone would recognise, not a category of
work. Together they read as one journey from where the person is to where this could go.

- **Goal 1 starts from what exists and can begin today.** It uses the finished work in the folder; it never asks
  the person to set something up first, and it never redoes what is done. A setup step the work truly needs (an
  account, a repository) is one card inside the goal it serves, placed just before the card that needs it.
- **The middle goals** are the Further rung: each takes one line of stretch (depth, range, reach, craft, system).
- **The last goal** is the Evolved rung: ambitious, and still concrete enough to check.
- **Name** each goal as its end state, in the field's own words, in eight words or fewer, with a number or a
  named thing wherever one is true: "Five shorts live, one a week", not "Publishing". The name is read at a
  glance in a list; the detail goes in the **one line**, which says what is true when the goal is reached.
- **The mix:** across the goals there is operational work (make it repeatable), creative work (ideas, formats and
  pieces only this field has) and aspirational work (a wider result). A plan with only chores, or only dreams, fails.
- **The test:** read each goal's name and line as a stranger to this project. If it could sit on a board for any
  other project in any other field, it says nothing. Rewrite it until it could only be this one.

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
| ST | `BACKLOG`, `DOING`, `DONE`, `BLOCKED` | New work is `BACKLOG`. Use `DONE` only for work you saw finished in the folder, and add `• Verified: <what you saw>`. This is allowed while the first plan is being written (before `planned`); after that a draft closes nothing until the owner accepts it. Never write `START`: that is the user's hand-over |
| OWN | `agent`, `human` | `human` = only the user can do it: a decision, a payment, an account, a sign-off, and any making that happens outside this computer |
| TYPE | `code`, `content`, `config`, `verify`, `account`, `decision` | The kind of work |
| EFF | `Q`, `S`, `L` | About 15 minutes, about an hour, more than an hour |
| GATE | `-`, `approval`, `money` | The user must approve (or pay) before this card can be done. Use it on any card, agent or human, that should not happen without their yes |
| DEPS | `-` or ids, comma separated | The cards that must be DONE first. Only real dependencies: each one delays the card |
| Card | see below | Title, description, then labelled pointers |
| DONE-WHEN | plain text | Something observable. "Tests pass" is observable; "works well" is not |

The Card cell: `**Title.**` (ten words or fewer, starting with a verb), then one or two sentences, then pointers
separated by ` • `. Use these labels so the board can lay the card out: `Why:` (always), `Where:`, `Step:` (one per
step; for a human card, say exactly what to click or decide), `Check:`, `Note:`. No `|` inside a cell.

**What is already done.** Show it, so the person sees you read their work, and keep it short: at most five `DONE`
cards in all, each standing for a body of finished work ("Make the first 14 shorts"), each with `• Verified:` and
the count or the file names you saw. Do not write one card per finished file.

**Detail follows distance, and the first look is small.** The first two goals are planned in full: every card a
single sitting, with its steps. Later goals get two or three larger cards each, enough to show the road; they are
split when their turn comes. A first draft has twelve to twenty-four cards: more than that is a wall, and the
person has to read it before they can accept it. Never write a run of cards that differ by a number ("Write
chapters 13 and 14", "Write chapters 15 and 16"): that is one card. Do not pad a goal with groundwork (a log, a
folder tidy, a test harness) ahead of the thing the person wants.

**When the person already wrote a list** (a TODO, an outline, a wishlist), it is their plan and yours follows it:
goal 1 delivers its first item, with only the groundwork that item needs. Your additions come after theirs.

**Later goals are this project's, not stock moves.** "Write a one-page pitch", "post on three platforms", "find
a first paying customer" appear in every plan a lazy planner writes. A later goal earns its place by naming
something only this project has: its own best piece, its own gap, its own numbers.

**Who does a card, in a project that is not code.** Be honest about what you can do from this computer. You can
research, write (scripts, outlines, prompts, captions, briefs, checklists, schedules), organise and rename files,
compare pieces, and keep the record of what was published and how it did when the person gives you the numbers.
You cannot record, film, publish to an account or judge taste: those cards are `human`, with steps that say
exactly what to open and do, and each is paired with an agent card that prepares it (the script before the
recording, the caption and the checklist before the upload). The creative choice stays the person's; give them
options to choose from, not instructions.

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
- Use the field's own plain words, and name the person's own files, pieces and channels. Explain a term once if a
  newcomer would not know it. No shorthand from the conversation, no clipped fragments, no slogans, no words that
  only add emphasis.
- Read it back as a stranger. If a sentence could be on any card in any project, it says nothing: replace it.

**Sizing.** A card is one sitting of work with one clear finish. If it needs "and" twice, split it. If it takes five
minutes, fold it into its neighbour.

**Decisions and risks**, after the last goal. The Goal column places each row under its goal on the board. The
first Decisions row says, in one sentence, how you read the project: what it is, where it stands and where the
plan takes it ("Read as: 14 unpublished cooking shorts in one style; the plan goes from a first channel to a
recognisable series").

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
`"finish": "<id>"`: the last card of the last goal. Everything it depends on, directly or not, becomes the finish
path on the board.

## 6. Check it, and fix every finding

```
node "$P/src/cli/cockpit.mjs" lint
node "$P/src/cli/cockpit.mjs" build
node "$P/src/cli/cockpit.mjs" goals --brief
```

`lint` prints what a reader would trip on: a card with no reason or no way to check it, a goal that cannot start, a
phase with no end state. Fix all errors and all warnings, then run both again until they are clean. Do not publish a
plan with findings.

`goals --brief` prints the goals as the person will first see them. Read them once more against the test in step
5: each one specific to this project, the first one startable today, the last one worth wanting, and the set
reading as one journey. A name that wrapped onto a second line is too long: shorten it. Rewrite any that fail
before you publish. This is the check that matters most. Then three passes, each a minute:

- **The folder pass.** Take your list of files from step 1. Each one is used by a card, or you can say why not.
  A file nobody used is usually the detail that would have made the plan theirs (a duplicate, a gap in the dates,
  an offer nobody followed up, a column in a sheet).
- **The number pass.** Every number in a goal, a card and a Decision is one you counted, and the sums agree with
  each other (a goal's end state does not contradict a card inside it).
- **The practitioner pass.** Name three things someone who does this work for a living would ask on reading the
  plan ("where does it go live?", "who collects the money?", "what is the offer?"). Each has a card, or a line in
  the watch list. No goal's end state depends on something the watch list says may not be possible, and no goal
  is named for a choice that one of its own cards has not yet made.

## 7. Publish it as a draft, show the goals, and ask on the board

1. `node "$P/src/cli/cockpit.mjs" planned`. It ends the "plan is being written" state, keeps the plan a draft, and
   runs `lint` and `build` once more. (In a project that was never in that state, set `"plan": "draft"` in
   `.cockpit/config.json` and run `build`.)
2. Publish to the board's address (the `publish` command in SKILL.md). A draft opens on the List: every goal with
   what it ends in, its cards under it, and Accept plan at the top.
3. `say "Your plan is ready: N cards in G goals. Reload this page to see it, then accept it." --kind result`, and
   send its batch.
4. For each assumption on your list, at most four:
   `ask "<the question, in one plain sentence>" --card <the card it changes> --topic <a short key> --choices "<your assumption>, <the alternative>, <another>"`.
   Your assumption comes first. Send the batch each prints. They appear under Needs you; the answers arrive
   through `inbox`, and you then correct the cards and the Decisions row.
5. Show the plan in the terminal: run `node "$P/src/cli/cockpit.mjs" goals` and give its output to the person
   exactly as printed, in a code block, under one sentence that says how you read their project and where the plan
   takes it. Then the table in SKILL.md's `start`: the address, what to do on the board, what to leave to you, and
   that nothing more is needed in the terminal.

## Keeping the plan alive

The plan changes as the project does. When the user asks for a change, in the terminal or on the board, edit the
record: add a card with the next free id in its goal, split a card (keep the old id for the first half), change a
dependency, move a card to another phase. Never delete a DONE card. Then `lint`, `build` and publish. When work
reveals something the plan did not have, add the card yourself and say so. When a later goal's turn comes, split
its large cards into single sittings before the first one starts.
