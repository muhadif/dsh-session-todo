# Session todo

One board of PRDs and tasks per workspace, shared by every session working in that directory: a kanban board in the main panel, and a strip under the composer that shows this session's work while the agent runs.

## PRDs

A PRD is an entity, not a field on the board. Each one has an id (`P1`, `P2`, …), the session that wrote it, a title and a Markdown body, and it backs as many tasks as you like — a task carries `prdId`.

The board lists every PRD behind the `PRDs (n)` button. Opening one renders its body as Markdown through the shell's own renderer (`@deepseek-ai/dsh-client-ui-primitives`), with an edit mode that saves back through the board route. A card's PRD chip opens the same sheet, so a task is one click from its spec.

`session_todo_prd` returns the id it wrote, which is what the model passes as `prdId` when adding tasks. Without an id it updates the PRD that session wrote last, creating one when there is none; `fresh: true` starts another.

## Tasks

A task carries a title, status, owner, priority (`low`/`medium`/`high`/`urgent`), labels, a Markdown description, comments, the sessions that touched it, and the PRD it belongs to.

The card shows the title, the PRD chip, priority, labels, comment count and the last session. Clicking the card opens the detail panel: editable title, status buttons, owner, priority, labels, PRD dropdown, the session list (each entry opens that conversation), the description rendered as Markdown, the comment thread, and the full history of status changes and progress notes.

## First run

An empty board explains itself: instead of four columns each saying "No tasks yet", it shows one line describing what happens next — the agent writes a PRD when requirements arrive, claims a task before working, and the human can add one directly. The prompt section tells the agent to do that unprompted for any request that takes more than a couple of steps, so a fresh install fills itself on the first real task rather than waiting to be told.

## Sessions on a task

Each task records up to five session ids, most recent first, written by both the agent tools and the board route. `sessions[0]` is the session a card links to; membership answers the scope toggle — **Workspace** shows every task on the board, **This session** only those whose `sessions` include the session currently in the main view.

The panel is root-scoped and has no session prop, so it reads the current session the way `ui-session` does: the catalog row whose `retainedBy.mainView` count is positive. Titles come from the same catalog, falling back to the id prefix.

Boards written before 1.1.0 have no `sessions` field at all, so their cards show **Link this session** instead of a session name: one click records the session currently open on that task. Any later action on the task records the session too.

## Tools the agent gets

| Tool | What it does |
| --- | --- |
| `session_todo_board` | Reads every PRD with its id and owner, and every task with status, owner, linked PRD, priority, labels and latest note. A `workspace` path reads another workspace's board after the user approves. |
| `session_todo_prd` | Writes a PRD and returns its id (`id` to target one, `fresh` to start another, `mode: append` to extend). |
| `session_todo_task` | `add`, `claim`, `progress`, `comment`, `edit`, `link`, `complete`, `block`, `reopen`, `remove` on task ids such as `T3`. |

The composer strip is scoped to the conversation it is docked in: its counts, progress bar and collapsed list cover only the tasks whose `sessions` include that session, and a footer line names how many tasks the rest of the workspace holds, linking to the board.

## How a session finds it

The tools are registered for every agent in the profile, and the plugin adds a short `Session todo board` section to the system prompt so each step knows when to use them: record the PRD when requirements arrive, pass its id as `prdId` when adding tasks, claim a task before working, log progress, complete it when done. The board is keyed by the session's working directory, so every session and subagent in the same directory shares one board without any setup.

## Where the data lives

Boards are JSON files in `$DSH_HOME/session-todo/` (by default `~/.dsh/session-todo/`), one per workspace directory and keyed by a hash of its absolute path. They survive restarts, session forks and compaction, and are not part of the session log — a plugin cannot append its own event type. Removing a file resets that workspace's board.

The current format is `version: 2`. A version 1 board (a single `prd` for the whole board) is upgraded when it is read: the PRD becomes `P1` and every existing task links to it.

## Transport

`GET/POST /session-todo/board` carries the whole board but only previews: PRD metadata (title, owner, length, task count) and the first 200 characters of a task description. `GET /session-todo/detail?kind=prd|task&id=…` serves one full record on demand, which is what the PRD sheet and the task panel fetch. Both routes resolve the workspace from a live session id and never accept a path.

## Limits

- 50 PRDs and 200 tasks per board, a 40,000-character PRD body, an 8,000-character task description, 40 log entries, 50 comments and 5 session ids per task, 8 labels per task, and a 60-task prefix in tool output (the count of hidden tasks is disclosed).
- Writes are serialized inside the Harness process. Editing the JSON by hand while a session is running can be overwritten on the next write.
- Sessions with no working directory cannot use the board.
- The strip and the board poll the board route every 4 seconds. Both can also write: add a task, move one between columns, edit its fields, comment, link a PRD, and write or edit a PRD. Those writes carry the same operations as the tools, under the owner name `you`.
- Only a same-origin browser request may write (the route compares the `Origin` header with its own `Host`, and sends no CORS headers), so another website open in the same browser cannot rewrite a board. A request without an `Origin` header (curl, a local script) is treated as same-origin; use the tools instead.
- The board routes answer without the page's authentication token, but only for the workspace of a live session id they can resolve. They are meant for a loopback-bound Harness; a Harness exposed to a network should not enable this plugin.
- A card's session link navigates to a session id it recorded; a session that has since been archived or removed leaves the board where it is.
- Markdown renders through the shell's shared renderer. On a host that does not expose it, the PRD and description fall back to preformatted text.
