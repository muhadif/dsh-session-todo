/**
 * Runnable self-check for the Host board logic: registers the tools against a stubbed
 * `@deepseek-ai/dsh-tools` and a fake context, then drives PRD → add → claim → progress → complete,
 * the board's GET/POST route, session tracking, and on-disk persistence. Run with `node check.mjs`;
 * it writes into a temp directory and removes it afterwards.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
  const routes = new Map()
  let section
  const cwd = join(dir, 'ws')
  const legacyCwd = join(dir, 'legacy')
  apply({
    tools: { register: definition => (tools.set(definition.name, definition), () => {}) },
    effect: (factory) => (factory(), () => {}),
    webServer: { register: (registered) => (routes.set(registered.path, registered), () => {}) },
    get: name => {
      // Two sessions share this workspace, so a task can be touched by more than one of them.
      if (name === 'sessions') {
        return {
          get: id => (['s1', 's2'].includes(id)
            ? { header: { id, cwd } }
            : id === 's3' ? { header: { id, cwd: legacyCwd } } : undefined),
        }
      }
      if (name === 'systemPrompt') return { section: definition => ((section = definition), () => {}) }
      return undefined
    },
  }, {})

  /** Drive the route handler with a Node-ish request and capture the JSON reply. */
  const call = async ({ method = 'GET', query = 'sessionId=s1', headers = {}, body, path } = {}) => {
    const url = path ?? `/session-todo/board?${query}`
    const req = { method, url, headers }
    req[Symbol.asyncIterator] = async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    }
    const res = { statusCode: 0, payload: '' }
    res.writeHead = code => { res.statusCode = code }
    res.end = text => { res.payload = text ?? '' }
    const route = routes.get(url.split('?')[0])
    assert.ok(route, `a route is registered for ${url.split('?')[0]}`)
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

  const prdReply = await prd.execute({ body: '# Spec\nDo the thing.', title: 'Thing' }, exec)
  assert.match(prdReply, /PRD P1 saved/, 'the first PRD gets the id P1')
  assert.match(await task.execute({ action: 'add', tasks: [
    { title: 'Write it', prdId: 'P1', priority: 'high', labels: ['api', 'spec'] },
    { title: 'Test it', prdId: 'P1', description: 'Cover the happy path.' },
  ] }, exec), /T1, T2/)
  await task.execute({ action: 'claim', ids: ['T1'], note: 'starting' }, exec)
  await task.execute({ action: 'progress', ids: ['T1'], note: 'halfway' }, exec)
  await task.execute({ action: 'complete', ids: ['T1'] }, exec)

  const text = await board.execute({}, exec)
  assert.match(text, /1\/2 done/, 'board reports one of two done')
  assert.match(text, /\[T2\] todo/, 'the untouched task stays todo')
  assert.match(text, /\[P1\] Thing/, 'the board lists the PRD with its id')
  assert.match(text, /\[T1\] done @agent \(P1\)/, 'a task shows the PRD it belongs to')
  assert.match(text, /#api #spec/, 'labels reach the model')

  // A second PRD, owned by the session that wrote it, leaves the first alone.
  const second = await prd.execute({ body: '# Other spec', title: 'Other', fresh: true }, exec)
  assert.match(second, /PRD P2 saved/)
  assert.match(await prd.execute({ body: '# Other spec v2', title: 'Other' }, exec), /PRD P2/, 'without an id the session updates its newest PRD')
  assert.match(await prd.execute({ body: 'P1 body again', title: 'Thing', id: 'P1' }, exec), /PRD P1/, 'an explicit id targets that PRD')

  // Task detail: description, priority, labels, comment, and a PRD link.
  await task.execute({ action: 'edit', ids: ['T2'], priority: 'urgent', labels: ['test'], description: 'Deep detail.' }, exec)
  await task.execute({ action: 'comment', ids: ['T2'], note: 'first comment' }, exec)
  await task.execute({ action: 'link', ids: ['T2'], prdId: 'P2' }, exec)

  // Another workspace's board is refused without an approval service.
  await assert.rejects(() => board.execute({ workspace: join(dir, 'elsewhere') }, exec), /approval/)

  // The board reads the same data, and refuses a session it cannot resolve.
  const view = await call()
  assert.equal(view.status, 200)
  assert.equal(view.json.counts.done, 1)
  assert.equal(view.json.tasks.length, 2)
  assert.equal(view.json.prds[0].title, 'Thing', 'the board lists the PRD title')
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
  const rewritten = await call({ method: 'POST', headers: sameOrigin, body: { op: 'prd', id: 'P1', title: 'Thing 2', body: 'new body', mode: 'replace' } })
  assert.equal(rewritten.json.prds[0].title, 'Thing 2')
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
  assert.equal(stored.prds[0].title, 'Thing 2', 'PRDs are persisted')
  assert.equal(stored.version, 2, 'the board is written in the current format')
  assert.deepEqual(stored.tasks.find(task => task.id === 'T2').comments.map(entry => entry.body), ['first comment'])

  // A version 1 board (one PRD for the whole board) upgrades on read, and its tasks inherit P1.
  const legacyPath = join(dir, 'home/session-todo', `${createHash('sha256').update(legacyCwd).digest('hex').slice(0, 20)}.json`)
  await writeFile(legacyPath, JSON.stringify({
    version: 1,
    cwd: legacyCwd,
    prd: { title: 'Old spec', body: 'old body', updatedAt: new Date().toISOString() },
    tasks: [{ id: 'T1', title: 'Old task', status: 'todo', note: '', owner: '', sessions: [], createdAt: '', updatedAt: '', log: [] }],
    nextId: 2,
  }), 'utf8')
  const legacyView = await call({ query: 'sessionId=s3' })
  assert.equal(legacyView.status, 200)
  assert.equal(legacyView.json.prds[0].id, 'P1', 'the old single PRD becomes P1')
  assert.equal(legacyView.json.prds[0].title, 'Old spec')
  assert.equal(legacyView.json.tasks[0].prdId, 'P1', 'existing tasks inherit the migrated PRD')

  // The Client half renders the strip and the board, so a throw there blanks the slot: render both
  // against a stub React and fail loudly on a bad tree.
  await copyFile(new URL('./client.js', import.meta.url), join(dir, 'client.js'))
  let factory
  const keyHandlers = []
  globalThis.window = {
    __ModuleLoader__: { load: entry => { factory = entry.factory } },
    addEventListener: (type, handler) => { if (type === 'keydown') keyHandlers.push(handler) },
    removeEventListener: () => {},
  }
  await import(join(dir, 'client.js'))
  assert.ok(factory, 'client module registers a factory')

  const boardState = {
    cwd,
    sessionId: 's1',
    counts: { todo: 1, doing: 0, blocked: 0, done: 1 },
    prds: [
      { id: 'P1', title: 'Thing 2', session: 's1', updatedAt: new Date().toISOString(), length: 8, tasks: 2 },
      { id: 'P2', title: 'Second spec', session: 's2', updatedAt: new Date().toISOString(), length: 20, tasks: 1 },
    ],
    tasks: [
      { id: 'T1', title: 'Done one', status: 'done', owner: 'agent', note: '', sessions: ['s2'], prdId: 'P2', priority: 'high', labels: ['api'], comments: 2, description: '', log: [{ at: new Date().toISOString(), status: 'done', note: '' }] },
      { id: 'T2', title: 'Open one', status: 'todo', owner: '', note: '', sessions: ['s1'], prdId: 'P1', priority: '', labels: [], comments: 0, description: '', log: [] },
      { id: 'T3', title: 'Legacy one', status: 'blocked', owner: '', note: '', log: [] },
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
      // Run the effect body and its cleanup at once: subscriptions stay observable through the
      // stub's addEventListener, and the poll interval is cleared so the process can exit.
      useEffect: effect => {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanup()
      },
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

  // The strip counts only this session's tasks: T2 is s1's, T1 belongs to s2, T3 has no session.
  const collapsed = render('conversation.composer.dock:session-todo', [boardState, '', false, false], { sessionId: 's1' })
  assert.match(treeText(collapsed), /0 of 1 done/, 'strip counts this session only')
  assert.doesNotMatch(treeText(collapsed), /Open one/, 'collapsed strip lists nothing')

  const expanded = render('conversation.composer.dock:session-todo', [boardState, '', false, true], { sessionId: 's1' })
  assert.match(treeText(expanded), /Open one/, 'open strip lists the pending task of this session')
  assert.doesNotMatch(treeText(expanded), /Done one/, 'a task from another session stays out of the strip')
  assert.doesNotMatch(treeText(expanded), /Legacy one/, 'a task with no session stays out of the strip')
  assert.match(treeText(expanded), /2 more in the workspace/, 'the strip says how much it leaves to the board')

  // A session that has done nothing of its own still sees its own empty state.
  const idle = render('conversation.composer.dock:session-todo', [boardState, '', false, true], { sessionId: 's9' })
  assert.match(treeText(idle), /Nothing claimed or added by this session yet/, 'an idle session says so')
  assert.match(treeText(idle), /3 more in the workspace/, 'and still points at the board')

  // The board panel: four columns, the workspace scope by default, and a link to each task's session.
  let closed = 0
  const kanban = render('main:session-todo', [boardState, '', false, 'workspace'], {
    useSessions,
    openSession: id => (opened = id),
    onClose: () => (closed += 1),
  })
  // Capture the handler this render installed; later renders install their own.
  const kanbanKeyHandler = keyHandlers.at(-1)
  const kanbanText = treeText(kanban)
  for (const column of ['Todo', 'Doing', 'Blocked', 'Done']) {
    assert.ok(kanbanText.includes(column), `the board renders the ${column} column`)
  }
  assert.match(kanbanText, /Open one/, 'workspace scope shows every task')
  assert.match(kanbanText, /Done one/, 'done tasks keep their own column')
  assert.match(kanbanText, /P1 · Thing 2/, 'a card carries a clickable PRD chip')
  assert.match(kanbanText, /P2 · Second spec/, 'a task can point at a different PRD')
  assert.match(kanbanText, /Link a PRD/, 'a task without a PRD offers to link one')
  assert.match(kanbanText, /#api/, 'labels show on the card')
  assert.match(kanbanText, /💬 2/, 'the card counts its comments')
  assert.match(kanbanText, /▲ high/, 'the priority shows on the card')
  assert.match(kanbanText, /PRDs \(2\)/, 'the header counts the PRDs')
  assert.match(kanbanText, /Workspace/, 'the scope toggle is offered')
  assert.match(kanbanText, /This session/, 'the session scope is offered')

  const scoped = render('main:session-todo', [boardState, '', false, 'session'], { useSessions, openSession: () => {}, onClose: () => {} })
  assert.match(treeText(scoped), /Open one/, 'the current session keeps the task it touched')
  assert.doesNotMatch(treeText(scoped), /Done one/, 'the current session hides a task it never touched')

  // The PRD chip on a card opens that PRD, and clicking the card opens the task instead.
  const findCard = node => {
    if (node == null || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findCard(child)
        if (hit) return hit
      }
      return null
    }
    if (typeof node.type === 'function') return findCard(node.type({ ...node.props, children: node.children }))
    if (node.props?.className === 'st-card') return node.props
    return (node.children ?? []).map(findCard).find(Boolean) ?? null
  }
  const card = findCard(kanban)
  assert.ok(card, 'a card is rendered')
  let openedTask = ''
  let openedPrd = ''
  card.onClick()
  const cardWithHandlers = { ...card }
  assert.ok(typeof cardWithHandlers.onClick === 'function', 'the card opens its task detail')

  const findChip = node => {
    if (node == null || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findChip(child)
        if (hit) return hit
      }
      return null
    }
    if (typeof node.type === 'function') return findChip(node.type({ ...node.props, children: node.children }))
    const className = String(node.props?.className ?? '')
    if (className.includes('st-chip--prd') && node.props?.onClick) return node.props
    return (node.children ?? []).map(findChip).find(Boolean) ?? null
  }
  const chip = findChip(kanban)
  assert.ok(chip, 'a card shows a PRD chip')
  chip.onClick({ stopPropagation: () => {}, target: {} })

  // Opening a task renders its detail sheet; opening a PRD renders the PRD sheet.
  const taskSheet = render('main:session-todo', [boardState, '', false, 'workspace', '', 'T2'], { useSessions, openSession: () => {}, onClose: () => {} })
  assert.match(treeText(taskSheet), /Task T2/, 'a task opens a detail sheet')
  const prdSheet = render('main:session-todo', [boardState, '', false, 'workspace', '', '', 'P1'], { useSessions, openSession: () => {}, onClose: () => {} })
  assert.match(treeText(prdSheet), /P1/, 'a PRD chip opens the PRD sheet')

  // The board can be closed back to the conversation: a button, and Escape when no field is focused.
  const findCloseButton = node => {
    if (node == null || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findCloseButton(child)
        if (hit) return hit
      }
      return null
    }
    if (typeof node.type === 'function') return findCloseButton(node.type({ ...node.props, children: node.children }))
    if (node.props?.className === 'st-close' && node.props?.onClick) return node.props.onClick
    return (node.children ?? []).map(findCloseButton).find(Boolean) ?? null
  }
  const closeBoard = findCloseButton(kanban)
  assert.ok(closeBoard, 'the board offers a close button')
  closeBoard()
  assert.equal(closed, 1, 'the close button returns to the conversation')
  assert.ok(kanbanKeyHandler, 'the board listens for Escape')
  kanbanKeyHandler({ key: 'Escape', target: { tagName: 'DIV' }, defaultPrevented: false })
  assert.equal(closed, 2, 'Escape closes the board')
  kanbanKeyHandler({ key: 'Escape', target: { tagName: 'TEXTAREA' }, defaultPrevented: false })
  assert.equal(closed, 2, 'Escape inside a field does not close the board')

  console.log('check ok: PRD collection, rich tasks, comments, link, detail route, migration, strip + kanban + sheets, close + Escape')
} finally {
  await rm(dir, { recursive: true, force: true })
}
