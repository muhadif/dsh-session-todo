/** Client half: the session todo strip under the composer, fed by the Host board route. */

window.__ModuleLoader__.load({
  id: 'dsh-session-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const NS = 'session-todo'
    const POLL_MS = 4000

    const DICT = {
      en: {
        strip: 'Todo',
        prd: 'PRD',
        empty: 'No tasks yet.',
        done: '{done} of {total} done',
        addPlaceholder: 'Add a task',
        add: 'Add',
        edit: 'Edit',
        save: 'Save',
        cancel: 'Cancel',
        claim: 'Start',
        complete: 'Done',
        reopen: 'Reopen',
        remove: 'Delete',
        history: 'Log',
        finished: 'Done ({count})',
        prdPlaceholder: 'PRD in Markdown…',
        prdTitlePlaceholder: 'PRD title',
        failed: 'Could not save',
      },
      id: {
        strip: 'Todo',
        prd: 'PRD',
        empty: 'Belum ada task.',
        done: '{done} dari {total} selesai',
        addPlaceholder: 'Tambah task',
        add: 'Tambah',
        edit: 'Ubah',
        save: 'Simpan',
        cancel: 'Batal',
        claim: 'Mulai',
        complete: 'Selesai',
        reopen: 'Buka lagi',
        remove: 'Hapus',
        history: 'Log',
        finished: 'Selesai ({count})',
        prdPlaceholder: 'PRD dalam Markdown…',
        prdTitlePlaceholder: 'Judul PRD',
        failed: 'Gagal menyimpan',
      },
    }

    const T = {
      line: 'var(--dsw-alias-border-l1)',
      strong: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      layer: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      todo: 'var(--dsw-alias-state-idle-primary)',
      doing: 'var(--dsw-alias-brand-primary)',
      blocked: 'var(--dsw-alias-state-warn-primary)',
      done: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const glyph = status => (status === 'done' ? '✓' : status === 'blocked' ? '!' : status === 'doing' ? '◐' : '○')

    const button = (label, onClick, disabled) => h('button', {
      type: 'button',
      onClick,
      disabled,
      style: {
        padding: '1px 6px',
        border: `1px solid ${T.line}`,
        borderRadius: 6,
        background: 'transparent',
        color: T.muted,
        font: 'inherit',
        fontSize: 11,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      },
    }, label)

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

    function Strip({ sessionId, t }) {
      const tr = key => String(t?.(key) ?? DICT.en[key] ?? key)
      const [board, setBoard] = useState(null)
      const [open, setOpen] = useState(false)
      const [editingPrd, setEditingPrd] = useState(false)
      const [prdDraft, setPrdDraft] = useState({ title: '', body: '' })
      const [draft, setDraft] = useState('')
      const [history, setHistory] = useState('')
      const [showDone, setShowDone] = useState(false)
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
            // A route outage leaves the last board visible instead of blanking the strip.
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
          setError(`${tr('failed')}: ${failure.message}`)
        } finally {
          setBusy(false)
        }
      }

      if (!board) return null
      const tasks = board.tasks ?? []
      const counts = board.counts ?? {}
      const total = tasks.length
      const done = counts.done ?? 0
      const label = tr('done').replace('{done}', String(done)).replace('{total}', String(total))
      // Finished work leaves the list; the header count still shows it and the toggle brings it back.
      const finished = tasks.filter(task => task.status === 'done')
      const visible = showDone ? tasks : tasks.filter(task => task.status !== 'done')

      const startPrdEdit = () => {
        setPrdDraft({ title: board.prd?.title ?? '', body: board.prd?.body ?? '' })
        setEditingPrd(true)
      }

      const submitTask = () => {
        const title = draft.trim()
        if (!title || busy) return
        setDraft('')
        void run({ op: 'task-add', tasks: [{ title }] })
      }

      return h(
        'div',
        {
          style: {
            margin: '4px 2px 0',
            border: `1px solid ${T.line}`,
            borderRadius: 10,
            background: T.layer,
            color: T.strong,
            fontSize: 12,
            overflow: 'hidden',
          },
        },
        h(
          'button',
          {
            type: 'button',
            'aria-expanded': open,
            onClick: () => setOpen(value => !value),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              border: 0,
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            },
          },
          h('span', { style: { color: T.doing } }, '☰'),
          h('span', { style: { fontWeight: 600 } }, tr('strip')),
          h('span', { style: { color: T.muted } }, label),
          h('span', {
            'aria-hidden': true,
            style: { flex: 1, height: 4, borderRadius: 2, background: T.line, overflow: 'hidden' },
          }, h('span', {
            style: {
              display: 'block',
              height: '100%',
              width: `${total ? Math.round((done / total) * 100) : 0}%`,
              background: T.done,
            },
          })),
          h('span', { style: { color: T.muted } }, open ? '▾' : '▸'),
        ),
        open
          ? h(
              'div',
              { style: { borderTop: `1px solid ${T.line}`, display: 'grid' } },
              h(
                'div',
                {
                  style: {
                    padding: '8px 10px',
                    display: 'grid',
                    gap: 8,
                    // A long board scrolls inside the strip instead of pushing the composer off
                    // screen: the header and the add field never move.
                    maxHeight: 'min(45vh, 320px)',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                  },
                },
                // PRD
                h(
                  'div',
                  { style: { display: 'grid', gap: 6 } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h('span', { style: { color: T.muted, flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, `${tr('prd')}: ${board.prd?.title || '—'}`),
                    button(editingPrd ? tr('cancel') : tr('edit'), () => (editingPrd ? setEditingPrd(false) : startPrdEdit())),
                  ),
                  editingPrd
                    ? h('div', { style: { display: 'grid', gap: 6 } },
                        h('input', {
                          value: prdDraft.title,
                          placeholder: tr('prdTitlePlaceholder'),
                          onChange: event => setPrdDraft({ ...prdDraft, title: event.target.value }),
                          style: inputStyle,
                        }),
                        h('textarea', {
                          value: prdDraft.body,
                          placeholder: tr('prdPlaceholder'),
                          rows: 6,
                          onChange: event => setPrdDraft({ ...prdDraft, body: event.target.value }),
                          style: { ...inputStyle, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' },
                        }),
                        h('div', { style: { display: 'flex', gap: 6 } },
                          button(tr('save'), () => {
                            if (!prdDraft.body.trim()) return
                            setEditingPrd(false)
                            void run({ op: 'prd', title: prdDraft.title, body: prdDraft.body, mode: 'replace' })
                          }, busy),
                          button(tr('cancel'), () => setEditingPrd(false)),
                        ))
                    : board.prd
                      ? h(
                          'pre',
                          {
                            style: {
                              margin: 0,
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: T.layer2,
                              border: `1px solid ${T.line}`,
                              color: T.strong,
                              font: 'inherit',
                              fontSize: 11.5,
                              lineHeight: 1.5,
                              maxHeight: 140,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            },
                          },
                          `${board.prd.body}${board.prd.truncated ? '\n…' : ''}`,
                        )
                      : null,
                ),
                // Tasks: finished ones stay out of the way until the toggle asks for them.
                visible.length
                  ? h(
                      'ul',
                      { style: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 } },
                      ...visible.map(task => h(
                        'li',
                        { key: task.id, style: { display: 'grid', gap: 2, minWidth: 0 } },
                        h(
                          'div',
                          { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 } },
                          h('span', { style: { color: T[task.status] ?? T.todo, width: 12 } }, glyph(task.status)),
                          h('span', { style: { color: T.muted, minWidth: 26 } }, task.id),
                          h(
                            'span',
                            {
                              style: {
                                flex: '1 1 120px',
                                minWidth: 0,
                                overflowWrap: 'anywhere',
                                textDecoration: task.status === 'done' ? 'line-through' : 'none',
                                color: task.status === 'done' ? T.muted : T.strong,
                              },
                            },
                            task.title,
                            task.note ? h('span', { style: { color: T.muted } }, ` — ${task.note}`) : null,
                          ),
                          task.owner ? h('span', { style: { color: T.muted } }, `@${task.owner}`) : null,
                          task.status === 'done'
                            ? button(tr('reopen'), () => void run({ op: 'task-action', action: 'reopen', ids: [task.id] }), busy)
                            : button(tr('claim'), () => void run({ op: 'task-action', action: 'claim', ids: [task.id] }), busy || task.status === 'doing'),
                          task.status === 'done'
                            ? null
                            : button(tr('complete'), () => void run({ op: 'task-action', action: 'complete', ids: [task.id] }), busy),
                          button(tr('history'), () => setHistory(history === task.id ? '' : task.id)),
                          button(tr('remove'), () => void run({ op: 'task-action', action: 'remove', ids: [task.id] }), busy),
                        ),
                        history === task.id
                          ? h(
                              'div',
                              { style: { color: T.muted, fontSize: 11, paddingLeft: 46, display: 'grid', gap: 1 } },
                              ...(task.log ?? []).map((entry, index) => h(
                                'span',
                                { key: index },
                                `${new Date(entry.at).toLocaleTimeString()} · ${entry.status}${entry.note ? ` · ${entry.note}` : ''}`,
                              )),
                            )
                          : null,
                      )),
                    )
                  : tasks.length
                    ? null
                    : h('span', { style: { color: T.muted } }, tr('empty')),
                finished.length
                  ? h(
                      'button',
                      {
                        type: 'button',
                        'aria-expanded': showDone,
                        onClick: () => setShowDone(value => !value),
                        style: {
                          justifySelf: 'start',
                          padding: 0,
                          border: 0,
                          background: 'transparent',
                          color: T.muted,
                          font: 'inherit',
                          fontSize: 11,
                          cursor: 'pointer',
                        },
                      },
                      `${showDone ? '▾' : '▸'} ${tr('finished').replace('{count}', String(finished.length))}`,
                    )
                  : null,
              ),
              // Add field and errors stay outside the scroll area so they are always reachable.
              h(
                'div',
                { style: { padding: '0 10px 8px', display: 'grid', gap: 6 } },
                h(
                  'div',
                  { style: { display: 'flex', gap: 6 } },
                  h('input', {
                    value: draft,
                    placeholder: tr('addPlaceholder'),
                    onChange: event => setDraft(event.target.value),
                    onKeyDown: event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitTask()
                      }
                    },
                    style: { ...inputStyle, flex: 1, minWidth: 0 },
                  }),
                  button(tr('add'), submitTask, busy || !draft.trim()),
                ),
                error ? h('span', { style: { color: T.error, fontSize: 11 } }, error) : null,
              ),
            )
          : null,
      )
    }

    const inputStyle = {
      padding: '4px 8px',
      border: `1px solid ${T.line}`,
      borderRadius: 6,
      background: T.layer2,
      color: T.strong,
      font: 'inherit',
      fontSize: 12,
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en: DICT.en, id: DICT.id }),
          'session-todo: dictionaries',
        )
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'session-todo', order: 2, locale: NS },
            Strip,
          ),
        )
      },
    }
  },
})
