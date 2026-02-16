type TabSwitchMetric = {
  tab: string
  startedAt: number
  readyAt: number
  durationMs: number
}

type PendingMark = {
  tab: string
  startedAt: number
}

declare global {
  interface Window {
    __classroomTabMetrics?: TabSwitchMetric[]
    __classroomPendingTabMark?: PendingMark | null
  }
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function markClassroomTabSwitchStart(tab: string) {
  if (typeof window === 'undefined') return
  window.__classroomPendingTabMark = { tab, startedAt: nowMs() }
}

export function markClassroomTabSwitchReady(tab: string) {
  if (typeof window === 'undefined') return
  const pending = window.__classroomPendingTabMark
  if (!pending || pending.tab !== tab) return

  const readyAt = nowMs()
  const durationMs = Math.max(0, readyAt - pending.startedAt)
  const next: TabSwitchMetric = {
    tab,
    startedAt: pending.startedAt,
    readyAt,
    durationMs,
  }
  const existing = window.__classroomTabMetrics || []
  window.__classroomTabMetrics = [...existing.slice(-19), next]
  window.__classroomPendingTabMark = null
}

export function getRecentClassroomTabMetrics() {
  if (typeof window === 'undefined') return []
  return window.__classroomTabMetrics || []
}
