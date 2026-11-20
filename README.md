# dsh-session-todo

Workspace-scoped PRDs and task board for [[DSH]](https://github.com/deepseek-ai/deepseek-harness). One board per working directory, shared by every session and subagent working there — the agent writes a PRD, claims a task before starting, records progress as it learns, and closes it when done.

The board is a kanban in the main panel, reachable from a **Todo** icon in the sidebar, with a compact strip under the composer for a glance at this session's work.

No database, no setup: the board lives in a JSON file under `$DSH_HOME`.

## Install

Install the bundle through Plugin Manager (Settings → Plugins → add from registry) or with the Plugin Manager tool's `install_bundle` and the package name:

```
dsh-session-todo
```

Refresh the page once after installing.

## PRDs are entities

A board holds many PRDs (`P1`, `P2`, …). Each one belongs to the session that wrote it, and one PRD backs as many tasks as you like — a task carries `prdId`.

Every card shows a **PRD chip**. Clicking it opens that PRD rendered as Markdown, with an edit mode; the `PRDs (n)` button in the header lists every PRD on the board and starts a new one. A task with no PRD shows a dashed *Link a PRD* chip that opens the task detail, where the PRD is a dropdown.

## The board

Four columns — **Todo**, **Doing**, **Blocked**, **Done** — with a card per task. A card carries its title, its PRD chip, its priority, its labels, its comment count and the session that last worked on it.

The header holds the counts, a progress bar, the scope toggle, the PRD list, and a close button. Close (or Escape) returns to the conversation without touching the board; the sidebar icon reopens it.

## Task detail

Clicking a card opens a panel with the fields a Jira issue would have:

| | |
|---|---|
| Title | Editable inline |
| Status | Todo / Doing / Blocked / Done buttons |
| Owner | Free text, `agent` when the model claims it |
| Priority | `low`, `medium`, `high`, `urgent` |
| Labels | Comma-separated, shown as chips on the card |
| PRD | Dropdown over the board's PRDs |
| Sessions | Every session that touched the task, each one a link into that conversation |
| Description | Markdown, rendered |
| Comments | Author and timestamp per entry, with a box to add one |
| History | Every status change and progress note |

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
| `session_todo_prd` | Writes a PRD and returns its id. Without an id it updates the session's newest PRD, creating one when there is none; `fresh` starts another, an explicit id targets one. |
| `session_todo_task` | `add` (with `prdId`, `description`, `priority`, `labels`), `claim`, `progress`, `comment`, `edit`, `link`, `complete`, `block`, `reopen`, `remove`. |

The plugin also adds a short "Session todo board" section to the system prompt, so every step knows when to record the PRD, claim a task, log progress and close it — without you asking each time.

## The composer strip

Scoped to the conversation it sits in: counts and a progress bar for **this session's** tasks only, a **Board** button that opens the kanban, and a collapsed list of that session's unfinished work. The strip never grows — the list scrolls inside it, so a long board cannot push the composer off screen — and when the workspace holds tasks from other sessions it says how many, with a link to the full board.

## How the board is keyed

By the session's working directory. Every session and subagent in the same directory shares one board with no configuration; two different projects get two independent boards.

## Files it writes

`$DSH_HOME/session-todo/<hash>.json`, one file per workspace directory. Nothing leaves your machine.

## Self-check

```
node check.mjs
```

Drives PRD → add → claim → progress → complete against a stubbed tool registry, covers the PRD collection, comments, PRD links and the version 1 migration, exercises both routes and their origin guard, and renders the strip, the kanban, the task detail and the PRD sheet against a stub React. It writes into a temp directory it removes afterwards.
