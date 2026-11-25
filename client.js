/**
 * Browser half of `@todrink/dsh-recents`.
 *
 * Goal: the three conversations you touched last become one-click shortcuts,
 * sitting between the host's New session button and the Workspaces list.
 *
 * They are mirrors, not moves. A row only reads the Session list, the Workspace
 * list and the Session status snapshot, and a click delegates to
 * uiWorkspace.openSession(). Nothing is pinned, archived, renamed or reordered,
 * and the same conversation still lives in its Workspace group below: this is a
 * shortcut shelf, not a second owner of the data.
 *
 * Why a hand-built block instead of a slot: the sidebar exposes no slot between
 * the New session row and the Workspaces region, and the region itself belongs
 * to whichever plugin owns `sidebar.workspaces` (the stock browser, or
 * @local/sidebar-fold). So this module injects one container into the sidebar
 * column as a previous sibling of the workspaces subtree, and then leaves the
 * host's own React tree alone. The container is foreign to React, which keeps
 * its own children by identity; a MutationObserver re-places the container if a
 * re-render ever drops it or reorders it.
 *
 * Data contract (verified against the installed 0.2.2-rc.x client sources):
 *   - `sessions.list` snapshot: { phase, ids, byId } where byId[id] carries
 *     title / displayTitle / blank / running / updatedAt / retainedBy.
 *   - `workspaces.list` snapshot: { items, archivedSessionIds, pinnedSessionIds };
 *     items[].sessionIds is the ownership index.
 *   - `uiSession.sessionStatus` snapshot: ReadonlyMap of SessionId to
 *     { running, pendingInteraction, completionUnread }.
 *   - `uiWorkspace.openSession(sessionId)` navigates, across workspaces included.
 * Every accessor is optional-chained: a future release that renames a field
 * degrades to fewer rows, never to a thrown plugin.
 */

/* The client module table injects every plugin's client file into the same
 * classic-script scope, so this file owns no top-level binding: everything sits
 * inside this wrapper. A bare top-level const here collides with another
 * plugin's client of the same name and the module never registers. */
