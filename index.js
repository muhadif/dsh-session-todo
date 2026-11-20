/**
 * Host half: one PRD + task board per workspace, written by agent tools and by the composer strip,
 * read by everything. Boards are plugin-owned files under $DSH_HOME/session-todo/<hash of cwd>.json;
 * the session log stays untouched because a plugin cannot append its own event type.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const STATUSES = ['todo', 'doing', 'blocked', 'done']
const ACTIONS = ['add', 'claim', 'progress', 'complete', 'block', 'reopen', 'remove']
const LIMITS = { prdTitle: 200, prdBody: 40_000, taskTitle: 240, note: 1_500, tasks: 200, log: 40 }
const SHOWN = 60
const ROUTE_PRD = 4_000

/** Prompt text every agent sees: what the board is for and when to touch it. */
const PROMPT_SECTION = `## Session todo board
Each workspace has a PRD and task board shared by every session working in that directory, through \`session_todo_board\` (read), \`session_todo_prd\` (write the PRD) and \`session_todo_task\` (add, claim, progress, complete, block, reopen, remove).
- When the user brings requirements or a spec, record the PRD before starting work; extend it when only part changed.
- Break the work into concrete tasks, \`claim\` a task before working on it, and \`progress\` with what you learned as you go.
- \`complete\` each task as soon as it is done; read the board when you resume, after compaction, or before reporting status.
- Another workspace's board is a read that asks the user for approval.`

export const inject = ['tools', 'webServer']

const storeDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'session-todo')
const boardPath = cwd => join(storeDir(), `${createHash('sha256').update(cwd).digest('hex').slice(0, 20)}.json`)
const clip = (value, max) => String(value ?? '').trim().slice(0, max)
const now = () => new Date().toISOString()

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

function emptyBoard(cwd) {
  return { version: 1, cwd, prd: null, tasks: [], nextId: 1, updatedAt: now() }
}

function countOf(board) {
  const out = { todo: 0, doing: 0, blocked: 0, done: 0 }
  for (const task of board.tasks) out[task.status] = (out[task.status] ?? 0) + 1
  return out
}

/** Bounded markdown the model reads after every call; the whole board, or a disclosed prefix. */
function render(board, headline) {
  const counts = countOf(board)
  const lines = [headline]
  lines.push(
    `Board: ${board.cwd} — ${counts.done}/${board.tasks.length} done, ${counts.doing} doing, `
    + `${counts.blocked} blocked, ${counts.todo} todo.`,
  )
  if (board.prd) {
    lines.push(`PRD: ${board.prd.title || '(untitled)'} (updated ${board.prd.updatedAt}, ${board.prd.body.length} chars)`)
  } else {
    lines.push('PRD: none yet.')
  }
  const shown = board.tasks.slice(0, SHOWN)
  for (const task of shown) {
    const owner = task.owner ? ` @${task.owner}` : ''
    lines.push(`[${task.id}] ${task.status}${owner} — ${task.title}`)
    if (task.note) lines.push(`    note: ${task.note}`)
  }
  if (board.tasks.length > shown.length) {
    lines.push(`(${board.tasks.length - shown.length} more task(s) not shown)`)
  }
  return lines.join('\n')
}

/** Append tasks; returns their ids. The single implementation both callers share. */
function addTasks(board, wanted, owner = '') {
  const items = Array.isArray(wanted) ? wanted : []
  if (!items.length) throw new Error('add needs at least one task')
  const added = []
  for (const item of items) {
    const title = clip(item?.title, LIMITS.taskTitle)
    if (!title) throw new Error('every task needs a title')
    if (board.tasks.length >= LIMITS.tasks) throw new Error(`the board is capped at ${LIMITS.tasks} tasks`)
    const at = now()
    const task = {
      id: `T${board.nextId}`,
      title,
      status: 'todo',
      note: clip(item?.note, LIMITS.note),
      owner: clip(owner, 40),
      createdAt: at,
      updatedAt: at,
      log: [{ at, status: 'todo', note: '' }],
    }
    board.nextId += 1
    board.tasks.push(task)
    added.push(task.id)
  }
  return added
}

