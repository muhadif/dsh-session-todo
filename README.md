# dsh-session-todo

Workspace-scoped PRD and task board for [[DSH]](https://github.com/deepseek-ai/deepseek-harness). One board per working directory, shared by every session and subagent working there — the agent writes the PRD, claims a task before starting, records progress as it learns, and closes it when done. A strip under the composer shows the same board to you.

No database, no setup: the board lives in a JSON file under `$DSH_HOME`.

## Install

Install the bundle through Plugin Manager (Settings → Plugins → add from registry) or with the Plugin Manager tool's `install_bundle` and the package name:

```
dsh-session-todo
```

The strip shows up under the composer. Refresh the page once after installing.

## Tools the agent gets

| Tool | What it does |
|---|---|
| `session_todo_board` | Reads the PRD and every task with status, owner and latest note. A `workspace` path reads another workspace's board after you approve. |
| `session_todo_prd` | Saves the PRD (`replace`) or appends a section (`append`). |
| `session_todo_task` | `add`, `claim`, `progress`, `complete`, `block`, `reopen`, `remove` on task ids such as `T3`. |

The plugin also adds a short "Session todo board" section to the system prompt, so every step knows when to record the PRD, claim a task, log progress and close it — without you asking each time.

## The strip

The human side of the same board: an add field, Start / Done / Reopen / Delete per task, a per-task progress log, and a PRD editor. Finished tasks stay out of the list — the header still counts them, and a `Done (n)` toggle brings them back. The expanded body is capped at `min(45vh, 320px)` and scrolls inside the strip, so a long board never pushes the composer off screen.

## How the board is keyed

By the session's working directory. Every session and subagent in the same directory shares one board with no configuration; two different projects get two independent boards.

## Files it writes

`$DSH_HOME/session-todo/<hash>.json`, one file per workspace directory. Nothing leaves your machine.

## Self-check

```
node check.mjs
```

Drives PRD → add → claim → progress → complete against a stubbed tool registry, plus the strip's GET/POST route and on-disk persistence, in a temp directory it removes afterwards.
