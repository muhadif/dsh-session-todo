/**
 * Runnable self-check for the Host board logic: registers the tools against a stubbed
 * `@deepseek-ai/dsh-tools` and a fake context, then drives PRD → add → claim → progress → complete,
 * the strip's GET/POST route, and on-disk persistence. Run with `node check.mjs`; it writes into a
 * temp directory and removes it afterwards.
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
      if (name === 'sessions') return { get: id => (id === 's1' ? { header: { cwd } } : undefined) }
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

  const exec = { agent: { session: { header: { cwd } } }, callId: 'c1', signal: new AbortController().signal }
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

  // The strip reads the same board, and refuses a session it cannot resolve.
  const view = await call()
  assert.equal(view.status, 200)
  assert.equal(view.json.counts.done, 1)
  assert.equal(view.json.tasks.length, 2)
  assert.equal(view.json.prd.title, 'Thing')
  assert.equal((await call({ query: 'sessionId=nope' })).status, 404)

  // The same route writes for a same-origin caller, and refuses another origin.
  const sameOrigin = { host: 'local', origin: 'http://local', 'content-type': 'application/json' }
  const addedTask = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-add', tasks: [{ title: 'From the strip' }] } })
  assert.equal(addedTask.status, 200)
  assert.equal(addedTask.json.tasks.length, 3)
  assert.equal(addedTask.json.tasks[2].owner, 'you')
  const completed = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-action', action: 'complete', ids: ['T2'] } })
  assert.equal(completed.json.counts.done, 2)
  const rewritten = await call({ method: 'POST', headers: sameOrigin, body: { op: 'prd', title: 'Thing 2', body: 'new body', mode: 'replace' } })
  assert.equal(rewritten.json.prd.title, 'Thing 2')
  const foreign = await call({ method: 'POST', headers: { host: 'local', origin: 'https://evil.example', 'content-type': 'application/json' }, body: { op: 'task-add', tasks: [{ title: 'nope' }] } })
  assert.equal(foreign.status, 403)
  const bad = await call({ method: 'POST', headers: sameOrigin, body: { op: 'task-action', action: 'complete', ids: ['T99'] } })
  assert.match(bad.json.error, /no task T99/)
  assert.equal((await call({ method: 'PUT' })).status, 405)

  // The board is on disk, so a restart keeps it.
  const files = await readdir(join(dir, 'home/session-todo'))
  assert.equal(files.length, 1, 'exactly one board file')
  const stored = JSON.parse(await readFile(join(dir, 'home/session-todo', files[0]), 'utf8'))
  assert.equal(stored.tasks[0].status, 'done')
  assert.ok(stored.tasks[0].log.some(entry => entry.note === 'halfway'), 'progress note is in the task log')
  assert.equal(stored.prd.title, 'Thing 2')

  // The Client half renders in the composer dock, so a throw there blanks the slot: render both
  // strip states against a stub React and fail loudly on a bad tree.
  await copyFile(new URL('./client.js', import.meta.url), join(dir, 'client.js'))
  let factory
  globalThis.window = { __ModuleLoader__: { load: entry => { factory = entry.factory } } }
  await import(join(dir, 'client.js'))
  assert.ok(factory, 'client module registers a factory')

  const boardState = {
    cwd,
    counts: { todo: 1, doing: 0, blocked: 0, done: 1 },
    prd: { title: 'Thing 2', body: 'new body', truncated: false },
    tasks: [
      { id: 'T1', title: 'Done one', status: 'done', owner: 'agent', note: '', log: [{ at: new Date().toISOString(), status: 'done', note: '' }] },
      { id: 'T2', title: 'Open one', status: 'todo', owner: '', note: '', log: [] },
    ],
  }
  const renderStrip = ({ open, showDone }) => {
    let index = 0
    const state = [boardState, open, false, { title: '', body: '' }, '', '', showDone]
    const React = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useState: () => [state[index++], () => {}],
      useEffect: () => {},
    }
    const client = factory(() => React)
    let Component
    let dict = {}
    client.apply({
      effect: factoryFn => (factoryFn(), () => {}),
      locale: { register: (_ns, dicts) => ((dict = dicts.en), () => {}) },
      slots: { inject: (_key, callback) => (callback(), () => {}), register: (_options, component) => ((Component = component), () => {}) },
    })
    assert.ok(Component, 'strip registers into the composer dock')
    return Component({ sessionId: 's1', t: key => dict[key] })
  }

  /** Flatten a rendered tree into its text, so assertions read like the user sees it. */
  const treeText = node => {
    if (node == null || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(treeText).join(' ')
    return (node.children ?? []).map(treeText).join(' ')
  }

  const collapsed = renderStrip({ open: false, showDone: false })
  assert.match(treeText(collapsed), /1 of 2 done/, 'header keeps the finished count')
  assert.doesNotMatch(treeText(collapsed), /Open one/, 'collapsed strip lists nothing')

  const expanded = renderStrip({ open: true, showDone: false })
  assert.match(treeText(expanded), /Open one/, 'open strip lists the pending task')
  assert.doesNotMatch(treeText(expanded), /Done one/, 'finished task is hidden by default')
  assert.match(treeText(expanded), /finished|Done \(1\)|{count}/, 'finished toggle is offered')
  const scroller = JSON.stringify(expanded, (key, value) => (typeof value === 'function' ? undefined : value))
  assert.match(scroller, /maxHeight/, 'the body is height-capped')
  assert.match(scroller, /overflowY":"auto"/, 'the body scrolls instead of growing')

  const shown = renderStrip({ open: true, showDone: true })
  assert.match(treeText(shown), /Done one/, 'the toggle brings finished tasks back')

  console.log('check ok: PRD, tasks, claims, strip route read/write + origin guard, persistence, strip render')
} finally {
  await rm(dir, { recursive: true, force: true })
}
