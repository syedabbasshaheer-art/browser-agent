# Changelog

## 0.0.12

- A first run shows a page within seconds. The agent first publishes a small opening page, a few kilobytes, that shows the five steps and its lines as they arrive; the full board replaces it at the same address when goal 1 is written.
- Each request shows where it is. Under Your requests, a request shows three stops with the time at each: saved, the agent told, applied.
- The agent's lines reach the board sooner. The reminder to send comes after half a minute, and it carries the writes themselves, so sending is one step.
- A result should end with your next move. The agent is told when a card's result offers no reply to press, and `clock` counts how many did.
- The board is named like a project: a folder called `my-video_project` gives a board called My Video Project, and the agent can give it a better name.

## 0.0.11

- You decide goal by goal. On the Goals page each goal has Accept and Set aside, and the top has Accept all goals. A goal set aside stays in the plan, none of its cards starts, and it can be brought back. Deciding the last goal accepts the plan.
- A card can be closed on your own word: Already done, or Not needed. The card says it was your word.
- Goal 1 arrives first. On a first run the board shows your next step before the agent studies your field and writes the goals that follow.
- The plan check holds a first draft to what a trial showed: a goal name of eight words or fewer, twenty-four cards at most, later goals of two or three cards, and no card repeated with another number.
- A newer version announces itself. The session checks a few times a day; the terminal says so once, and the board's Inbox shows "Update ready" with an Update now button, with no rebuild. Pressing it has the agent run the plugin's own update command.
- The board comes before everything on a first run: the agent no longer runs the plugin's tests or reads its code before the board's link is given.
- The first plan is smaller and closer: twelve to twenty-four cards, numbers counted from the folder, later goals that are the project's own, and nothing stated about you that the folder does not say.
- The List is the Goals page, and says what it is: the agent's reading of your project, which you decide on and the agent keeps up to date.
- In a session with no screen of its own, the board's link is given to you instead of a browser being "opened".
- In the terminal, a long goal name wraps instead of being cut.

## 0.0.10

- The first plan is written for your kind of work, code or not. The agent takes an inventory of the folder (videos, documents, designs, data), studies the field, places you on a ladder from what you have made to where it could go, and writes goals that lead up it.
- A draft plan opens on the List: every goal with what it ends in, its cards under it, and Accept plan at the top. The terminal shows the same goals and cards.
- The Path is drawn on the page itself, with its key at the top, and is one press away from the List.
- Answering a question no longer makes the page blink: only the part that changed is redrawn.
- A question's choices each stay on one line.
- Several clicks in a few seconds ring the agent once. When the doorbell is busy the page waits and rings again by itself; your request is saved either way.
- The status beside the Inbox names the one thing to do, with its card number: "Answer 1.2", "Next: start 1.3".
- The status line on the Live page scrolls away with the page. Live and Board look the same when chosen and when not, and the one not chosen is easier to see.
- The version is shown at the bottom of the Live page and of the menu.
- `clock` reports how fast the board and the agent reach each other, from what was logged: a click until the agent took it, a line until it was on the board, a question until you answered it.
- The agent is reminded to send a line to the board after one minute, not two.

## 0.0.9

- Work the agent finds already finished in your folder is shown as done in the first plan, instead of waiting for you to accept the plan.

## 0.0.8

- One pasted line installs the plugin, starts Claude Code and asks for the board.
- The board opens in your browser first, in about a minute, and says "Your plan is being written". The plan fills in behind it, step by step on the Live page.
- Nothing is asked in the terminal. What the agent had to assume becomes a question on the board, answered with one click.
- The welcome says what the board gives and how to start, and a one-line reminder returns in new sessions until the project has a board.
- You are told when a newer version is ready: one line when a session starts, and an "Update ready" item in the board's Inbox.
- New commands for the first run: `init --planning`, `link <address> --open`, `open`, `planned`.

## 0.0.7

- A plugin installed inside a running session now gives its welcome on the first message, once.
- The planner asks its questions when a person is there, and no longer plans on silent assumptions.
- On a draft plan the Live headline says to accept the plan.
- The open card's header takes two lines, so the reading area starts higher.
- A card that is your own to do has no approval button. "Confirm and close" is now "I have finished this".
- The starter settings point at the schema's real address.

## 0.0.6

- A result may carry up to two suggested next replies. The page shows them as buttons on that line; one press sends the reply as your message about the card.

## 0.0.5

- The welcome after an install is a few short lines.
- The README has a logo and an animated demo.

## 0.0.4

- An install copies only the `plugin/` folder: the code, the hooks, the command and the starter templates.

## 0.0.3

- One command installs the plugin. The command is `/browser-agent`.
- The first new session in a project says what to type, once. Later sessions show the board link.
- `/browser-agent` with no board does the whole first run: plan, publish, link. Plain words work too.
