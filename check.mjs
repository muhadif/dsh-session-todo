/**
 * Runnable self-check for the Host board logic: registers the tools against a stubbed
 * `@deepseek-ai/dsh-tools` and a fake context, then drives PRD → add → claim → progress → complete,
 * the board's GET/POST route, session tracking, and on-disk persistence. Run with `node check.mjs`;
 * it writes into a temp directory and removes it afterwards.
 */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'session-todo-check-'))
try {
  const stub = join(dir, 'node_modules/@deepseek-ai/dsh-tools')
  await mkdir(stub, { recursive: true })
  await writeFile(join(stub, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.0', type: 'module', exports: './index.js' }))
  await writeFile(join(stub, 'index.js'), 'export const defineTool = definition => definition\n')
  await copyFile(new URL('./index.js', import.meta.url), join(dir, 'index.js'))

  process.env.DSH_HOME = join(dir, 'home')
  const { apply } = await import(join(dir, 'index.js'))

  const tools = new Map()
  let route
  let section
  const cwd = join(dir, 'ws')
  apply({
    tools: { register: definition => (tools.set(definition.name, definition), () => {}) },
    effect: (factory) => (factory(), () => {}),
    webServer: { register: (registered) => ((route = registered), () => {}) },
    get: name => {
      // Two sessions share this workspace, so a task can be touched by more than one of them.
      if (name === 'sessions') return { get: id => (['s1', 's2'].includes(id) ? { header: { id, cwd } } : undefined) }
      if (name === 'systemPrompt') return { section: definition => ((section = definition), () => {}) }
      return undefined
    },
  }, {})

  /** Drive the route handler with a Node-ish request and capture the JSON reply. */
  const call = async ({ method = 'GET', query = 'sessionId=s1', headers = {}, body } = {}) => {
    const req = { method, url: `/session-todo/board?${query}`, headers }
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    }
    const res = { statusCode: 0, payload: '' }
    res.writeHead = code => { res.statusCode = code }
    res.end = text => { res.payload = text ?? '' }
    await route.handler(req, res)
    return { status: res.statusCode, json: res.payload ? JSON.parse(res.payload) : null }
  }

  const exec = { agent: { session: { header: { id: 's1', cwd } } }, callId: 'c1', signal: new AbortController().signal }
  const board = tools.get('session_todo_board')
  const prd = tools.get('session_todo_prd')
  const task = tools.get('session_todo_task')
  assert.ok(board && prd && task, 'all three tools are registered')
  assert.equal(section?.name, 'session-todo')
  for (const name of ['session_todo_board', 'session_todo_prd', 'session_todo_task', 'claim', 'complete']) {
    assert.ok(section.text.includes(name), `prompt section names ${name}`)
  }

  await prd.execute({ body: '# Spec\nDo the thing.', title: 'Thing' }, exec)
  assert.match(await task.execute({ action: 'add', tasks: [{ title: 'Write it' }, { title: 'Test it' }] }, exec), /T1, T2/)
  await task.execute({ action: 'claim', ids: ['T1'], note: 'starting' }, exec)
  await task.execute({ action: 'progress', ids: ['T1'], note: 'halfway' }, exec)
  await task.execute({ action: 'complete', ids: ['T1'] }, exec)

  const text = await board.execute({}, exec)
  assert.match(text, /1\/2 done/, 'board reports one of two done')
  assert.match(text, /\[T2\] todo/, 'the untouched task stays todo')
  assert.match(text, /PRD: Thing/, 'PRD title is on the board')

  // Another workspace's board is refused without an approval service.
  await assert.rejects(() => board.execute({ workspace: join(dir, 'elsewhere') }, exec), /approval/)

  // The board reads the same data, and refuses a session it cannot resolve.
  const view = await call()
  assert.equal(view.status, 200)
  assert.equal(view.json.counts.done, 1)
  assert.equal(view.json.tasks.length, 2)
  assert.equal(view.json.prd.title, 'Thing')
  assert.equal(view.json.sessionId, 's1', 'the view names the session that asked')
  assert.deepEqual(view.json.tasks[0].sessions, ['s1'], 'the tool run recorded its session')
  assert.equal((await call({ query: 'sessionId=nope' })).status, 404)

  // The same route writes for a same-origin caller, and refuses another origin.
  const sameOrigin = { host: 'local', origin: 'http://local', 'content-type': 'application/json' }
  const addedTask = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-add', tasks: [{ title: 'From the strip' }] } })
  assert.equal(addedTask.status, 200)
  assert.equal(addedTask.json.tasks.length, 3)
  assert.equal(addedTask.json.tasks[2].owner, 'you')
  assert.deepEqual(addedTask.json.tasks[2].sessions, ['s1'], 'a task added from the UI records its session')
  const completed = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-action', action: 'complete', ids: ['T2'] } })
  assert.equal(completed.json.counts.done, 2)
  const rewritten = await call({ method: 'POST', headers: sameOrigin, body: { op: 'prd', title: 'Thing 2', body: 'new body', mode: 'replace' } })
  assert.equal(rewritten.json.prd.title, 'Thing 2')
  const foreign = await call({ method: 'POST', headers: { host: 'local', origin: 'https://evil.example', 'content-type': 'application/json' }, body: { op: 'task-add', tasks: [{ title: 'nope' }] } })
  assert.equal(foreign.status, 403)
  const bad = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-action', action: 'complete', ids: ['T99'] } })
  assert.match(bad.json.error, /no task T99/)
  assert.equal((await call({ method: 'PUT' })).status, 405)

  // A second session in the same workspace becomes the newest toucher but keeps the first as history.
  const fromS2 = await call({ method: 'POST', query: 'sessionId=s2', headers: sameOrigin, body: { op: 'task-action', action: 'progress', ids: ['T3'], note: 'picked up' } })
  const t3 = fromS2.json.tasks.find(entry => entry.id === 'T3')
  assert.deepEqual(t3.sessions, ['s2', 's1'], 'the latest session comes first and the earlier one stays')
  assert.equal(fromS2.json.sessionId, 's2')

  // The board is on disk, so a restart keeps it.
  const files = await readdir(join(dir, 'home/session-todo'))
  assert.equal(files.length, 1, 'exactly one board file')
  const stored = JSON.parse(await readFile(join(dir, 'home/session-todo', files[0]), 'utf8'))
  assert.equal(stored.tasks[0].status, 'done')
  assert.ok(stored.tasks[0].log.some(entry => entry.note === 'halfway'), 'progress note is in the task log')
  assert.deepEqual(stored.tasks[2].sessions, ['s2', 's1'], 'sessions are persisted with the task')
  assert.equal(stored.prd.title, 'Thing 2')

  // The Client half renders the strip and the board, so a throw there blanks the slot: render both
  // against a stub React and fail loudly on a bad tree.
  await copyFile(new URL('./client.js', import.meta.url), join(dir, 'client.js'))
  let factory
  globalThis.window = { __ModuleLoader__: { load: entry => { factory = entry.factory } } }
  await import(join(dir, 'client.js'))
  assert.ok(factory, 'client module registers a factory')

  const boardState = {
    cwd,
    sessionId: 's1',
    counts: { todo: 1, doing: 0, blocked: 0, done: 1 },
    prd: { title: 'Thing 2', body: 'new body', truncated: false },
    tasks: [
      { id: 'T1', title: 'Done one', status: 'done', owner: 'agent', note: '', sessions: ['s2'], log: [{ at: new Date().toISOString(), status: 'done', note: '' }] },
      { id: 'T2', title: 'Open one', status: 'todo', owner: '', note: '', sessions: ['s1'], log: [] },
    ],
  }

  /** Render one registered component; `overrides` feed its useState calls in order. */
  const render = (key, overrides, props = {}) => {
    let index = 0
    const React = {
      createElement: (type, nodeProps, ...children) => ({ type, props: nodeProps ?? {}, children }),
      useState: initial => {
        const value = index < overrides.length ? overrides[index] : undefined
        index += 1
        return [value === undefined ? initial : value, () => {}]
      },
      useEffect: () => {},
    }
    const client = factory(() => React)
    const registrations = new Map()
    let dict = {}
    client.apply({
      effect: effect => (effect(), () => {}),
      locale: { register: (_ns, dicts) => ((dict = dicts.en), () => {}), bind: () => key => key },
      slots: {
        inject: (_slot, callback) => (callback(), () => {}),
        register: (options, component) => (registrations.set(`${options.name}:${options.key ?? options.id}`, component), () => {}),
      },
    })
    const Component = registrations.get(key)
    assert.ok(Component, `${key} registers a component`)
    return Component({ ...props, t: name => dict[name] })
  }

  /** Flatten a rendered tree into its text, so assertions read like the user sees it. */
  const treeText = node => {
    if (node == null || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(treeText).join(' ')
    if (typeof node.type === 'function') return treeText(node.type({ ...node.props, children: node.children }))
    return (node.children ?? []).map(treeText).join(' ')
  }

  let opened = ''
  const useSessions = selector => selector({
    byId: {
      s1: { id: 's1', displayTitle: 'Current session', retainedBy: { mainView: 1 } },
      s2: { id: 's2', displayTitle: 'Earlier session', retainedBy: {} },
    },
  })

  const collapsed = render('conversation.composer.dock:session-todo', [boardState, '', false, false], { sessionId: 's1' })
  assert.match(treeText(collapsed), /1 of 2 done/, 'strip keeps the finished count')
  assert.doesNotMatch(treeText(collapsed), /Open one/, 'collapsed strip lists nothing')

  const expanded = render('conversation.composer.dock:session-todo', [boardState, '', false, true], { sessionId: 's1' })
  assert.match(treeText(expanded), /Open one/, 'open strip lists the pending task')
  assert.doesNotMatch(treeText(expanded), /Done one/, 'finished task stays out of the strip')

  // The board panel: four columns, the workspace scope by default, and a link to each task's session.
  const kanban = render('main:session-todo', [boardState, '', false, 'workspace'], {
    useSessions,
    openSession: id => (opened = id),
  })
  const kanbanText = treeText(kanban)
  for (const column of ['Todo', 'Doing', 'Blocked', 'Done']) {
    assert.ok(kanbanText.includes(column), `the board renders the ${column} column`)
  }
  assert.match(kanbanText, /Open one/, 'workspace scope shows every task')
  assert.match(kanbanText, /Done one/, 'done tasks keep their own column')
  assert.match(kanbanText, /Earlier session/, 'a card names the session that worked on it')
  assert.match(kanbanText, /Workspace/, 'the scope toggle is offered')
  assert.match(kanbanText, /This session/, 'the session scope is offered')

  const scoped = render('main:session-todo', [boardState, '', false, 'session'], { useSessions, openSession: () => {} })
  assert.match(treeText(scoped), /Open one/, 'the current session keeps the task it touched')
  assert.doesNotMatch(treeText(scoped), /Done one/, 'the current session hides a task it never touched')

  // The session button on a card navigates to that session.
  const findSessionButton = node => {
    if (node == null || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findSessionButton(child)
        if (hit) return hit
      }
      return null
    }
    if (typeof node.type === 'function') return findSessionButton(node.type({ ...node.props, children: node.children }))
    const className = node.props?.className
    if (typeof className === 'string' && className.startsWith('st-session') && node.props?.onClick && node.props.title?.includes('Earlier session')) {
      return node.props.onClick
    }
    return (node.children ?? []).map(findSessionButton).find(Boolean) ?? null
  }
  const openEarlier = findSessionButton(kanban)
  assert.ok(openEarlier, 'a card offers a button to open its session')
  openEarlier()
  assert.equal(opened, 's2', 'the button opens the session recorded on that card')

  console.log('check ok: PRD, tasks, claims, sessions per task, route read/write + origin guard, persistence, strip + kanban render')
} finally {
  await rm(dir, { recursive: true, force: true })
}