/** Move tasks between statuses and record progress; returns one line per touched task. */
function updateTasks(board, ids, action, note = '', owner = 'agent') {
  const wanted = (Array.isArray(ids) ? ids : []).map(id => clip(id, 24)).filter(Boolean)
  if (!wanted.length) throw new Error(`${action} needs ids`)
  if (!ACTIONS.includes(action) || action === 'add') throw new Error(`unknown action ${action}`)
  const text = clip(note, LIMITS.note)
  const touched = []
  for (const id of wanted) {
    const task = board.tasks.find(candidate => candidate.id === id)
    if (!task) throw new Error(`no task ${id} on this board`)
    const at = now()
    switch (action) {
      case 'claim':
        task.status = 'doing'
        task.owner = clip(owner, 40) || 'agent'
        break
      case 'progress':
        if (text) task.note = text
        break
      case 'complete':
        task.status = 'done'
        break
      case 'block':
        task.status = 'blocked'
        if (text) task.note = text
        break
      case 'reopen':
        task.status = 'todo'
        task.owner = ''
        break
      case 'remove':
        board.tasks = board.tasks.filter(candidate => candidate.id !== id)
        touched.push(`${id} removed`)
        continue
    }
    task.updatedAt = at
    if (text) {
      task.log.push({ at, status: task.status, note: text })
      if (task.log.length > LIMITS.log) task.log.splice(0, task.log.length - LIMITS.log)
    } else if (task.log.at(-1)?.status !== task.status) {
      task.log.push({ at, status: task.status, note: '' })
    }
    touched.push(`${id} → ${task.status}`)
  }
  return touched
}

/** Replace or extend the PRD; returns its length. */
function setPrd(board, { title, body, mode } = {}) {
  const text = clip(body, LIMITS.prdBody)
  if (!text) throw new Error('PRD body must not be empty')
  const nextTitle = clip(title, LIMITS.prdTitle) || board.prd?.title || ''
  const merged = mode === 'append' && board.prd ? `${board.prd.body}\n\n${text}` : text
  board.prd = { title: nextTitle, body: merged.slice(0, LIMITS.prdBody), updatedAt: now() }
  return board.prd.body.length
}

