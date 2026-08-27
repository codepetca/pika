'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import type { AssignmentDocHistoryEntry } from '@/types'
import {
  buildWorkSessions,
  computeCharDiffs,
  computeLifecycleWindow,
  positionInLifecycle,
  type EntryWithDiff,
  type HistoryLifecycle,
} from '@/lib/history-graph'

export interface HistoryGraphProps {
  entries: AssignmentDocHistoryEntry[]
  activeEntryId: string | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  lifecycle?: HistoryLifecycle
  audience?: 'teacher' | 'student'
  showHeading?: boolean
  variant?: 'desktop' | 'mobile'
}

const TZ = 'America/Toronto'
const CHART_WIDTH = 256
const CHART_HEIGHT = 78
const CHART_INSET = 5
const BASELINE_Y = 68

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function formatDate(timestamp: number): string {
  return formatInTimeZone(new Date(timestamp), TZ, 'MMM d')
}

function formatTime(timestamp: number): string {
  return formatInTimeZone(new Date(timestamp), TZ, 'h:mm a')
}

function entryLabel(entry: EntryWithDiff): string {
  const change = entry.charDiff === 0
    ? 'first save'
    : `${entry.charDiff > 0 ? '+' : ''}${entry.charDiff} characters since previous`
  return `${formatTime(Date.parse(entry.entry.created_at))}, ${entry.entry.word_count} words, ${change}`
}

function pointX(entry: EntryWithDiff, lifecycle: { startMs: number; endMs: number }): number {
  return CHART_INSET
    + positionInLifecycle(Date.parse(entry.entry.created_at), lifecycle)
    * (CHART_WIDTH - CHART_INSET * 2)
}

function pointY(entry: EntryWithDiff, maxWords: number): number {
  return BASELINE_Y - (entry.entry.word_count / maxWords) * 52
}

