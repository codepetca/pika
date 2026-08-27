'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import type { AssignmentDocHistoryEntry } from '@/types'
import {
  computeActivityPositions,
  computeActivityWindow,
  computeCharDiffs,
  type EntryWithDiff,
} from '@/lib/history-graph'

export interface HistoryGraphProps {
  entries: AssignmentDocHistoryEntry[]
  activeEntryId: string | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  audience?: 'teacher' | 'student'
  showHeading?: boolean
  variant?: 'desktop' | 'mobile'
}

const TZ = 'America/Toronto'
const CHART_WIDTH = 256
const CHART_HEIGHT = 78
const CHART_INSET = 5
const BASELINE_Y = CHART_HEIGHT / 2
const MAX_CHANGE_HEIGHT = 28

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
  return `${formatDate(Date.parse(entry.entry.created_at))}, ${formatTime(Date.parse(entry.entry.created_at))}, ${change}`
}

function pointY(entry: EntryWithDiff, maxAbsDiff: number): number {
  if (entry.charDiff === 0) return BASELINE_Y
  const height = Math.sqrt(Math.abs(entry.charDiff) / maxAbsDiff) * MAX_CHANGE_HEIGHT
  return BASELINE_Y - Math.sign(entry.charDiff) * height
}

export function HistoryGraph({
  entries,
  activeEntryId,
  onEntryClick,
  onEntryHover,
  audience = 'student',
  showHeading = true,
  variant = 'desktop',
}: HistoryGraphProps) {
  const diffs = useMemo(() => computeCharDiffs(entries), [entries])
  const window = useMemo(() => computeActivityWindow(entries), [entries])
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
  const positions = useMemo(
    () => window ? computeActivityPositions(diffs, window, CHART_WIDTH, CHART_INSET) : [],
    [diffs, window]
  )

  const selectByIndex = useCallback((index: number) => {
    const next = diffs[Math.max(0, Math.min(diffs.length - 1, index))]
    if (next) onEntryClick(next.entry)
  }, [diffs, onEntryClick])

  const maxAbsDiff = Math.max(1, ...diffs.map((entry) => Math.abs(entry.charDiff)))

  const findNearestIndex = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    if (!window || bounds.width <= 0) return -1
    let nearestIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY

    diffs.forEach((entry, index) => {
      const entryX = bounds.left + (positions[index] / CHART_WIDTH) * bounds.width
      const entryY = bounds.top + (pointY(entry, maxAbsDiff) / CHART_HEIGHT) * bounds.height
      const distance = Math.hypot(clientX - entryX, clientY - entryY)
      if (distance < nearestDistance) {
        nearestIndex = index
        nearestDistance = distance
      }
    })

    return nearestIndex
  }, [diffs, maxAbsDiff, positions, window])

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

  const firstEntryMs = Date.parse(diffs[0].entry.created_at)
  const lastEntryMs = Date.parse(diffs[diffs.length - 1].entry.created_at)
  const firstDay = formatInTimeZone(new Date(firstEntryMs), TZ, 'yyyy-MM-dd')
  const lastDay = formatInTimeZone(new Date(lastEntryMs), TZ, 'yyyy-MM-dd')

  return (
    <section className="px-3 py-2" aria-label={heading}>
      {showHeading && <h3 className="text-sm font-semibold text-text-default">{heading}</h3>}
      <div className={`relative ${showHeading ? 'mt-1' : ''}`}>
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
          <line
            x1={CHART_INSET}
            y1={BASELINE_Y}
            x2={CHART_WIDTH - CHART_INSET}
            y2={BASELINE_Y}
            stroke="var(--color-border-strong)"
            strokeWidth={2}
          />
          {diffs.map((entry, index) => {
            const x = positions[index]
            const y = pointY(entry, maxAbsDiff)
            const isSelected = index === selectedIndex
            const direction = entry.charDiff > 0 ? 'up' : entry.charDiff < 0 ? 'down' : 'none'
            const color = entry.charDiff > 0
              ? 'var(--color-success)'
              : entry.charDiff < 0
                ? 'var(--color-danger)'
                : 'var(--color-text-muted)'
            return (
              <g key={entry.entry.id} data-change-direction={direction}>
                <line
                  x1={x}
                  y1={BASELINE_Y}
                  x2={x}
                  y2={y}
                  stroke={color}
                  strokeWidth={isSelected ? 4 : 3}
                  strokeLinecap="round"
                />
                {isSelected && (
                  <circle
                    cx={x}
                    cy={y}
                    r={4}
                    fill={color}
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {firstDay === lastDay ? (
        <p className="mt-0.5 text-center text-xs leading-tight text-text-muted">
          {formatDate(firstEntryMs)}
        </p>
      ) : (
        <div className="mt-0.5 flex justify-between gap-3 text-xs leading-tight text-text-muted">
          <span>{formatDate(firstEntryMs)}</span>
          <span>{formatDate(lastEntryMs)}</span>
        </div>
      )}
    </section>
  )
}
