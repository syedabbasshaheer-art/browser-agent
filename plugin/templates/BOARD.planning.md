# BOARD.md — the record

> This file is the truth. The board is built from it. Change a card's `ST` here and the board follows.
> Never edit the board. The parser reads tables only; write any prose you like between them.
>
> States you set: `DONE` (the done-when was observed) · `BLOCKED` (something outside the repo is in the way,
> say what in a `**Blocked:**` pointer) · `DOING` (a pin: already under way) · `START` (handed to Claude to execute; only when every dependency is done).
> A card becomes `DONE` only with `• Verified: <what was observed>` in its text. Everything else is computed.
> Card cell: `**Short title.** One or two plain sentences. • A pointer. • Another pointer.`
>
> This is the placeholder shown while the agent writes the real plan. The plan replaces every row below.

## GOALS

| # | Goal | One line | Cards | State |
|---|---|---|---|---|
| **1** | **Your plan is being written** | The agent has read the project and written its goals and cards, and you have accepted them | 4 | ACTIVE |

## GOAL 1 — Your plan is being written

### Phase 1 · From a folder to a plan

Ends with: a plan you have read and accepted

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | BACKLOG | agent | verify | Q | - | - | **Read the project.** The agent reads everything in the folder, whatever it is made of: code, documents, pictures, videos, and the history of the work. • Why: A plan made from what is really in the folder beats one made from guesses. • Check: The Live page says what was found. | The Live page says what the agent found in the folder |
| 1.2 | BACKLOG | agent | content | S | - | 1.1 | **Study the field, then write the goals.** The agent learns how your kind of work is done and grown, then writes goals that lead from what you have made to where it could go, and cards under each. • Why: This page is only as useful as the plan behind it. • Check: This placeholder is replaced by the real goals. | The real goals and cards are on this page |
| 1.3 | BACKLOG | agent | content | Q | - | 1.2 | **Ask what the folder could not answer.** Anything the agent had to assume becomes a question for you on this page, with its best guess offered first. • Why: You answer with one click, and the plan is corrected. • Check: Questions appear under Needs you. | Each assumption is a question under Needs you |
| 1.4 | BACKLOG | human | decision | Q | - | 1.3 | **Accept the plan.** Read the goals and cards, add a note on anything that is wrong, then press Accept plan. • Why: Nothing starts until you agree to it. • Step: Press Accept plan at the top of the List. • Check: The Draft label becomes Accepted. | The plan is marked Accepted |

## Decisions — settled, with the reason

| # | Decision | Why | Goal |
|---|---|---|---|
| D1 | The board appears first and the plan follows | You see what is happening from the first minute | 1 |

## Watch list — conditions, not cards

| # | Watch for | Why it matters | If it fires | Goal |
|---|---|---|---|---|
| W1 | The Live page stops showing new steps | The session in the terminal may have stopped | Look at the terminal | 1 |

## Where this stands right now

| | |
|---|---|
| **Live** | Not yet |