export function HistoryGraph({
  entries,
  activeEntryId,
  onEntryClick,
  onEntryHover,
  lifecycle = { startAt: null, dueAt: null, submittedAt: null },
  audience = 'student',
  showHeading = true,
  variant = 'desktop',
}: HistoryGraphProps) {
  const diffs = useMemo(() => computeCharDiffs(entries), [entries])
  const sessions = useMemo(() => buildWorkSessions(diffs), [diffs])
  const window = useMemo(
    () => computeLifecycleWindow(entries, lifecycle),
    [entries, lifecycle]
  )
  const heading = audience === 'teacher' ? 'Student activity' : 'Version history'
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null)
  const lastHoveredEntryIdRef = useRef<string | null>(null)

  const activeIndex = diffs.findIndex((entry) => entry.entry.id === activeEntryId)
  const hoveredIndex = diffs.findIndex((entry) => entry.entry.id === hoveredEntryId)
  const selectedIndex = hoveredIndex >= 0
    ? hoveredIndex
    : activeIndex >= 0
      ? activeIndex
      : diffs.length - 1
  const selectedEntry = diffs[selectedIndex]

  const selectByIndex = useCallback((index: number) => {
    const next = diffs[Math.max(0, Math.min(diffs.length - 1, index))]
    if (next) onEntryClick(next.entry)
  }, [diffs, onEntryClick])

  const maxWords = Math.max(1, ...diffs.map((entry) => entry.entry.word_count))

  const findNearestIndex = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    if (!window || bounds.width <= 0) return -1
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY

    diffs.forEach((entry, index) => {
      const entryX = bounds.left + (pointX(entry, window) / CHART_WIDTH) * bounds.width
      const entryY = bounds.top + (pointY(entry, maxWords) / CHART_HEIGHT) * bounds.height
      const distance = Math.hypot(clientX - entryX, clientY - entryY)
      if (distance < nearestDistance) {
        nearestIndex = index
        nearestDistance = distance
      }
    })

    return nearestIndex
  }, [diffs, maxWords, window])

  const handlePointer = useCallback((event: React.MouseEvent<SVGSVGElement>, select: boolean) => {
    const index = findNearestIndex(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    )
    const entry = diffs[index]
    if (!entry) return

    if (select) {
      onEntryClick(entry.entry)
      return
    }

    if (entry.entry.id !== lastHoveredEntryIdRef.current) {
      lastHoveredEntryIdRef.current = entry.entry.id
      setHoveredEntryId(entry.entry.id)
      onEntryHover?.(entry.entry)
    }
  }, [diffs, findNearestIndex, onEntryClick, onEntryHover])

  if (entries.length === 0 || !window || !selectedEntry) {
    return (
      <section className="px-3 py-2" aria-label={heading}>
        {showHeading && <h3 className="text-sm font-semibold text-text-default">{heading}</h3>}
        <p className={showHeading ? 'mt-1 text-xs text-text-muted' : 'text-xs text-text-muted'}>
          No saves yet
        </p>
      </section>
    )
  }

  const points = diffs.map((entry) => {
    const x = pointX(entry, window)
    const y = pointY(entry, maxWords)
    return `${x},${y}`
  }).join(' ')
  const endLabel = lifecycle.submittedAt ? 'Submitted' : lifecycle.dueAt ? 'Due' : 'Latest'

  return (
    <section className="px-3 py-2" aria-label={heading}>
      {showHeading && <h3 className="text-sm font-semibold text-text-default">{heading}</h3>}
      <p className={`text-xs text-text-muted ${showHeading ? 'mt-0.5' : ''}`}>
          {pluralize(entries.length, 'save')} · {pluralize(sessions.length, 'work session')}
      </p>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="block h-20 w-full cursor-crosshair overflow-visible outline-none focus-visible:ring-foundation focus-visible:ring-focus"
          role="slider"
          tabIndex={0}
          aria-label="Complete save history"
          aria-valuemin={1}
          aria-valuemax={diffs.length}
          aria-valuenow={selectedIndex + 1}
          aria-valuetext={entryLabel(selectedEntry)}
          preserveAspectRatio="none"
          onMouseMove={variant === 'desktop' ? (event) => handlePointer(event, false) : undefined}
          onMouseLeave={() => {
            lastHoveredEntryIdRef.current = null
            setHoveredEntryId(null)
          }}
          onClick={(event) => handlePointer(event, true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              selectByIndex(selectedIndex - 1)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              selectByIndex(selectedIndex + 1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              selectByIndex(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              selectByIndex(diffs.length - 1)
            }
          }}
        >
          {Array.from({ length: 5 }, (_, index) => {
            const x = CHART_INSET + (index / 4) * (CHART_WIDTH - CHART_INSET * 2)
            return (
              <line
                key={x}
                x1={x}
                y1={5}
                x2={x}
                y2={BASELINE_Y}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray="5 8"
              />
            )
          })}
          <line
            x1={CHART_INSET}
            y1={BASELINE_Y}
            x2={CHART_WIDTH - CHART_INSET}
            y2={BASELINE_Y}
            stroke="var(--color-border-strong)"
            strokeWidth={2}
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {diffs.map((entry, index) => {
            const x = pointX(entry, window)
            const y = pointY(entry, maxWords)
            const isSelected = index === selectedIndex
            return (
              <g key={entry.entry.id}>
                {isSelected && (
                  <line
                    x1={x}
                    y1={4}
                    x2={x}
                    y2={BASELINE_Y + 5}
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 6 : 3.5}
                  fill="var(--color-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={isSelected ? 3 : 0}
                />
              </g>
            )
          })}
          <circle cx={CHART_INSET} cy={BASELINE_Y} r={4} fill="var(--color-text-muted)" />
          <circle
            cx={CHART_WIDTH - CHART_INSET}
            cy={BASELINE_Y}
            r={4}
            fill="var(--color-surface)"
            stroke="var(--color-text-muted)"
            strokeWidth={2}
          />
        </svg>
      </div>

      <div className="mt-0.5 flex items-start justify-between gap-3 text-xs leading-tight text-text-muted">
        <span>Assigned<br />{formatDate(window.startMs)}</span>
        <span className="text-right">{endLabel}<br />{formatDate(window.endMs)}</span>
      </div>
    </section>
  )
}
