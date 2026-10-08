# BOARD.md — the record

> This file is the truth. The board is built from it. Change a card's `ST` here and the board follows.
> Never edit the board. The parser reads tables only; write any prose you like between them.
>
> States you set: `DONE` (the done-when was observed) · `BLOCKED` (something outside the repo is in the way,
> say what in a `**Blocked:**` pointer) · `DOING` (a pin: already under way) · `START` (handed to Claude to execute; only when every dependency is done).
> A card becomes `DONE` only with `• Verified: <what was observed>` in its text. Everything else is computed.
> Card cell: `**Short title.** One or two plain sentences. • A pointer. • Another pointer.`

## GOALS

| # | Goal | One line | Cards | State |
|---|---|---|---|---|
| **1** | **Ship v1** | A stranger opens the URL and it works | 5 | ACTIVE |

## GOAL 1 — Ship v1

### Phase 1 · Build

Ends with: a build that passes on a clean checkout

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.1 | DONE | agent | code | S | - | - | **The build passes.** One command builds the project from a clean checkout. | Running `npm run build` on a fresh clone exits 0 |
| 1.2 | BACKLOG | agent | code | L | - | 1.1 | **Write the core feature.** The one thing a user comes for. • Keep it behind the existing build. | The feature works in a local run |

### Phase 2 · Release

Ends with: a public URL a stranger can open

| ID | ST | OWN | TYPE | EFF | GATE | DEPS | Card | DONE-WHEN |
|---|---|---|---|---|---|---|---|---|
| 1.3 | BACKLOG | human | account | Q | money | 1.1 | **Pick a host.** Choose where it runs and create the account. • Any static host works for a first release. | The account exists and the owner says so |
| 1.4 | BACKLOG | agent | config | S | - | 1.2, 1.3 | **Deploy it.** Connect the repo to the host so a push deploys. | The host serves the latest commit |
| 1.5 | BACKLOG | agent | verify | Q | approval | 1.4 | **Check it from outside.** Open the URL from a machine that did not build it. | A request from outside returns 200 with the real page |

## Decisions — settled, with the reason

| # | Decision | Why | Goal |
|---|---|---|---|
| D1 | One record file, one generated page | Two sources of truth drift | 1 |

## Watch list — conditions, not cards

| # | Watch for | Why it matters | If it fires | Goal |
|---|---|---|---|---|
| W1 | The build gets slow | Slow checks get skipped | Profile it before adding a card | 1 |

## Where this stands right now

| | |
|---|---|
| **Live** | Not yet |
