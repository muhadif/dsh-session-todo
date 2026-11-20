/**
 * Host half: PRDs and a task board per workspace, written by agent tools and by the board UI, read
 * by everything. Boards are plugin-owned files under $DSH_HOME/session-todo/<hash of cwd>.json; the
 * session log stays untouched because a plugin cannot append its own event type.
 *
 * A PRD is an entity owned by the session that wrote it, and many tasks can point at one PRD
 * (`task.prdId`). That is why the board carries `prds[]` rather than a single document.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const STATUSES = ['todo', 'doing', 'blocked', 'done']
const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const ACTIONS = [
  'add', 'claim', 'progress', 'complete', 'block', 'reopen', 'remove', 'comment', 'edit', 'link',
]
const LIMITS = {
  prdTitle: 200,
  prdBody: 40_000,
  prds: 50,
  taskTitle: 240,
  description: 8_000,
  note: 1_500,
  tasks: 200,
  log: 40,
  sessions: 5,
  labels: 8,
  label: 32,
  comments: 50,
}
const SHOWN = 60
const ROUTE_PRD = 40_000
const PREVIEW = 200

/** Prompt text every agent sees: what the board is for and when to touch it. */
const PROMPT_SECTION = `## Session todo board
Each workspace has PRDs and a task board shared by every session working in that directory, through \`session_todo_board\` (read), \`session_todo_prd\` (write a PRD) and \`session_todo_task\` (add, claim, progress, complete, block, reopen, remove, comment, edit, link).
- When the user brings requirements or a spec, record the PRD before starting work; extend it when only part changed. A board holds several PRDs, each owned by the session that wrote it.
- Break the work into concrete tasks and pass the PRD's id as \`prdId\` so each task points at its spec.
- \`claim\` a task before working on it, and \`progress\` or \`comment\` with what you learned as you go.
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
  return { version: 2, cwd, prds: [], tasks: [], nextId: 1, nextPrdId: 1, updatedAt: now() }
}

/**
 * Read a stored board, upgrading the single-PRD format to the collection format. A version 1 board
 * had exactly one PRD for the whole board, so its tasks inherit that PRD as `P1`.
 */
function migrate(parsed) {
  if (parsed?.version === 2 && Array.isArray(parsed.tasks) && Array.isArray(parsed.prds)) return parsed
  if (parsed?.version !== 1 || !Array.isArray(parsed.tasks)) return null
  const at = parsed.prd?.updatedAt || parsed.updatedAt || now()
  const prds = parsed.prd?.body
    ? [{ id: 'P1', title: parsed.prd.title || '', body: parsed.prd.body, session: '', createdAt: at, updatedAt: at }]
    : []
  return {
    version: 2,
    cwd: parsed.cwd,
    prds,
    tasks: parsed.tasks.map(task => ({
      prdId: prds.length ? 'P1' : '',
      description: '',
      priority: '',
      labels: [],
      comments: [],
      ...task,
    })),
    nextId: parsed.nextId ?? parsed.tasks.length + 1,
    nextPrdId: prds.length + 1,
    updatedAt: parsed.updatedAt || now(),
  }
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
  if (board.prds.length) {
    lines.push('PRDs:')
    for (const prd of board.prds) {
      const owned = prd.session ? ` @${prd.session}` : ''
      const linked = board.tasks.filter(task => task.prdId === prd.id).length
      lines.push(`[${prd.id}] ${prd.title || '(untitled)'}${owned} — ${linked} task(s), ${prd.body.length} chars`)
    }
  } else {
    lines.push('PRDs: none yet.')
  }
  const shown = board.tasks.slice(0, SHOWN)
  for (const task of shown) {
    const owner = task.owner ? ` @${task.owner}` : ''
    const prd = task.prdId ? ` (${task.prdId})` : ''
    const extra = [task.priority && `!${task.priority}`, task.labels?.length && `#${task.labels.join(' #')}`]
      .filter(Boolean).join(' ')
    lines.push(`[${task.id}] ${task.status}${owner}${prd} — ${task.title}${extra ? ` — ${extra}` : ''}`)
    if (task.description) lines.push(`    desc: ${task.description.split('\n')[0].slice(0, PREVIEW)}`)
    if (task.note) lines.push(`    note: ${task.note}`)
    if (task.comments?.length) lines.push(`    ${task.comments.length} comment(s)`)
  }
  if (board.tasks.length > shown.length) {
    lines.push(`(${board.tasks.length - shown.length} more task(s) not shown)`)
  }
  return lines.join('\n')
}

/**
 * Remember which session touched a task, most recent first. The first entry is the session a card
 * links to; membership answers "did this session work on it", which the session-scope filter needs.
 */
