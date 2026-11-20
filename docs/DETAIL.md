# Session todo

One PRD and task board per workspace, shared by every session working in that directory, and a strip under the composer that shows it while the agent works.

## Tools the agent gets

| Tool | What it does |
| --- | --- |
| `session_todo_board` | Reads the PRD and every task with status, owner and latest note. A `workspace` path reads another workspace's board after the user approves. |
| `session_todo_prd` | Saves the PRD (`replace`) or appends a section (`append`). |
| `session_todo_task` | `add`, `claim`, `progress`, `complete`, `block`, `reopen`, `remove` on task ids such as `T3`. |

The composer strip shows the same operations for the human: an add field, Start/Done/Reopen/Delete per task, a per-task progress log, and a PRD editor. Finished tasks stay out of the list — the header still counts them and a `Done (n)` toggle brings them back. The expanded body is capped at 45% of the viewport and scrolls inside the strip, so a long board never pushes the composer or the collapse control off screen; the add field sits outside that scroll area.

`add` returns the new ids, `claim` marks the task `doing` and records the owner (`agent` unless set), `progress` appends a note to the task log and can change status later, and `complete` closes it.

## How a session finds it

The tools are registered for every agent in the profile, and the plugin adds a short `Session todo board` section to the system prompt so each step knows when to use them: record the PRD when requirements arrive, claim a task before working, log progress, complete it when done. The board is keyed by the session's working directory, so every session and subagent in the same directory shares one board without any setup.

## Where the data lives

Boards are JSON files in `$DSH_HOME/session-todo/` (by default `~/.dsh/session-todo/`), one per workspace directory and keyed by a hash of its absolute path. They survive restarts, session forks and compaction, and are not part of the session log — a plugin cannot append its own event type. Removing a file resets that workspace's board.

## Limits

- 200 tasks per board, a 40,000-character PRD, 40 log entries per task, and a 60-task prefix in tool output (the count of hidden tasks is disclosed).
- Writes are serialized inside the Harness process. Editing the JSON by hand while a session is running can be overwritten on the next write.
- Sessions with no working directory cannot use the board.
- The strip polls the board route every 4 seconds. It can also write: add a task, start/complete/reopen/delete one, log a progress note and edit the PRD. Those writes carry the same operations as the tools, under the owner name `you`.
- Only a same-origin browser request may write (the route compares the `Origin` header with its own `Host`, and sends no CORS headers), so another website open in the same browser cannot rewrite a board. A request without an `Origin` header (curl, a local script) is treated as same-origin; use the tools instead.
- The board route answers without the page's authentication token, but only for the workspace of a live session id it can resolve — it never accepts a path. It is meant for a loopback-bound Harness; a Harness exposed to a network should not enable this plugin.
