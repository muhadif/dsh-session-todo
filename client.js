/**
 * Client half: a kanban board in the main panel (sidebar icon "Todo") and the compact strip under
 * the composer, both fed by the Host board route.
 *
 * A card carries a clickable PRD chip that opens the PRD rendered as Markdown, and clicking the card
 * itself opens a task detail panel: description, status, owner, priority, labels, linked PRD,
 * sessions, comments and the progress log.
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    // The shell shares ui-primitives as a platform module, so the board renders Markdown with the
    // same renderer the conversation uses. A host without it falls back to literal text.
    let MarkdownText = null
    try {
      MarkdownText = require('@deepseek-ai/dsh-client-ui-primitives')?.MarkdownText ?? null
    } catch {
      MarkdownText = null
    }
    // Reference-stable: a new identity discards the renderer's cache on every render.
    const MD_LABELS = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

    const NS = 'session-todo'
    const PANEL_ID = 'session-todo'
    const POLL_MS = 4000

    const DICT = {
      en: {
        strip: 'Todo',
        panel: 'Todo board',
        prds: 'PRDs',
        prd: 'PRD',
        noPrd: 'No PRD',
        linkPrd: 'Link a PRD',
        newPrd: 'New PRD',
        prdEmpty: 'No PRD on this board yet.',
        prdTasks: '{count} task(s)',
        prdOwner: 'by {session}',
        empty: 'No tasks yet.',
        firstRun: 'This board is empty. The agent fills it on its own: it writes a PRD when you bring requirements, then claims a task before working. Ask for something multi-step, or add a task below.',
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
        detail: 'Task {id}',
        description: 'Description',
        descriptionPlaceholder: 'What this task has to do, in Markdown…',
        comments: 'Comments',
        noComments: 'No comments yet.',
        commentPlaceholder: 'Add a comment…',
        comment: 'Comment',
        fields: 'Fields',
        status: 'Status',
        owner: 'Owner',
        ownerPlaceholder: 'unassigned',
        priority: 'Priority',
        none: 'None',
        labels: 'Labels',
        labelsPlaceholder: 'comma, separated',
        sessions: 'Sessions',
        updated: 'Updated {at}',
        openDetail: 'Open the task detail',
        loading: 'Loading…',
      },
      id: {
        strip: 'Todo',
        panel: 'Papan todo',
        prds: 'PRD',
        prd: 'PRD',
        noPrd: 'Tanpa PRD',
        linkPrd: 'Tautkan PRD',
        newPrd: 'PRD baru',
        prdEmpty: 'Belum ada PRD di papan ini.',
        prdTasks: '{count} task',
        prdOwner: 'oleh {session}',
        empty: 'Belum ada task.',
        firstRun: 'Papan ini masih kosong. Agent mengisinya sendiri: menulis PRD saat ada requirement, lalu mengambil task sebelum bekerja. Minta sesuatu yang perlu beberapa langkah, atau tambah task di bawah.',
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
        detail: 'Task {id}',
        description: 'Deskripsi',
        descriptionPlaceholder: 'Apa yang harus dikerjakan task ini, dalam Markdown…',
        comments: 'Komentar',
        noComments: 'Belum ada komentar.',
        commentPlaceholder: 'Tambah komentar…',
        comment: 'Komentar',
        fields: 'Detail',
        status: 'Status',
        owner: 'Pemilik',
        ownerPlaceholder: 'belum ada',
        priority: 'Prioritas',
        none: 'Tidak ada',
        labels: 'Label',
        labelsPlaceholder: 'pisahkan, dengan koma',
        sessions: 'Session',
        updated: 'Diubah {at}',
        openDetail: 'Buka detail task',
        loading: 'Memuat…',
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

    const PRIORITY_TONE = {
      urgent: T.error,
      high: T.blocked,
      medium: T.doing,
      low: T.muted,
    }

    const glyph = status => (status === 'done' ? '✓' : status === 'blocked' ? '!' : status === 'doing' ? '◐' : '○')
    const shortId = id => String(id ?? '').slice(0, 8)

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
.st-card{border:1px solid ${T.line};border-radius:10px;background:${T.base};padding:9px 10px;display:grid;gap:6px;cursor:pointer}
.st-card:hover{border-color:${T.muted}}
.st-card-top{display:flex;align-items:baseline;gap:6px;font-size:12px}
.st-card-id{color:${T.muted};font-variant-numeric:tabular-nums}
.st-card-title{font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}
.st-card-note{font-size:11.5px;color:${T.muted};overflow-wrap:anywhere}
.st-card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.st-btn{padding:1px 7px;border:1px solid ${T.line};border-radius:6px;background:transparent;color:${T.muted};font:inherit;font-size:11px;cursor:pointer}
.st-btn:disabled{opacity:.5;cursor:default}
.st-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border:1px solid ${T.line};border-radius:999px;background:transparent;color:${T.muted};font:inherit;font-size:11px;cursor:pointer;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.st-chip:hover{color:${T.strong};border-color:${T.muted}}
.st-chip--prd{border-style:solid;color:${T.doing}}
.st-chip--none{border-style:dashed}
.st-session{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 7px;border:1px dashed ${T.line};border-radius:6px;background:transparent;color:${T.muted};font:inherit;font-size:11px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.st-session:hover{color:${T.strong};border-style:solid}
.st-session--current{border-style:solid;color:${T.doing}}
.st-firstrun{margin:0 clamp(16px,3vw,32px) 14px;padding:12px 14px;border:1px dashed ${T.line};border-radius:10px;background:${T.layer};color:${T.muted};font-size:12px;line-height:1.6}
.st-add{display:flex;gap:6px;padding:0 clamp(16px,3vw,32px) 16px}
.st-input{flex:1;min-width:0;padding:5px 9px;border:1px solid ${T.line};border-radius:8px;background:${T.layer2};color:${T.strong};font:inherit;font-size:12px}
.st-textarea{width:100%;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:${T.layer2};color:${T.strong};font:inherit;font-size:12px;line-height:1.5;resize:vertical}
.st-error{color:${T.error};font-size:11.5px}
.st-log{display:grid;gap:1px;font-size:11px;color:${T.muted}}
.st-overlay{position:fixed;inset:0;z-index:60;display:flex;justify-content:flex-end;background:rgba(0,0,0,.28)}
.st-sheet{width:min(560px,94vw);height:100%;display:flex;flex-direction:column;min-height:0;background:${T.base};border-left:1px solid ${T.line};box-shadow:0 0 32px rgba(0,0,0,.28)}
.st-sheet-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid ${T.line}}
.st-sheet-title{font-size:14px;font-weight:600;margin:0;flex:1;min-width:0;overflow-wrap:anywhere}
.st-sheet-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px 24px;display:grid;gap:14px;align-content:start}
.st-section{display:grid;gap:6px}
.st-section>h4{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${T.muted};font-weight:600}
.st-field{display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:8px;font-size:12px}
.st-field>span{color:${T.muted}}
.st-select{width:100%;padding:4px 8px;border:1px solid ${T.line};border-radius:8px;background:${T.layer2};color:${T.strong};font:inherit;font-size:12px}
.st-md{border:1px solid ${T.line};border-radius:10px;background:${T.layer};padding:12px 14px;font-size:12.5px;line-height:1.6;overflow-wrap:anywhere}
.st-md pre{white-space:pre-wrap;word-break:break-word;margin:0;font:inherit}
.st-comment{display:grid;gap:2px;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:${T.layer}}
.st-comment-head{font-size:11px;color:${T.muted}}
.st-comment-body{font-size:12.5px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
.st-prd-item{display:flex;align-items:baseline;gap:8px;padding:8px 10px;border:1px solid ${T.line};border-radius:8px;background:${T.layer};cursor:pointer;text-align:left;font:inherit;color:inherit}
.st-prd-item:hover{border-color:${T.muted}}
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

    /** Markdown through the shell's renderer when it is available, literal text otherwise. */
    const markdown = (text, className = 'st-md') => h(
      'div',
      { className },
      MarkdownText
        ? h(MarkdownText, { text: String(text ?? ''), labels: MD_LABELS, variant: 'compact' })
        : h('pre', null, String(text ?? '')),
    )

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

    async function readDetail(sessionId, kind, id) {
      const res = await fetch(
        `/session-todo/detail?sessionId=${encodeURIComponent(String(sessionId ?? ''))}`
        + `&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id ?? ''))}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
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

    /** One kanban card: title, PRD chip, priority, labels, and the session that worked on it. */
    function Card({ task, tr, prdOf, onOpenTask, onOpenPrd, onLinkPrd }) {
      const latest = (task.sessions ?? [])[0]
      const prd = prdOf(task.prdId)
      return h(
        'div',
        {
          className: 'st-card',
          role: 'button',
          tabIndex: 0,
          title: tr('openDetail'),
          onClick: () => onOpenTask(task.id),
          onKeyDown: event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpenTask(task.id)
            }
          },
        },
        h(
          'div',
          { className: 'st-card-top' },
          h('span', { style: { color: T[task.status] ?? T.todo } }, glyph(task.status)),
          h('span', { className: 'st-card-id' }, task.id),
          task.priority
            ? h('span', { style: { color: PRIORITY_TONE[task.priority] ?? T.muted, fontSize: 11 } }, `▲ ${task.priority}`)
            : null,
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
          // The chip opens the PRD, the card opens the task: two different targets on one card.
          prd
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'st-chip st-chip--prd',
                  title: prd.title || prd.id,
                  onClick: event => {
                    event.stopPropagation()
                    onOpenPrd(prd.id)
                  },
                },
                `▤ ${prd.id} · ${prd.title || '(untitled)'}`,
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'st-chip st-chip--none',
                  onClick: event => {
                    event.stopPropagation()
                    onLinkPrd(task.id)
                  },
                },
                `▤ ${tr('linkPrd')}`,
              ),
          ...(task.labels ?? []).map(label => h('span', { key: label, className: 'st-chip' }, `#${label}`)),
          task.comments
            ? h('span', { className: 'st-chip', style: { cursor: 'default' } }, `💬 ${task.comments}`)
            : null,
          latest
            ? h('span', { className: 'st-chip', title: latest }, `↗ ${shortId(latest)}`)
            : null,
        ),
      )
    }

    /** Overlay shell shared by the task detail and the PRD viewer. */
    function Sheet({ title, onClose, tr, children }) {
      useEffect(() => {
        const onKey = event => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          const tag = event.target?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        { className: 'st-overlay', onClick: event => { if (event.target === event.currentTarget) onClose() } },
        h(
          'div',
          { className: 'st-sheet', role: 'dialog', 'aria-modal': true, 'aria-label': title },
          h(
            'div',
            { className: 'st-sheet-head' },
            h('h3', { className: 'st-sheet-title' }, title),
            h('button', { type: 'button', className: 'st-close', onClick: onClose, title: tr('closeHint'), 'aria-label': tr('close') }, '×'),
          ),
          children,
        ),
      )
    }

    /** The PRD behind a task: rendered Markdown, with an edit mode for the human. */
    function PrdSheet({ sessionId, prdId, tr, onClose, run, busy, error }) {
      const creating = !prdId
      const [detail, setDetail] = useState(null)
      const [editing, setEditing] = useState(creating)
      const [draft, setDraft] = useState({ title: '', body: '' })
      const [loadError, setLoadError] = useState('')

      useEffect(() => {
        if (creating) return undefined
        let alive = true
        setDetail(null)
        readDetail(sessionId, 'prd', prdId)
          .then(data => { if (alive) setDetail(data.prd) })
          .catch(failure => { if (alive) setLoadError(failure.message) })
        return () => { alive = false }
      }, [sessionId, prdId, creating])

      const startEdit = () => {
        setDraft({ title: detail?.title ?? '', body: detail?.body ?? '' })
        setEditing(true)
      }

      return h(
        Sheet,
        { title: creating ? tr('newPrd') : detail ? `${prdId} · ${detail.title || '(untitled)'}` : prdId, onClose, tr },
        h(
          'div',
          { className: 'st-sheet-body' },
          loadError ? h('span', { className: 'st-error' }, loadError) : null,
          !detail && !loadError && !creating ? h('span', { className: 'st-sub' }, tr('loading')) : null,
          detail
            ? editing
              ? h(
                  'div',
                  { className: 'st-section' },
                  h('input', {
                    className: 'st-input',
                    value: draft.title,
                    placeholder: tr('prdTitlePlaceholder'),
                    onChange: event => setDraft({ ...draft, title: event.target.value }),
                  }),
                  h('textarea', {
                    className: 'st-textarea',
                    value: draft.body,
                    rows: 14,
                    placeholder: tr('prdPlaceholder'),
                    onChange: event => setDraft({ ...draft, body: event.target.value }),
                  }),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    button(tr('save'), () => {
                      if (!draft.body.trim()) return
                      setEditing(false)
                      void run(
                        creating
                          ? { op: 'prd', fresh: true, title: draft.title, body: draft.body }
                          : { op: 'prd', id: prdId, title: draft.title, body: draft.body, mode: 'replace' },
                      )
                      onClose()
                    }, busy),
                    button(tr('cancel'), () => setEditing(false)),
                  ),
                )
              : h(
                  'div',
                  { className: 'st-section' },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h('span', { className: 'st-sub', style: { flex: 1 } }, detail.session ? tr('prdOwner').replace('{session}', shortId(detail.session)) : ''),
                    button(tr('edit'), startEdit),
                  ),
                  markdown(detail.body),
                )
            : null,
          error ? h('span', { className: 'st-error' }, `${tr('failed')}: ${error}`) : null,
        ),
      )
    }

    /** Jira-like task detail: fields, description, comments, and the progress log. */
    function TaskSheet({ sessionId, taskId, tr, onClose, run, busy, error, prds, currentSessionId, openSession, titleOf }) {
      const [detail, setDetail] = useState(null)
      const [loadError, setLoadError] = useState('')
      const [comment, setComment] = useState('')
      const [editingDesc, setEditingDesc] = useState(false)
      const [descDraft, setDescDraft] = useState('')

      useEffect(() => {
        let alive = true
        setDetail(null)
        readDetail(sessionId, 'task', taskId)
          .then(data => { if (alive) setDetail(data.task) })
          .catch(failure => { if (alive) setLoadError(failure.message) })
        return () => { alive = false }
      }, [sessionId, taskId])

      const patch = fields => run({ op: 'task-action', action: 'edit', ids: [taskId], ...fields })
      const task = detail

      return h(
        Sheet,
        { title: tr('detail').replace('{id}', taskId), onClose, tr },
        h(
          'div',
          { className: 'st-sheet-body' },
          loadError ? h('span', { className: 'st-error' }, loadError) : null,
          !task && !loadError ? h('span', { className: 'st-sub' }, tr('loading')) : null,
          task
            ? h(
                'div',
                { className: 'st-section' },
                h('input', {
                  className: 'st-input',
                  defaultValue: task.title,
                  onBlur: event => {
                    const title = event.target.value.trim()
                    if (title && title !== task.title) patch({ title })
                  },
                  style: { fontSize: 13.5, fontWeight: 600 },
                }),
              )
            : null,
          task
            ? h(
                'div',
                { className: 'st-section' },
                h('h4', null, tr('fields')),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('status')),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                    ...COLUMNS.map(column => button(
                      tr(column.key),
                      () => run({ op: 'task-action', action: column.status === 'done' ? 'complete' : column.status === 'doing' ? 'claim' : column.status === 'blocked' ? 'block' : 'reopen', ids: [taskId] }),
                      busy || task.status === column.status,
                    )),
                  ),
                ),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('owner')),
                  h('input', {
                    className: 'st-input',
                    defaultValue: task.owner ?? '',
                    placeholder: tr('ownerPlaceholder'),
                    onBlur: event => {
                      if (event.target.value !== (task.owner ?? '')) patch({ owner: event.target.value })
                    },
                  }),
                ),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('priority')),
                  h(
                    'select',
                    {
                      className: 'st-select',
                      value: task.priority ?? '',
                      onChange: event => patch({ priority: event.target.value }),
                    },
                    h('option', { value: '' }, tr('none')),
                    ...['low', 'medium', 'high', 'urgent'].map(value => h('option', { key: value, value }, value)),
                  ),
                ),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('labels')),
                  h('input', {
                    className: 'st-input',
                    defaultValue: (task.labels ?? []).join(', '),
                    placeholder: tr('labelsPlaceholder'),
                    onBlur: event => {
                      const next = event.target.value.split(',').map(part => part.trim()).filter(Boolean)
                      if (next.join(',') !== (task.labels ?? []).join(',')) patch({ labels: next })
                    },
                  }),
                ),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('prd')),
                  h(
                    'select',
                    {
                      className: 'st-select',
                      value: task.prdId ?? '',
                      onChange: event => run({ op: 'task-action', action: 'link', ids: [taskId], prdId: event.target.value }),
                    },
                    h('option', { value: '' }, tr('noPrd')),
                    ...(prds ?? []).map(prd => h('option', { key: prd.id, value: prd.id }, `${prd.id} · ${prd.title || '(untitled)'}`)),
                  ),
                ),
                h(
                  'div',
                  { className: 'st-field' },
                  h('span', null, tr('sessions')),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                    (task.sessions ?? []).length
                      ? task.sessions.map(id => h(
                          'button',
                          {
                            key: id,
                            type: 'button',
                            className: `st-session${id === currentSessionId ? ' st-session--current' : ''}`,
                            onClick: () => openSession?.(id),
                            title: tr('goSession'),
                          },
                          `↗ ${titleOf(id)}`,
                        ))
                      : h('span', { className: 'st-sub' }, '—'),
                  ),
                ),
                task.updatedAt
                  ? h('span', { className: 'st-sub', style: { fontSize: 11 } }, tr('updated').replace('{at}', new Date(task.updatedAt).toLocaleString()))
                  : null,
              )
            : null,
          task
            ? h(
                'div',
                { className: 'st-section' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('h4', { style: { flex: 1 } }, tr('description')),
                  button(editingDesc ? tr('cancel') : tr('edit'), () => {
                    if (editingDesc) return setEditingDesc(false)
                    setDescDraft(task.description ?? '')
                    setEditingDesc(true)
                  }),
                ),
                editingDesc
                  ? h(
                      'div',
                      { style: { display: 'grid', gap: 6 } },
                      h('textarea', {
                        className: 'st-textarea',
                        value: descDraft,
                        rows: 8,
                        placeholder: tr('descriptionPlaceholder'),
                        onChange: event => setDescDraft(event.target.value),
                      }),
                      button(tr('save'), () => {
                        setEditingDesc(false)
                        patch({ description: descDraft })
                      }, busy),
                    )
                  : task.description
                    ? markdown(task.description)
                    : h('span', { className: 'st-sub' }, '—'),
              )
            : null,
          task
            ? h(
                'div',
                { className: 'st-section' },
                h('h4', null, `${tr('comments')} (${(task.comments ?? []).length})`),
                (task.comments ?? []).length
                  ? task.comments.map((entry, index) => h(
                      'div',
                      { key: index, className: 'st-comment' },
                      h('div', { className: 'st-comment-head' }, `${entry.author} · ${new Date(entry.at).toLocaleString()}`),
                      h('div', { className: 'st-comment-body' }, entry.body),
                    ))
                  : h('span', { className: 'st-sub' }, tr('noComments')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginTop: 4 } },
                  h('input', {
                    className: 'st-input',
                    value: comment,
                    placeholder: tr('commentPlaceholder'),
                    onChange: event => setComment(event.target.value),
                    onKeyDown: event => {
                      if (event.key !== 'Enter' || !comment.trim()) return
                      event.preventDefault()
                      const body = comment.trim()
                      setComment('')
                      void run({ op: 'task-action', action: 'comment', ids: [taskId], note: body })
                    },
                  }),
                  button(tr('comment'), () => {
                    const body = comment.trim()
                    if (!body) return
                    setComment('')
                    void run({ op: 'task-action', action: 'comment', ids: [taskId], note: body })
                  }, busy || !comment.trim()),
                ),
              )
            : null,
          task?.log?.length
            ? h(
                'div',
                { className: 'st-section' },
                h('h4', null, tr('history')),
                h('div', { className: 'st-log' }, ...task.log.map((entry, index) => h(
                  'span',
                  { key: index },
                  `${new Date(entry.at).toLocaleString()} · ${entry.status}${entry.note ? ` · ${entry.note}` : ''}`,
                ))),
              )
            : null,
          error ? h('span', { className: 'st-error' }, `${tr('failed')}: ${error}`) : null,
        ),
      )
    }

    /** Full board: four columns, a workspace/session scope toggle, PRDs, and the add field. */
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
      const [openTask, setOpenTask] = useState('')
      const [openPrd, setOpenPrd] = useState('')
      const [showPrds, setShowPrds] = useState(false)

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
      const prds = board.prds ?? []
      const prdOf = id => prds.find(prd => prd.id === id)
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

      const sheets = []
      if (openTask) {
        sheets.push(h(TaskSheet, {
          key: `task-${openTask}`,
          sessionId: currentSessionId,
          taskId: openTask,
          tr,
          prds,
          currentSessionId,
          openSession,
          titleOf,
          busy,
          error,
          run,
          onClose: () => setOpenTask(''),
        }))
      }
      if (openPrd) {
        sheets.push(h(PrdSheet, {
          key: `prd-${openPrd}`,
          sessionId: currentSessionId,
          prdId: openPrd === 'new' ? '' : openPrd,
          tr,
          busy,
          error,
          run,
          onClose: () => setOpenPrd(''),
        }))
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
          button(`${tr('prds')} (${prds.length})`, () => setShowPrds(value => !value), false, tr('prds')),
          closeButton,
        ),
        showPrds
          ? h(
              'div',
              { className: 'st-section', style: { padding: '0 clamp(16px,3vw,32px) 12px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('h4', { style: { flex: 1 } }, tr('prds')),
                button(tr('newPrd'), () => {
                  setShowPrds(false)
                  setOpenPrd('new')
                }),
              ),
              prds.length
                ? prds.map(prd => h(
                    'button',
                    { key: prd.id, type: 'button', className: 'st-prd-item', onClick: () => setOpenPrd(prd.id) },
                    h('span', { className: 'st-chip st-chip--prd' }, prd.id),
                    h('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, prd.title || '(untitled)'),
                    h('span', { className: 'st-sub' }, tr('prdTasks').replace('{count}', String(prd.tasks))),
                  ))
                : h('span', { className: 'st-sub' }, tr('prdEmpty')),
            )
          : null,
        total === 0
          ? h('div', { className: 'st-firstrun' }, tr('firstRun'))
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
                      prdOf,
                      onOpenTask: setOpenTask,
                      onOpenPrd: setOpenPrd,
                      onLinkPrd: id => {
                        setOpenTask(id)
                      },
                    }))
                  : h('span', { className: 'st-sub', style: { fontSize: 11 } }, bySession ? tr('emptySession') : '—'),
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
        ...sheets,
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