function touchSession(task, sessionId) {
  const id = clip(sessionId, 64)
  if (!id) return
  const list = (task.sessions ?? []).filter(candidate => candidate !== id)
  list.unshift(id)
  task.sessions = list.slice(0, LIMITS.sessions)
}

const labelsOf = value => (Array.isArray(value) ? value : [])
  .map(label => clip(label, LIMITS.label))
  .filter(Boolean)
  .slice(0, LIMITS.labels)

/** Append tasks; returns their ids. The single implementation both callers share. */
function addTasks(board, wanted, owner = '', sessionId = '') {
  const items = Array.isArray(wanted) ? wanted : []
  if (!items.length) throw new Error('add needs at least one task')
  const added = []
  for (const item of items) {
    const title = clip(item?.title, LIMITS.taskTitle)
    if (!title) throw new Error('every task needs a title')
    if (board.tasks.length >= LIMITS.tasks) throw new Error(`the board is capped at ${LIMITS.tasks} tasks`)
    const prdId = clip(item?.prdId, 16)
    if (prdId && !board.prds.some(prd => prd.id === prdId)) throw new Error(`no PRD ${prdId} on this board`)
    const priority = clip(item?.priority, 16)
    if (priority && !PRIORITIES.includes(priority)) throw new Error(`unknown priority ${priority}`)
    const at = now()
    const task = {
      id: `T${board.nextId}`,
      title,
      status: 'todo',
      note: clip(item?.note, LIMITS.note),
      owner: clip(owner, 40),
      sessions: [],
      prdId,
      description: clip(item?.description, LIMITS.description),
      priority,
      labels: labelsOf(item?.labels),
      comments: [],
      createdAt: at,
      updatedAt: at,
      log: [{ at, status: 'todo', note: '' }],
    }
    touchSession(task, sessionId)
    board.nextId += 1
    board.tasks.push(task)
    added.push(task.id)
  }
  return added
}

/** Fields a task's own detail panel can change, beyond status. */
function editTask(task, patch = {}, at = now()) {
  if (patch.title !== undefined) {
    const title = clip(patch.title, LIMITS.taskTitle)
    if (!title) throw new Error('a task needs a title')
    task.title = title
  }
  if (patch.description !== undefined) task.description = clip(patch.description, LIMITS.description)
  if (patch.priority !== undefined) {
    const priority = clip(patch.priority, 16)
    if (priority && !PRIORITIES.includes(priority)) throw new Error(`unknown priority ${priority}`)
    task.priority = priority
  }
  if (patch.labels !== undefined) task.labels = labelsOf(patch.labels)
  if (patch.owner !== undefined) task.owner = clip(patch.owner, 40)
  task.updatedAt = at
}

/** Move tasks between statuses and record progress; returns one line per touched task. */
function updateTasks(board, ids, action, note = '', owner = 'agent', sessionId = '', extra = {}) {
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
      case 'comment':
        if (!text) throw new Error('comment needs a note')
        task.comments.push({ at, author: clip(owner, 40) || 'agent', body: text })
        if (task.comments.length > LIMITS.comments) {
          task.comments.splice(0, task.comments.length - LIMITS.comments)
        }
        task.updatedAt = at
        touched.push(`${id} commented`)
        continue
      case 'edit':
        editTask(task, extra, at)
        touched.push(`${id} edited`)
        continue
      case 'link': {
        const prdId = clip(extra.prdId, 16)
        if (prdId && !board.prds.some(prd => prd.id === prdId)) throw new Error(`no PRD ${prdId} on this board`)
        task.prdId = prdId
        task.updatedAt = at
        touched.push(`${id} → ${prdId || 'no PRD'}`)
        continue
      }
      case 'remove':
        board.tasks = board.tasks.filter(candidate => candidate.id !== id)
        touched.push(`${id} removed`)
        continue
    }
    task.updatedAt = at
    touchSession(task, sessionId)
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

/**
 * Write a PRD and return it. Without an id this updates the newest PRD the session owns, creating
 * one when the session has none; `fresh` forces a new PRD, and an explicit id targets another one.
 */
