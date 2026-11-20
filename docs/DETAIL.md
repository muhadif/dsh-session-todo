# Session todo

One PRD and task board per workspace, shared by every session working in that directory: a kanban board in the main panel, and a strip under the composer that shows the same board while the agent works.

## The board

Four columns — Todo, Doing, Blocked, Done — with a card per task. The header carries the counts, a progress bar, the scope toggle, the PRD editor, and the add field. A card shows its title, its latest progress note and its owner, offers the actions for its column (Start, Done, Block, Reopen, Delete), and toggles the per-task progress log.

## Sessions on a task

Each task records up to five session ids, most recent first, written by both the agent tools and the board route. `sessions[0]` is the session the card links to: clicking that button calls the workspace service's `openSession`, so the main area switches to the conversation that last worked on the task. The same list answers the scope toggle — **Workspace** shows every task on the board, **This session** only those whose `sessions` include the session currently in the main view.

The panel is root-scoped and has no session prop, so it reads the current session the way `ui-session` does: the catalog row whose `retainedBy.mainView` count is positive. Titles come from the same catalog, falling back to the id prefix.

## Tools the agent gets

| Tool | What it does |
| --- | --- |
| `session_todo_board` | Reads the PRD and every task with status, owner and latest note. A `workspace` path reads another workspace's board after the user approves. |
| `session_todo_prd` | Saves the PRD (`replace`) or appends a section (`append`). |
| `session_todo_task` | `add`, `claim`, `progress`, `complete`, `block`, `reopen`, `remove` on task ids such as `T3`. |

`add` returns the new ids, `claim` marks the task `doing` and records the owner (`agent` unless set), `progress` appends a note to the task log and can change status later, and `complete` closes it.

The composer strip shows the counts, a progress bar, a Board button that opens the kanban, and a collapsed list of everything not yet done. The list is capped at 28vh and scrolls inside the strip, so a long board never pushes the composer or the collapse control off screen.

## How a session finds it

The tools are registered for every agent in the profile, and the plugin adds a short `Session todo board` section to the system prompt so each step knows when to use them: record the PRD when requirements arrive, claim a task before working, log progress, complete it when done. The board is keyed by the session's working directory, so every session and subagent in the same directory shares one board without any setup.

## Where the data lives

Boards are JSON files in `$DSH_HOME/session-todo/` (by default `~/.dsh/session-todo/`), one per workspace directory and keyed by a hash of its absolute path. They survive restarts, session forks and compaction, and are not part of the session log — a plugin cannot append its own event type. Removing a file resets that workspace's board.

## Limits

- 200 tasks per board, a 40,000-character PRD, 40 log entries and 5 session ids per task, and a 60-task prefix in tool output (the count of hidden tasks is disclosed).
- Writes are serialized inside the Harness process. Editing the JSON by hand while a session is running can be overwritten on the next write.
- Sessions with no working directory cannot use the board.
- The strip and the board poll the board route every 4 seconds. Both can also write: add a task, move one between columns, log a progress note and edit the PRD. Those writes carry the same operations as the tools, under the owner name `you`.
- Only a same-origin browser request may write (the route compares the `Origin` header with its own `Host`, and sends no CORS headers), so another website open in the same browser cannot rewrite a board. A request without an `Origin` header (curl, a local script) is treated as same-origin; use the tools instead.
- The board route answers without the page's authentication token, but only for the workspace of a live session id it can resolve — it never accepts a path. It is meant for a loopback-bound Harness; a Harness exposed to a network should not enable this plugin.
- The card's session button navigates to a session id it recorded; a session that has since been archived or removed leaves the board where it is.
