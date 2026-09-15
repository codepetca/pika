'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/ui'
import type { Entry } from '@/types'

type PastLog = { date: string; entry: Entry | null }

/** Daily history owns its viewport-sized list; expanding a log may grow the page. */
export function StudentPastLogs({ logs }: { logs: PastLog[] }) {
  const panelRef = useRef<HTMLElement>(null)
  const [visibleCount, setVisibleCount] = useState(10)
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
      setVisibleCount(Math.max(0, Math.min(10, Math.floor(available / (rowHeight + 1)))))
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

  const visibleLogs = logs.slice(0, visibleCount)

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

    </section>
  )
}
