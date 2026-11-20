# dsh-session-todo

Workspace-scoped PRD and task board for [[DSH]](https://github.com/deepseek-ai/deepseek-harness). One board per working directory, shared by every session and subagent working there — the agent writes the PRD, claims a task before starting, records progress as it learns, and closes it when done.

The board is a kanban in the main panel, reachable from a **Todo** icon in the sidebar, with a compact strip under the composer for a glance at the same board.

No database, no setup: the board lives in a JSON file under `$DSH_HOME`.

## Install

Install the bundle through Plugin Manager (Settings → Plugins → add from registry) or with the Plugin Manager tool's `install_bundle` and the package name:

```
dsh-session-todo
```

Refresh the page once after installing.

## The board

Four columns — **Todo**, **Doing**, **Blocked**, **Done** — with a card per task. A card carries its title, its latest progress note, the owner, and the actions that apply to its column: Start, Done, Block, Reopen, Delete, plus a Log toggle for the full progress history.

The header holds the counts, a progress bar, the PRD editor, and the add field.

### Go to the session behind a task

Every card names the session that last worked on it and links to it: clicking that button opens that session in the main area, so a task added three sessions ago is one click from the conversation that did the work.

Tasks record up to five sessions, most recent first, from both the agent tools and the board UI. A subagent that picks up a task shows up too.

### Workspace or session scope

The toggle in the header switches the board between:

| Scope | Shows |
|---|---|
| **Workspace** | every task on this directory's board, whoever worked on it |
| **This session** | only the tasks this session touched |

The session scope is disabled while no session is open.

## Tools the agent gets

| Tool | What it does |
|---|---|
| `session_todo_board` | Reads the PRD and every task with status, owner and latest note. A `workspace` path reads another workspace's board after you approve. |
| `session_todo_prd` | Saves the PRD (`replace`) or appends a section (`append`). |
| `session_todo_task` | `add`, `claim`, `progress`, `complete`, `block`, `reopen`, `remove` on task ids such as `T3`. |

The plugin also adds a short "Session todo board" section to the system prompt, so every step knows when to record the PRD, claim a task, log progress and close it — without you asking each time.

## The composer strip

Counts, a progress bar, a **Board** button that opens the kanban, and a collapsed list of everything not yet done. The strip never grows: the list scrolls inside it, so a long board cannot push the composer off screen.

## How the board is keyed

By the session's working directory. Every session and subagent in the same directory shares one board with no configuration; two different projects get two independent boards.

## Files it writes

`$DSH_HOME/session-todo/<hash>.json`, one file per workspace directory. Nothing leaves your machine.

## Self-check

```
node check.mjs
```

Drives PRD → add → claim → progress → complete against a stubbed tool registry, checks the session recorded on each task, exercises the board's GET/POST route and its origin guard, and renders both the strip and the kanban against a stub React. It writes into a temp directory it removes afterwards.