export function apply(ctx, config = {}) {
  const boards = new Map()
  const queues = new Map()

  async function load(cwd) {
    try {
      const parsed = JSON.parse(await readFile(boardPath(cwd), 'utf8'))
      if (parsed?.version === 1 && Array.isArray(parsed.tasks)) return parsed
    } catch {
      // A missing or unreadable file is a fresh board; the next write replaces it.
    }
    return emptyBoard(cwd)
  }

  async function save(board) {
    board.updatedAt = now()
    const path = boardPath(board.cwd)
    await mkdir(storeDir(), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
    await rename(tmp, path)
  }

  async function readBoard(cwd) {
    const cached = boards.get(cwd)
    if (cached) return cached
    const board = await load(cwd)
    boards.set(cwd, board)
    return board
  }

  /**
   * Serialize every mutation of one workspace board: the callback mutates synchronously, so two
   * concurrent callers can never interleave a read-modify-write inside this process.
   */
  function mutate(cwd, fn) {
    const previous = queues.get(cwd) ?? Promise.resolve()
    const next = previous.then(async () => {
      const board = await readBoard(cwd)
      const out = fn(board)
      await save(board)
      return out
    })
    queues.set(cwd, next.then(() => undefined, () => undefined))
    return next
  }

  function cwdOf(exec) {
    const cwd = exec.agent?.session?.header?.cwd
    if (!cwd) throw new Error('session todo needs a session with a working directory')
    return resolve(cwd)
  }

  ctx.tools.register(defineTool({
    name: 'session_todo_board',
    description:
      'Read the todo board of this workspace: the PRD and every task with its status, owner and '
      + 'latest progress note. Read it before starting work and after finishing a task. Another '
      + "workspace's board can be read by path, which asks the user for approval first.",
    parameters: {
      workspace: {
        type: 'string',
        description: 'Absolute path of another workspace whose board to read; requires user approval.',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const own = cwdOf(exec)
      const target = args.workspace ? resolve(args.workspace) : own
      if (target !== own) {
        const approval = ctx.get('approval')
        if (!approval) throw new Error('reading another workspace needs approval, and this profile has no approval service')
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: 'session_todo_board',
          callId: exec.callId,
          reason: `Read the todo board of another workspace: ${target}`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') throw new Error(`cross-workspace board read denied (${outcome})`)
      }
      const board = await readBoard(target)
      return render(board, target === own ? 'This workspace board.' : 'Read-only view of another workspace board.')
    },
    presentCall: args => ({
      card: 'generic',
      title: args?.workspace ? `Read todo board: ${args.workspace}` : 'Read todo board',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'session_todo_prd',
    description:
      'Record or extend the PRD of this workspace board: the spec the work has to satisfy. Use it '
      + 'when the user brings requirements, and extend it instead of rewriting when only part changed.',
    parameters: {
      title: { type: 'string', description: 'Short PRD title; omitted keeps the current one.' },
      body: { type: 'string', required: true, description: 'PRD body in Markdown.' },
      mode: {
        type: 'string',
        enum: ['replace', 'append'],
        description: 'replace (default) overwrites the body; append adds a section below it.',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      return mutate(cwd, board => {
        const length = setPrd(board, args)
        return render(board, `PRD ${args.mode === 'append' ? 'extended' : 'saved'} (${length} chars).`)
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Write the PRD', kind: 'write' }),
  }))

  ctx.tools.register(defineTool({
    name: 'session_todo_task',
    description:
      'Work the task list of this workspace board. add appends tasks and returns their ids; claim '
      + 'marks a task as yours and in progress; progress records a note (and optionally a new '
      + 'status); complete, block and reopen move a task; remove deletes it.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ACTIONS,
        description: 'add needs `tasks`; every other action needs `ids`.',
      },
      tasks: {
        type: 'array',
        description: 'For add: the tasks to append, in order.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'One imperative line.' },
            note: { type: 'string', description: 'Optional detail: scope, file, acceptance check.' },
          },
        },
      },
      ids: {
        type: 'array',
        description: 'Task ids such as T3, as returned by add or by reading the board.',
        items: { type: 'string' },
      },
      note: { type: 'string', description: 'Progress note, reason for blocking, or claim intent.' },
      owner: { type: 'string', description: 'Who works it; defaults to agent.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      return mutate(cwd, board => {
        if (args.action === 'add') {
          const added = addTasks(board, args.tasks)
          return render(board, `Added ${added.join(', ')}.`)
        }
        const touched = updateTasks(board, args.ids, args.action, args.note, clip(args.owner, 40) || 'agent')
        return render(board, `${args.action}: ${touched.join(', ')}.`)
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Todo ${args?.action ?? 'update'}${args?.ids?.length ? `: ${args.ids.join(', ')}` : ''}`,
      kind: 'write',
    }),
  }))

  /** Host-side read used by both the strip and any HTTP reader; one shape, bounded PRD. */
  async function boardView(cwd) {
    const board = await readBoard(resolve(cwd))
    const body = board.prd?.body ?? ''
    return {
      cwd: board.cwd,
      updatedAt: board.updatedAt,
      counts: countOf(board),
      prd: board.prd
        ? { title: board.prd.title, body: body.slice(0, ROUTE_PRD), truncated: body.length > ROUTE_PRD }
        : null,
      tasks: board.tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        owner: task.owner,
        note: task.note,
        log: task.log.slice(-8),
      })),
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/session-todo/board',
        // A handler, not a resource: HTTP only reaches a resource with GET and HEAD, and the strip
        // writes through this same path.
        async handler(req, res) {
          const reply = (body, status = 200) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(body))
          }
          const url = new URL(req.url ?? '/', 'http://local')
          // Only the caller's own session workspace is served: an arbitrary path here would let
          // any local page read another board, so cross-workspace reads stay a model action
          // behind the approval gate above.
          const sessionId = url.searchParams.get('sessionId') ?? ''
          const cwd = ctx.get('sessions')?.get(sessionId)?.header?.cwd
          if (!cwd) return reply({ error: 'unknown-session' }, 404)
          if (req.method === 'GET') return reply(await boardView(cwd))
          if (req.method !== 'POST') return reply({ error: 'method-not-allowed' }, 405)
          // Same-origin only: a random page in the user's browser must not be able to POST here
          // and rewrite a board (the response carries no CORS headers either).
          const origin = req.headers.origin
          if (origin) {
            let fromPage = false
            try {
              fromPage = new URL(origin).host === (req.headers.host ?? '')
            } catch {
              fromPage = false
            }
            if (!fromPage) return reply({ error: 'forbidden' }, 403)
          }
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          let payload
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            return reply({ error: 'invalid-json' }, 400)
          }
          try {
            const board = await mutate(cwd, current => {
              switch (payload?.op) {
                case 'task-add':
                  addTasks(current, payload.tasks, 'you')
                  break
                case 'task-action':
                  updateTasks(current, payload.ids, payload.action, payload.note, 'you')
                  break
                case 'prd':
                  setPrd(current, payload)
                  break
                default:
                  throw new Error(`unknown op ${payload?.op}`)
              }
              return current
            })
            return reply(await boardView(board.cwd))
          } catch (error) {
            return reply({ error: String(error?.message ?? error) }, 400)
          }
        },
      }),
    'session-todo: board route',
  )

  // Tell every agent the board exists and when to use it; without this the tools are available but
  // rarely picked up. Kept to a few lines because it lands in every step's prompt.
  const prompt = ctx.get('systemPrompt')
  if (prompt) {
    ctx.effect(
      () => prompt.section({ name: 'session-todo', order: 60, text: PROMPT_SECTION }),
      'session-todo: prompt section',
    )
  }

  if (config?.debug) ctx.logger?.info?.('session-todo: boards live in %s', storeDir())
}