function writePrd(board, { id, title, body, mode, fresh } = {}, session = '') {
  const text = clip(body, LIMITS.prdBody)
  if (!text) throw new Error('PRD body must not be empty')
  const owned = board.prds.filter(prd => prd.session === session)
  const target = id
    ? board.prds.find(prd => prd.id === id)
    : fresh ? undefined : owned.at(-1)
  if (id && !target) throw new Error(`no PRD ${id} on this board`)
  if (target) {
    const merged = mode === 'append' ? `${target.body}\n\n${text}` : text
    target.body = merged.slice(0, LIMITS.prdBody)
    target.title = clip(title, LIMITS.prdTitle) || target.title
    target.updatedAt = now()
    return target
  }
  if (board.prds.length >= LIMITS.prds) throw new Error(`the board is capped at ${LIMITS.prds} PRDs`)
  const at = now()
  const prd = {
    id: `P${board.nextPrdId}`,
    title: clip(title, LIMITS.prdTitle),
    body: text,
    session: clip(session, 64),
    createdAt: at,
    updatedAt: at,
  }
  board.nextPrdId += 1
  board.prds.push(prd)
  return prd
}

export function apply(ctx, config = {}) {
  const boards = new Map()
  const queues = new Map()

  async function load(cwd) {
    try {
      const parsed = JSON.parse(await readFile(boardPath(cwd), 'utf8'))
      const board = migrate(parsed)
      if (board) return board
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

  /** The session that made this call, recorded on every task it touches. */
  const sessionOf = exec => exec.agent?.session?.header?.id ?? ''

  ctx.tools.register(defineTool({
    name: 'session_todo_board',
    description:
      'Read the todo board of this workspace: every PRD with its id and owning session, and every '
      + 'task with its status, owner, linked PRD, priority, labels and latest note. Read it before '
      + "starting work and after finishing a task. Another workspace's board can be read by path, "
      + 'which asks the user for approval first.',
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
      'Record or extend a PRD on this workspace board: the spec the work has to satisfy. Each PRD '
      + 'belongs to the session that wrote it and can back many tasks. Without an id it updates the '
      + 'PRD this session wrote last, creating one when there is none; pass `fresh` to start another '
      + 'PRD, or an `id` such as P2 to update a specific one. Returns the PRD id to pass as `prdId` '
      + 'when adding tasks.',
    parameters: {
      id: { type: 'string', description: 'PRD id to update, such as P2. Omit to target this session\'s PRD.' },
      title: { type: 'string', description: 'Short PRD title; omitted keeps the current one.' },
      body: { type: 'string', required: true, description: 'PRD body in Markdown.' },
      mode: {
        type: 'string',
        enum: ['replace', 'append'],
        description: 'replace (default) overwrites the body; append adds a section below it.',
      },
      fresh: { type: 'boolean', description: 'Start a new PRD instead of updating this session\'s last one.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      return mutate(cwd, board => {
        const prd = writePrd(board, args, sessionOf(exec))
        const verb = args.mode === 'append' ? 'extended' : 'saved'
        return render(board, `PRD ${prd.id} ${verb} (${prd.body.length} chars). Link tasks to it with prdId: ${prd.id}.`)
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Write the PRD', kind: 'write' }),
  }))

  ctx.tools.register(defineTool({
    name: 'session_todo_task',
    description:
      'Work the task list of this workspace board. add appends tasks (each may carry prdId, '
      + 'description, priority and labels) and returns their ids; claim marks a task as yours and in '
      + 'progress; progress records a note; comment adds a comment to the task; edit changes title, '
      + 'description, priority, labels or owner; link points the task at a PRD (empty prdId clears '
      + 'it); complete, block and reopen move a task; remove deletes it.',
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
            prdId: { type: 'string', description: 'PRD this task belongs to, such as P1.' },
            description: { type: 'string', description: 'Longer Markdown body for the task detail.' },
            priority: { type: 'string', enum: PRIORITIES, description: 'Task priority.' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Up to 8 short labels.' },
          },
        },
      },
      ids: {
        type: 'array',
        description: 'Task ids such as T3, as returned by add or by reading the board.',
        items: { type: 'string' },
      },
      note: { type: 'string', description: 'Progress note, comment body, or reason for blocking.' },
      owner: { type: 'string', description: 'Who works it; defaults to agent.' },
      title: { type: 'string', description: 'For edit: the new title.' },
      description: { type: 'string', description: 'For edit: the new description.' },
      priority: { type: 'string', enum: [...PRIORITIES, ''], description: 'For edit: the new priority, empty to clear.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'For edit: the full label list.' },
      prdId: { type: 'string', description: 'For link: the PRD id, empty to unlink.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      return mutate(cwd, board => {
        if (args.action === 'add') {
          const added = addTasks(board, args.tasks, 'agent', sessionOf(exec))
          return render(board, `Added ${added.join(', ')}.`)
        }
        const extra = {
          title: args.title,
          description: args.description,
          priority: args.priority,
          labels: args.labels,
          prdId: args.prdId,
        }
        const touched = updateTasks(
          board, args.ids, args.action, args.note, clip(args.owner, 40) || 'agent', sessionOf(exec), extra,
        )
        return render(board, `${args.action}: ${touched.join(', ')}.`)
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Todo ${args?.action ?? 'update'}${args?.ids?.length ? `: ${args.ids.join(', ')}` : ''}`,
      kind: 'write',
    }),
  }))

  /** PRD metadata for the board payload: the body is fetched per PRD by the detail route. */
  const prdSummary = board => board.prds.map(prd => ({
    id: prd.id,
    title: prd.title,
    session: prd.session,
    updatedAt: prd.updatedAt,
    length: prd.body.length,
    tasks: board.tasks.filter(task => task.prdId === prd.id).length,
  }))

  /** Host-side read used by the board and any HTTP reader; one shape, bounded previews. */
  async function boardView(cwd, sessionId = '') {
    const board = await readBoard(resolve(cwd))
    return {
      cwd: board.cwd,
      sessionId,
      updatedAt: board.updatedAt,
      counts: countOf(board),
      prds: prdSummary(board),
      tasks: board.tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        owner: task.owner,
        note: task.note,
        sessions: task.sessions ?? [],
        prdId: task.prdId ?? '',
        priority: task.priority ?? '',
        labels: task.labels ?? [],
        comments: (task.comments ?? []).length,
        description: (task.description ?? '').slice(0, PREVIEW),
        updatedAt: task.updatedAt,
        log: task.log.slice(-8),
      })),
    }
  }

  /** One full record for a detail panel; the board payload carries previews only. */
  async function detailView(cwd, kind, id) {
    const board = await readBoard(resolve(cwd))
    if (kind === 'prd') {
      const prd = board.prds.find(candidate => candidate.id === id)
      if (!prd) return null
      return { kind: 'prd', prd: { ...prd, body: prd.body.slice(0, ROUTE_PRD) } }
    }
    const task = board.tasks.find(candidate => candidate.id === id)
    if (!task) return null
    return {
      kind: 'task',
      task: { ...task, description: (task.description ?? '').slice(0, LIMITS.description) },
    }
  }

  /** Resolve the caller's workspace from its session id; a path is never accepted over HTTP. */
  function cwdOfSession(req) {
    const url = new URL(req.url ?? '/', 'http://local')
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const cwd = ctx.get('sessions')?.get(sessionId)?.header?.cwd
    return { url, sessionId, cwd }
  }

  /** Same-origin only: a random page in the user's browser must not rewrite a board. */
  function sameOrigin(req) {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      return new URL(origin).host === (req.headers.host ?? '')
    } catch {
      return false
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/session-todo/board',
        // A handler, not a resource: HTTP only reaches a resource with GET and HEAD, and the board
        // writes through this same path.
        async handler(req, res) {
          const reply = (body, status = 200) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(body))
          }
          // Only the caller's own session workspace is served: an arbitrary path here would let
          // any local page read another board, so cross-workspace reads stay a model action
          // behind the approval gate above.
          const { sessionId, cwd } = cwdOfSession(req)
          if (!cwd) return reply({ error: 'unknown-session' }, 404)
          if (req.method === 'GET') return reply(await boardView(cwd, sessionId))
          if (req.method !== 'POST') return reply({ error: 'method-not-allowed' }, 405)
          if (!sameOrigin(req)) return reply({ error: 'forbidden' }, 403)
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
                  addTasks(current, payload.tasks, 'you', sessionId)
                  break
                case 'task-action':
                  updateTasks(
                    current, payload.ids, payload.action, payload.note, 'you', sessionId,
                    {
                      title: payload.title,
                      description: payload.description,
                      priority: payload.priority,
                      labels: payload.labels,
                      prdId: payload.prdId,
                    },
                  )
                  break
                case 'prd':
                  writePrd(current, payload, sessionId)
                  break
                default:
                  throw new Error(`unknown op ${payload?.op}`)
              }
              return current
            })
            return reply(await boardView(board.cwd, sessionId))
          } catch (error) {
            return reply({ error: String(error?.message ?? error) }, 400)
          }
        },
      }),
    'session-todo: board route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/session-todo/detail',
        // One full PRD body or task, read on demand: the board payload stays small enough to poll.
        async handler(req, res) {
          const reply = (body, status = 200) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(body))
          }
          if (req.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405)
          const { url, cwd } = cwdOfSession(req)
          if (!cwd) return reply({ error: 'unknown-session' }, 404)
          const kind = url.searchParams.get('kind') === 'prd' ? 'prd' : 'task'
          const id = url.searchParams.get('id') ?? ''
          const detail = await detailView(cwd, kind, id)
          if (!detail) return reply({ error: 'not-found' }, 404)
          return reply(detail)
        },
      }),
    'session-todo: detail route',
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
