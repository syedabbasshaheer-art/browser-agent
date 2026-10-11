# Changelog

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
