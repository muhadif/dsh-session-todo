/**
 * Client half: a kanban board in the main panel (sidebar icon "Todo") and the compact strip under
 * the composer, both fed by the Host board route. A card links to the session that last worked on
 * it, and the board can be narrowed to the current session.
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const NS = 'session-todo'
    const PANEL_ID = 'session-todo'
    const POLL_MS = 4000

    const DICT = {
      en: {
        strip: 'Todo',
        panel: 'Todo board',
        prd: 'PRD',
        empty: 'No tasks yet.',
        emptySession: 'Nothing claimed or added by this session yet.',
        done: '{done} of {total} done',
        addPlaceholder: 'Add a task',
        add: 'Add',
        edit: 'Edit',
        save: 'Save',
        cancel: 'Cancel',
        claim: 'Start',
        complete: 'Done',
        block: 'Block',
        reopen: 'Reopen',
        remove: 'Delete',
        history: 'Log',
        board: 'Board',
        finished: 'Done ({count})',
        prdPlaceholder: 'PRD in Markdown…',
        prdTitlePlaceholder: 'PRD title',
        failed: 'Could not save',
        othersInWorkspace: '{count} more in the workspace',
        scopeWorkspace: 'Workspace',
        scopeSession: 'This session',
        scopeHint: 'Which tasks to show',
        goSession: 'Open the session that worked on this',
        linkSession: 'Link this session',
        linkHint: 'No session recorded yet — click to record this session on the task',
        close: 'Close',
        closeHint: 'Back to the conversation (Esc)',
        colTodo: 'Todo',
        colDoing: 'Doing',
        colBlocked: 'Blocked',
        colDone: 'Done',
      },
      id: {
        strip: 'Todo',
        panel: 'Papan todo',
        prd: 'PRD',
        empty: 'Belum ada task.',
        emptySession: 'Belum ada task dari session ini.',
        done: '{done} dari {total} selesai',
        addPlaceholder: 'Tambah task',
        add: 'Tambah',
        edit: 'Ubah',
        save: 'Simpan',
        cancel: 'Batal',
        claim: 'Mulai',
        complete: 'Selesai',
        block: 'Blokir',
        reopen: 'Buka lagi',
        remove: 'Hapus',
        history: 'Log',
        board: 'Papan',
        finished: 'Selesai ({count})',
        prdPlaceholder: 'PRD dalam Markdown…',
        prdTitlePlaceholder: 'Judul PRD',
        failed: 'Gagal menyimpan',
        othersInWorkspace: '{count} task lain di workspace',
        scopeWorkspace: 'Workspace',
        scopeSession: 'Session ini',
        scopeHint: 'Task mana yang ditampilkan',
        goSession: 'Buka session yang mengerjakan task ini',
        linkSession: 'Tautkan session ini',
        linkHint: 'Belum ada session tercatat — klik untuk mencatat session ini di task',
        close: 'Tutup',
        closeHint: 'Kembali ke percakapan (Esc)',
        colTodo: 'Todo',
        colDoing: 'Dikerjakan',
        colBlocked: 'Terblokir',
        colDone: 'Selesai',
      },
    }

    const T = {
      line: 'var(--dsw-alias-border-l1)',
      strong: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      base: 'var(--dsw-alias-bg-base)',
      todo: 'var(--dsw-alias-state-idle-primary)',
      doing: 'var(--dsw-alias-brand-primary)',
      blocked: 'var(--dsw-alias-state-warn-primary)',
      done: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const COLUMNS = [
      { status: 'todo', key: 'colTodo' },
      { status: 'doing', key: 'colDoing' },
      { status: 'blocked', key: 'colBlocked' },
      { status: 'done', key: 'colDone' },
    ]

    const glyph = status => (status === 'done' ? '✓' : status === 'blocked' ? '!' : status === 'doing' ? '◐' : '○')

    const CSS = `
.st-page{height:100%;display:flex;flex-direction:column;min-height:0;color:${T.strong}}
.st-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:calc(16px + var(--dsh-frame-top-clearance,0px)) clamp(16px,3vw,32px) 12px}
.st-title{font-size:15px;font-weight:600;margin:0}
.st-sub{font-size:12px;color:${T.muted}}
.st-progress{flex:1 1 120px;min-width:80px;height:4px;border-radius:2px;background:${T.line};overflow:hidden}
.st-progress>span{display:block;height:100%;background:${T.done}}
.st-close{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid ${T.line};border-radius:8px;background:transparent;color:${T.muted};font:inherit;font-size:15px;line-height:1;cursor:pointer}
.st-close:hover{color:${T.strong};border-color:${T.muted}}
.st-seg{display:inline-flex;border:1px solid ${T.line};border-radius:8px;overflow:hidden}
.st-seg>button{padding:4px 10px;border:0;background:transparent;color:${T.muted};font:inherit;font-size:12px;cursor:pointer}
.st-seg>button[aria-pressed="true"]{background:${T.layer2};color:${T.strong}}
.st-seg>button:disabled{opacity:.45;cursor:default}
.st-body{flex:1;min-height:0;display:grid;grid-template-columns:repeat(4,minmax(200px,1fr));gap:12px;padding:0 clamp(16px,3vw,32px) 20px;overflow-x:auto;align-items:start}
.st-col{display:flex;flex-direction:column;min-height:0;max-height:100%;border:1px solid ${T.line};border-radius:12px;background:${T.layer}}
.st-col-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid ${T.line};font-size:12px;color:${T.muted}}
.st-col-head b{font-weight:600;color:${T.strong};font-size:12px}
.st-col-body{display:grid;gap:8px;padding:10px;overflow-y:auto;min-height:44px}
.st-card{border:1px solid ${T.line};border-radius:10px;background:${T.base};padding:9px 10px;display:grid;gap:6px}
.st-card-top{display:flex;align-items:baseline;gap:6px;font-size:12px}
.st-card-id{color:${T.muted};font-variant-numeric:tabular-nums}
.st-card-title{font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
.st-card-note{font-size:11.5px;color:${T.muted};overflow-wrap:anywhere}
.st-card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.st-btn{padding:1px 7px;border:1px solid ${T.line};border-radius:6px;background:transparent;color:${T.muted};font:inherit;font-size:11px;cursor:pointer}
.st-btn:disabled{opacity:.5;cursor:default}
.st-session{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 7px;border:1px dashed ${T.line};border-radius:6px;background:transparent;color:${T.muted};font:inherit;font-size:11px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.st-session:hover{color:${T.strong};border-style:solid}
.st-session--current{border-style:solid;color:${T.doing}}
.st-add{display:flex;gap:6px;padding:0 clamp(16px,3vw,32px) 16px}
.st-input{flex:1;min-width:0;padding:5px 9px;border:1px solid ${T.line};border-radius:8px;background:${T.layer2};color:${T.strong};font:inherit;font-size:12px}
.st-textarea{width:100%;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:${T.layer2};color:${T.strong};font:inherit;font-size:12px;line-height:1.5;resize:vertical}
.st-prd{margin:0 clamp(16px,3vw,32px) 12px;padding:10px 12px;border:1px solid ${T.line};border-radius:10px;background:${T.layer}}
.st-prd pre{margin:6px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:inherit;font-size:11.5px;line-height:1.5;color:${T.strong}}
.st-error{color:${T.error};font-size:11.5px}
.st-log{display:grid;gap:1px;font-size:11px;color:${T.muted}}
`

    const inputStyle = {
      flex: 1,
      minWidth: 0,
      padding: '5px 9px',
      border: `1px solid ${T.line}`,
      borderRadius: 8,
      background: T.layer2,
      color: T.strong,
      font: 'inherit',
      fontSize: 12,
    }

    const button = (label, onClick, disabled, title) => h('button', {
      type: 'button',
      className: 'st-btn',
      onClick,
      disabled,
      title,
    }, label)

    const shortId = id => String(id ?? '').slice(0, 8)

    async function send(sessionId, payload) {
      const res = await fetch(`/session-todo/board?sessionId=${encodeURIComponent(String(sessionId ?? ''))}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      return data
    }

    /** Poll the board route; a failed read keeps the last board instead of blanking the UI. */
    function useBoard(sessionId) {
      const [board, setBoard] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const res = await fetch(`/session-todo/board?sessionId=${encodeURIComponent(String(sessionId ?? ''))}`)
            if (!res.ok) return
            const data = await res.json()
            if (alive) setBoard(data)
          } catch {
            // keep the last board
          }
        }
        load()
        // ponytail: 4s poll instead of a pushed projection; swap to a wire view if it ever jitters.
        const timer = setInterval(load, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId])
      const run = async payload => {
        setBusy(true)
        setError('')
        try {
          setBoard(await send(sessionId, payload))
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }
      return { board, error, busy, run }
    }

    /** Composer strip: this session's tasks only, plus a way into the whole board. */
    function Strip({ sessionId, t, openBoard }) {
      const tr = key => String(t?.(key) ?? DICT.en[key] ?? key)
      const { board, error } = useBoard(sessionId)
      const [open, setOpen] = useState(false)

      if (!board) return null
      const tasks = board.tasks ?? []
      // The strip sits inside one conversation, so it counts that session's work only; the board
      // behind it still carries the whole workspace, and says how much it is leaving out.
      const mine = sessionId ? tasks.filter(task => (task.sessions ?? []).includes(sessionId)) : tasks
      const others = tasks.length - mine.length
      const total = mine.length
      const done = mine.filter(task => task.status === 'done').length
      const label = tr('done').replace('{done}', String(done)).replace('{total}', String(total))
      const pending = mine.filter(task => task.status !== 'done')

      return h(
        'div',
        { style: { margin: '4px 2px 0', border: `1px solid ${T.line}`, borderRadius: 10, background: T.layer, color: T.strong, fontSize: 12, overflow: 'hidden' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' } },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: () => setOpen(value => !value),
              style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left' },
            },
            h('span', { style: { color: T.doing } }, '☰'),
            h('span', { style: { fontWeight: 600 } }, tr('strip')),
            h('span', { style: { color: T.muted } }, label),
            h('span', { 'aria-hidden': true, style: { flex: 1, height: 4, borderRadius: 2, background: T.line, overflow: 'hidden' } }, h('span', {
              style: { display: 'block', height: '100%', width: `${total ? Math.round((done / total) * 100) : 0}%`, background: T.done },
            })),
          ),
          openBoard ? button(tr('board'), openBoard, false, tr('panel')) : null,
          h('span', { style: { color: T.muted } }, open ? '▾' : '▸'),
        ),
        open
          ? h(
              'div',
              { style: { borderTop: `1px solid ${T.line}`, padding: '6px 10px 8px', display: 'grid', gap: 3, maxHeight: 'min(28vh, 200px)', overflowY: 'auto' } },
              pending.length
                ? pending.map(task => h(
                    'span',
                    { key: task.id, style: { display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 } },
                    h('span', { style: { color: T[task.status] ?? T.todo, width: 12 } }, glyph(task.status)),
                    h('span', { style: { color: T.muted, minWidth: 26 } }, task.id),
                    h('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, task.title),
                    task.owner ? h('span', { style: { color: T.muted } }, `@${task.owner}`) : null,
                  ))
                : h('span', { style: { color: T.muted } }, sessionId ? tr('emptySession') : tr('empty')),
              others
                ? h(
                    'button',
                    {
                      type: 'button',
                      onClick: openBoard,
                      disabled: !openBoard,
                      style: { justifySelf: 'start', padding: 0, border: 0, background: 'transparent', color: T.muted, font: 'inherit', fontSize: 11, cursor: openBoard ? 'pointer' : 'default' },
                    },
                    `${tr('othersInWorkspace').replace('{count}', String(others))} →`,
                  )
                : null,
              error ? h('span', { style: { color: T.error, fontSize: 11 } }, `${tr('failed')}: ${error}`) : null,
            )
          : null,
      )
    }

    /** One kanban card: title, note, the session that worked on it, and its status actions. */
    function Card({ task, tr, busy, onAction, onOpenSession, onLog, logOpen, currentSessionId, titleOf }) {
      const latest = (task.sessions ?? [])[0]
      const latestTitle = latest ? titleOf(latest) : ''
      const actions = []
      if (task.status !== 'done') actions.push([tr('complete'), 'complete'])
      if (task.status === 'todo' || task.status === 'blocked') actions.push([tr('claim'), 'claim'])
      if (task.status !== 'blocked' && task.status !== 'done') actions.push([tr('block'), 'block'])
      if (task.status === 'done') actions.push([tr('reopen'), 'reopen'])

      return h(
        'div',
        { className: 'st-card' },
        h(
          'div',
          { className: 'st-card-top' },
          h('span', { style: { color: T[task.status] ?? T.todo } }, glyph(task.status)),
          h('span', { className: 'st-card-id' }, task.id),
          task.owner ? h('span', { style: { color: T.muted, marginLeft: 'auto' } }, `@${task.owner}`) : null,
        ),
        h('div', {
          className: 'st-card-title',
          style: { textDecoration: task.status === 'done' ? 'line-through' : 'none', color: task.status === 'done' ? T.muted : T.strong },
        }, task.title),
        task.note ? h('div', { className: 'st-card-note' }, task.note) : null,
        h(
          'div',
          { className: 'st-card-foot' },
          latest
            ? h(
                'button',
                {
                  type: 'button',
                  className: `st-session${latest === currentSessionId ? ' st-session--current' : ''}`,
                  onClick: () => onOpenSession(latest),
                  title: `${tr('goSession')} — ${latestTitle}`,
                },
                `↗ ${latestTitle}`,
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'st-session',
                  // Older boards predate session tracking: one click records this session, and
                  // `progress` without a note changes nothing else on the task.
                  onClick: () => onAction({ op: 'task-action', action: 'progress', ids: [task.id] }),
                  disabled: busy || !currentSessionId,
                  title: tr('linkHint'),
                },
                `+ ${tr('linkSession')}`,
              ),
          ...actions.map(([label, action]) => button(
            label,
            () => onAction({ op: 'task-action', action, ids: [task.id] }),
            busy,
          )),
          button(tr('history'), onLog, false),
          button(tr('remove'), () => onAction({ op: 'task-action', action: 'remove', ids: [task.id] }), busy),
        ),
        logOpen
          ? h('div', { className: 'st-log' }, ...(task.log ?? []).map((entry, index) => h(
              'span',
              { key: index },
              `${new Date(entry.at).toLocaleTimeString()} · ${entry.status}${entry.note ? ` · ${entry.note}` : ''}`,
            )))
          : null,
      )
    }

    /** Full board: four columns, a workspace/session scope toggle, PRD editor and add field. */
    function BoardPage({ t, useSessions, openSession, onClose }) {
      const tr = key => String(t?.(key) ?? DICT.en[key] ?? key)
      // The main-view reference marks the session the user is looking at; the panel itself is
      // root-scoped and has no session prop, so read it from the catalog the same way ui-session does.
      const currentSessionId = useSessions?.(snapshot => {
        for (const row of Object.values(snapshot?.byId ?? {})) {
          if ((row.retainedBy?.mainView ?? 0) > 0) return row.id
        }
        return undefined
      })
      const rows = useSessions?.(snapshot => snapshot?.byId ?? {})
      const titleOf = id => rows?.[id]?.displayTitle || shortId(id)

      const { board, error, busy, run } = useBoard(currentSessionId)
      const [scope, setScope] = useState('workspace')
      const [draft, setDraft] = useState('')
      const [editingPrd, setEditingPrd] = useState(false)
      const [prdDraft, setPrdDraft] = useState({ title: '', body: '' })
      const [openLog, setOpenLog] = useState('')

      // Escape leaves the panel the same way the close button does, unless a field is being edited.
      useEffect(() => {
        if (!onClose) return undefined
        const onKey = event => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          const tag = event.target?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const closeButton = onClose
        ? h('button', { type: 'button', className: 'st-close', onClick: onClose, title: tr('closeHint'), 'aria-label': tr('close') }, '×')
        : null

      if (!board) {
        return h('div', { className: 'st-page' }, h('style', null, CSS), h('div', { className: 'st-head' }, h('h2', { className: 'st-title' }, tr('panel')), closeButton))
      }

      const tasks = board.tasks ?? []
      const counts = board.counts ?? {}
      const total = tasks.length
      const done = counts.done ?? 0
      const bySession = scope === 'session' && currentSessionId
      const visible = bySession ? tasks.filter(task => (task.sessions ?? []).includes(currentSessionId)) : tasks

      const submitTask = () => {
        const title = draft.trim()
        if (!title || busy) return
        setDraft('')
        void run({ op: 'task-add', tasks: [{ title }] })
      }

      return h(
        'div',
        { className: 'st-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'st-head' },
          h('h2', { className: 'st-title' }, tr('panel')),
          h('span', { className: 'st-sub' }, tr('done').replace('{done}', String(done)).replace('{total}', String(total))),
          h('span', { className: 'st-progress', 'aria-hidden': true }, h('span', { style: { width: `${total ? Math.round((done / total) * 100) : 0}%` } })),
          h(
            'div',
            { className: 'st-seg', title: tr('scopeHint'), role: 'group' },
            h('button', { type: 'button', 'aria-pressed': scope === 'workspace', onClick: () => setScope('workspace') }, tr('scopeWorkspace')),
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': scope === 'session',
                disabled: !currentSessionId,
                onClick: () => setScope('session'),
              },
              tr('scopeSession'),
            ),
          ),
          button(editingPrd ? tr('cancel') : tr('edit'), () => {
            if (editingPrd) return setEditingPrd(false)
            setPrdDraft({ title: board.prd?.title ?? '', body: board.prd?.body ?? '' })
            setEditingPrd(true)
          }),
          closeButton,
        ),
        editingPrd
          ? h(
              'div',
              { className: 'st-prd', style: { display: 'grid', gap: 8 } },
              h('input', {
                className: 'st-input',
                value: prdDraft.title,
                placeholder: tr('prdTitlePlaceholder'),
                onChange: event => setPrdDraft({ ...prdDraft, title: event.target.value }),
              }),
              h('textarea', {
                className: 'st-textarea',
                value: prdDraft.body,
                placeholder: tr('prdPlaceholder'),
                rows: 8,
                onChange: event => setPrdDraft({ ...prdDraft, body: event.target.value }),
              }),
              h('div', { style: { display: 'flex', gap: 6 } },
                button(tr('save'), () => {
                  if (!prdDraft.body.trim()) return
                  setEditingPrd(false)
                  void run({ op: 'prd', title: prdDraft.title, body: prdDraft.body, mode: 'replace' })
                }, busy),
                button(tr('cancel'), () => setEditingPrd(false)),
              ),
            )
          : board.prd
            ? h('div', { className: 'st-prd' }, h('div', { className: 'st-sub' }, `${tr('prd')}: ${board.prd.title || '—'}`), h('pre', null, `${board.prd.body}${board.prd.truncated ? '\n…' : ''}`))
            : null,
        h(
          'div',
          { className: 'st-body' },
          ...COLUMNS.map(column => {
            const columnTasks = visible.filter(task => task.status === column.status)
            return h(
              'section',
              { key: column.status, className: 'st-col' },
              h(
                'div',
                { className: 'st-col-head' },
                h('span', { style: { color: T[column.status] } }, glyph(column.status)),
                h('b', null, tr(column.key)),
                h('span', { style: { marginLeft: 'auto' } }, String(columnTasks.length)),
              ),
              h(
                'div',
                { className: 'st-col-body' },
                columnTasks.length
                  ? columnTasks.map(task => h(Card, {
                      key: task.id,
                      task,
                      tr,
                      busy,
                      currentSessionId,
                      titleOf,
                      logOpen: openLog === task.id,
                      onLog: () => setOpenLog(openLog === task.id ? '' : task.id),
                      onAction: payload => void run(payload),
                      onOpenSession: id => {
                        try {
                          openSession?.(id)
                        } catch {
                          // a session that cannot be opened leaves the board where it is
                        }
                      },
                    }))
                  : h('span', { className: 'st-sub', style: { fontSize: 11 } }, bySession ? tr('emptySession') : tr('empty')),
              ),
            )
          }),
        ),
        h(
          'div',
          { className: 'st-add' },
          h('input', {
            className: 'st-input',
            value: draft,
            placeholder: tr('addPlaceholder'),
            onChange: event => setDraft(event.target.value),
            onKeyDown: event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitTask()
              }
            },
          }),
          button(tr('add'), submitTask, busy || !draft.trim()),
          error ? h('span', { className: 'st-error' }, `${tr('failed')}: ${error}`) : null,
        ),
      )
    }

    function PanelIcon({ size }) {
      const box = size ?? 16
      return h(
        'svg',
        {
          width: box,
          height: box,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 2, y: 2.6, width: 12, height: 10.8, rx: 1.8 }),
        h('path', { d: 'M2 5.6h12' }),
        h('path', { d: 'M5.6 8.6l1.5 1.5 2.4-2.6' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en: DICT.en, id: DICT.id }),
          'session-todo: dictionaries',
        )

        // Both services are optional so the bundle still activates where the shell lacks them.
        const openBoard = () => {
          try {
            ctx.get?.('layout')?.selectPanel?.(PANEL_ID)
          } catch {
            // an unregistered panel keeps the strip as the only view
          }
        }

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'session-todo',
              order: 2,
              locale: NS,
              inject: () => ({ openBoard }),
            },
            Strip,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({
                openSession: id => ctx.get?.('uiWorkspace')?.openSession?.(id),
                onClose: () => ctx.get?.('layout')?.selectPanel?.(null),
              }),
            },
            BoardPage,
          ),
        )

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => ctx.locale.bind(NS)('panel'),
            },
            PanelIcon,
          ),
        )
      },
    }
  },
})