;(function () {
  'use strict'

const STYLE_ID = 'dsh-recent-sessions-style'
const BLOCK_ATTR = 'data-rs-list'
const BODY_ATTR = 'data-rs'
const MAX_ROWS = 3

const zh = {
  title: '最近对话',
  now: '刚刚',
  minute: (n) => `${n}分钟`,
  hour: (n) => `${n}小时`,
  day: (n) => `${n}天`,
}

const en = {
  title: 'Recent',
  now: 'just now',
  minute: (n) => `${n}m`,
  hour: (n) => `${n}h`,
  day: (n) => `${n}d`,
}

/** Dictionary follows the document language: no locale service dependency. */
function dictionary() {
  const lang = document.documentElement.lang || navigator.language || 'zh'
  return /^zh/i.test(lang) ? zh : en
}

/* Column maths: the host starts sidebar text at inline padding + row padding,
 * which is why 工作区 and every session title share one left edge. The block is a
 * child of the sidebar root's content box, so its own paddings start at that
 * edge already and only the row padding is added. */

const CSS = `
body[${BODY_ATTR}] [data-rs-list] {
  display: block;
  flex: none;
  padding: 0 0 4px;
  margin: 0;
}
body[${BODY_ATTR}][data-rs-compact] [data-rs-list] { display: none !important; }

body[${BODY_ATTR}] [data-rs-head] {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 var(--dsh-sidebar-inline-padding, 8px) 0 var(--dsh-sidebar-row-padding, 12px);
  color: var(--dsw-alias-label-tertiary, #8b93a1);
  font-size: inherit;
  line-height: 20px;
  font-weight: 400;
  white-space: nowrap;
}

body[${BODY_ATTR}] [data-rs-rows] {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0;
  box-sizing: border-box;
}

body[${BODY_ATTR}] [data-rs-row] {
  -webkit-app-region: no-drag;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  margin: 0;
  padding: 0 var(--dsh-sidebar-row-padding, 12px);
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2329);
  font: inherit;
  font-size: inherit;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
body[${BODY_ATTR}] [data-rs-row]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(17, 24, 39, 0.06)); }
body[${BODY_ATTR}] [data-rs-row][aria-current="page"] { color: var(--dsw-alias-label-primary, #1f2329); }
body[${BODY_ATTR}] [data-rs-row]:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4d6bfe);
  outline-offset: -2px;
}

body[${BODY_ATTR}] [data-rs-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

body[${BODY_ATTR}] [data-rs-time] {
  flex: none;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary, #8b93a1);
}

body[${BODY_ATTR}] [data-rs-status] {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
}
body[${BODY_ATTR}] [data-rs-status="pending"] {
  background: var(--dsw-alias-state-warn-primary, var(--dsw-alias-state-warn-label, #d98f00));
}
body[${BODY_ATTR}] [data-rs-status="done"] {
  background: var(--dsw-alias-state-success-primary, #2ea121);
}
body[${BODY_ATTR}] [data-rs-status="running"] {
  background: var(--dsw-alias-state-business-primary, #3370ff);
  animation: rs-pulse 1.1s ease-in-out infinite;
}
@keyframes rs-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
@media (prefers-reduced-motion: reduce) {
  body[${BODY_ATTR}] [data-rs-status="running"] { animation: none; }
}
`

function ensureStyle() {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The frame flags a collapsed sidebar directly, which flips before the width animates. */
function collapsedNow() {
  const frame = document.querySelector('[data-slot="root"] > *')
  if (frame !== null) return frame.hasAttribute('data-sidebar-collapsed')
  const slot = document.querySelector('[data-slot="sidebar"]')
  const box = slot === null ? null : slot.getBoundingClientRect()
  return box !== null && box.width < 120
}

/** Map one SessionId status record to the dot this shelf paints. */
function statusOf(status, summary) {
  if (status !== undefined && status.pendingInteraction !== undefined && status.pendingInteraction !== null) return 'pending'
  if ((status?.running ?? summary.running) === true) return 'running'
  if (status?.completionUnread === true) return 'done'
  return ''
}

function relative(at, t, now) {
  const delta = Math.max(0, now - at)
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return t.now
  if (minutes < 60) return t.minute(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t.hour(hours)
  return t.day(Math.floor(hours / 24))
}

/**
 * Read the three shortcuts: archived and still-blank sessions do not compete for
 * a slot, everything else ranks by updatedAt across every workspace.
 */
function readRows(services) {
  const list = services.sessions?.list?.getSnapshot?.()
  if (list === undefined || list === null) return []
  const lanes = services.workspaces?.list?.getSnapshot?.()
  const archived = new Set(lanes?.archivedSessionIds ?? [])
  const statuses = services.uiSession?.sessionStatus?.getSnapshot?.()
  const byId = list.byId ?? {}
  const ids = Array.isArray(list.ids) ? list.ids : Object.keys(byId)
  const rows = []
  for (const id of ids) {
    const summary = byId[id]
    if (summary === undefined || summary === null) continue
    if (archived.has(id)) continue
    if (summary.blank === true) continue
    const title = String(summary.displayTitle ?? summary.title ?? '').trim()
    if (title === '') continue
    const status = typeof statuses?.get === 'function' ? statuses.get(id) : undefined
    rows.push({
      id,
      title,
      at: Number(summary.updatedAt ?? 0),
      current: (summary.retainedBy?.mainView ?? 0) > 0,
      status: statusOf(status, summary),
    })
  }
  rows.sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1))
  return rows.slice(0, MAX_ROWS)
}

function buildBlock() {
  const block = document.createElement('div')
  block.setAttribute(BLOCK_ATTR, '')
  const head = document.createElement('div')
  head.setAttribute('data-rs-head', '')
  const rows = document.createElement('div')
  rows.setAttribute('data-rs-rows', '')
  block.append(head, rows)
  return block
}

function paint(block, rows, t) {
  const head = block.firstElementChild
  const list = block.lastElementChild
  if (head !== null && head.textContent !== t.title) head.textContent = t.title

  const now = Date.now()
  const next = rows.map(row => ({
    id: row.id,
    title: row.title,
    current: row.current,
    status: row.status,
    label: relative(row.at, t, now),
  }))
  const signature = JSON.stringify(next)
  if (block.dataset.rsSignature === signature) return
  block.dataset.rsSignature = signature
  if (list === null) return

  list.textContent = ''
  for (const row of next) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-rs-row', '')
    button.dataset.rsId = row.id
    button.title = row.title
    if (row.current) button.setAttribute('aria-current', 'page')

    const title = document.createElement('span')
    title.setAttribute('data-rs-title', '')
    title.textContent = row.title

    const time = document.createElement('span')
    time.setAttribute('data-rs-time', '')
    time.textContent = row.label

    if (row.status === '') {
      button.append(title, time)
    } else {
      const dot = document.createElement('span')
      dot.setAttribute('data-rs-status', row.status)
      dot.setAttribute('aria-hidden', 'true')
      button.append(title, dot, time)
    }
    list.append(button)
  }
}

/**
 * Park the block immediately before the Workspaces subtree, inside the same
 * sidebar column. Walking up from the workspaces slot until the ancestor also
 * contains the New session slot finds that column without relying on a CSS
 * module class name.
 */
function place(block) {
  const workspaces = document.querySelector('[data-slot="sidebar.workspaces"]')
  const session = document.querySelector('[data-slot="sidebar.session.action"]')
  if (workspaces === null || session === null) return false
  let node = workspaces
  while (node.parentElement !== null && node.parentElement !== document.body && !node.parentElement.contains(session)) {
    node = node.parentElement
  }
  const parent = node.parentElement
  if (parent === null || parent === document.body) return false
  if (block.parentElement !== parent || block.nextElementSibling !== node) parent.insertBefore(block, node)
  return true
}

function install(ctx) {
  ensureStyle()
  const t = dictionary()
  let block = null
  let queued = false
  let disposed = false

  /** A row is a control: the click delegates to the host's own navigation, so the
   * Session opens exactly as if it had been picked from the Workspace tree. */
  const onClick = (event) => {
    const node = event.target instanceof Element ? event.target.closest('[data-rs-row]') : null
    if (node === null) return
    const sessionId = node.getAttribute('data-rs-id')
    if (sessionId === null || sessionId === '') return
    event.preventDefault()
    try {
      ctx.uiWorkspace.openSession(sessionId)
    } catch (error) {
      console.warn('[recent-sessions] open session failed:', error)
    }
  }

  const apply = () => {
    if (disposed) return
    try {
      if (!document.body.hasAttribute(BODY_ATTR)) document.body.setAttribute(BODY_ATTR, '')
      if (collapsedNow()) {
        document.body.setAttribute('data-rs-compact', '')
        return
      }
      document.body.removeAttribute('data-rs-compact')

      if (block === null) {
        block = buildBlock()
        block.addEventListener('click', onClick)
      }
      const rows = readRows(ctx)
      if (rows.length === 0) {
        block.remove()
        return
      }
      paint(block, rows, t)
      if (!place(block)) block.remove()
    } catch (error) {
      console.warn('[recent-sessions] refresh failed:', error)
    }
  }

  const schedule = () => {
    if (queued || disposed) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      apply()
    })
  }

  apply()

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed'],
  })

  const sources = [ctx.sessions?.list, ctx.workspaces?.list, ctx.uiSession?.sessionStatus]
  const stops = []
  for (const source of sources) {
    if (typeof source?.subscribe !== 'function') continue
    const stop = source.subscribe(schedule)
    if (typeof stop === 'function') stops.push(stop)
  }

  // Relative labels age: repaint the same three rows on a slow tick.
  const tick = setInterval(() => {
    if (block !== null && block.isConnected) {
      block.dataset.rsSignature = ''
      schedule()
    }
  }, 30000)

  const timers = [300, 1200, 3000, 6000].map(ms => setTimeout(schedule, ms))

  return () => {
    disposed = true
    observer.disconnect()
    for (const stop of stops) {
      try {
        stop()
      } catch (error) {
        console.warn('[recent-sessions] unsubscribe failed:', error)
      }
    }
    clearInterval(tick)
    for (const timer of timers) clearTimeout(timer)
    block?.remove()
    block = null
    document.getElementById(STYLE_ID)?.remove()
    document.body.removeAttribute(BODY_ATTR)
    document.body.removeAttribute('data-rs-compact')
    for (const attribute of [BLOCK_ATTR, 'data-rs-head', 'data-rs-rows', 'data-rs-row', 'data-rs-title', 'data-rs-time', 'data-rs-status']) {
      for (const el of document.querySelectorAll(`[${attribute}]`)) el.removeAttribute(attribute)
    }
  }
}

window.__ModuleLoader__.load({
  id: '@todrink/dsh-recents',
  factory() {
    return {
      inject: [],
      apply(ctx) {
        ctx.inject(['sessions', 'workspaces', 'uiSession', 'uiWorkspace'], scoped => {
          ctx.effect(() => install(scoped), 'recent-sessions: mirror shelf')
        })
      },
    }
  },
})
})()
