'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/ui'
import type { Entry } from '@/types'

type PastLog = { date: string; entry: Entry | null }

/** Daily history owns its viewport-sized pages; expanding a log may grow the page. */
export function StudentPastLogs({ logs }: { logs: PastLog[] }) {
  const panelRef = useRef<HTMLElement>(null)
  const [pageSize, setPageSize] = useState(10)
  const [start, setStart] = useState(0)
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measure = () => {
      // Account for an already-scrolled classroom pane so scrolling cannot add rows.
      let top = panel.getBoundingClientRect().top
      let bottom = window.innerHeight
      for (let parent = panel.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
          top += parent.scrollTop
          bottom = Math.min(bottom, parent.getBoundingClientRect().bottom)
        }
      }
      const header = panel.querySelector('header')?.getBoundingClientRect().height ?? 0
      const row = panel.querySelector<HTMLElement>('[data-past-log-row]')
      const rowHeight = row ? parseFloat(getComputedStyle(row).minHeight) || 44 : 44
      const available = bottom - top - header - 2
      const allFit = logs.length * (rowHeight + 1) <= available
      const size = Math.max(1, Math.floor((available - (allFit ? 0 : rowHeight + 1)) / (rowHeight + 1)))
      setPageSize(size)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (panel.parentElement) observer.observe(panel.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [logs.length])

  const hasPages = pageSize < logs.length
  const pageStart = hasPages ? Math.min(start, Math.max(0, logs.length - 1)) : 0
  const visibleLogs = logs.slice(pageStart, pageStart + pageSize)

  function changePage(nextStart: number) {
    setStart(Math.max(0, nextStart))
    setExpandedDate(null)
  }

  return (
    <section ref={panelRef} aria-label="Past logs" className="rounded-lg border border-border bg-surface">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-text-default">Past logs</h2>
      </header>
      <div className="divide-y divide-border">
        {logs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">No past logs yet</p>
        ) : visibleLogs.map(({ date, entry }) => {
          const dateLabel = format(parseISO(date), 'EEE MMM d')
          const expanded = expandedDate === date
          const content = (
            <>
              <time dateTime={date} className="w-24 shrink-0 text-xs font-normal leading-5 text-text-muted">{dateLabel}</time>
              <span className={`min-w-0 flex-1 text-sm font-normal text-text-default ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                {entry ? entry.text || '' : <span className="text-text-muted">No log submitted</span>}
              </span>
            </>
          )
          return entry ? (
            <Button
              key={date}
              data-past-log-row
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full items-start justify-start gap-3 rounded-none border-0 px-4 py-3 text-left"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} log from ${dateLabel}`}
              onClick={() => setExpandedDate(expanded ? null : date)}
            >
              {content}
            </Button>
          ) : (
            <div key={date} data-past-log-row className="flex min-h-control items-start gap-3 px-4 py-3">{content}</div>
          )
        })}
      </div>
      {hasPages && (
        <nav aria-label="Past log pages" className="flex items-center justify-between border-t border-border px-2">
          <Button type="button" size="sm" variant="ghost" disabled={pageStart === 0} onClick={() => changePage(pageStart - pageSize)}>Newer</Button>
          <span className="text-xs text-text-muted" aria-live="polite">{pageStart + 1}–{Math.min(pageStart + pageSize, logs.length)} of {logs.length}</span>
          <Button type="button" size="sm" variant="ghost" disabled={pageStart + pageSize >= logs.length} onClick={() => changePage(pageStart + pageSize)}>Older</Button>
        </nav>
      )}
    </section>
  )
}
