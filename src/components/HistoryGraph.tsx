'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { Minus, Plus } from 'lucide-react'
import type { AssignmentDocHistoryEntry } from '@/types'
import { Button } from '@/ui'
import {
  buildHistoryZoomDurations,
  computeActivityPositions,
  computeActivityWindow,
  computeCharDiffs,
  computeHistoryZoomWindow,
  computeLinearChangeHeight,
  groupActivityByDay,
  positionInActivityWindow,
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
const OVERVIEW_DAY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000
const OVERVIEW_ENTRY_THRESHOLD = 60

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

function pointY(change: number, maxAbsChange: number): number {
  const height = computeLinearChangeHeight(change, maxAbsChange, MAX_CHANGE_HEIGHT)
  return BASELINE_Y - Math.sign(change) * height
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
  const fullWindow = useMemo(() => computeActivityWindow(entries), [entries])
  const heading = audience === 'teacher' ? 'Student activity' : 'Version history'
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null)
  const [zoomIndex, setZoomIndex] = useState(0)
  const [zoomAnchorMs, setZoomAnchorMs] = useState<number | null>(null)
  const lastHoveredEntryIdRef = useRef<string | null>(null)
  const zoomStatusId = useId()
  const historyKey = `${entries[0]?.id ?? 'empty'}:${entries[entries.length - 1]?.id ?? 'empty'}:${entries.length}`

  useEffect(() => {
    setZoomIndex(0)
    setZoomAnchorMs(null)
    setHoveredEntryId(null)
    lastHoveredEntryIdRef.current = null
  }, [historyKey])

  const activeIndex = diffs.findIndex((entry) => entry.entry.id === activeEntryId)
  const hoveredIndex = diffs.findIndex((entry) => entry.entry.id === hoveredEntryId)
  const selectedIndex = hoveredIndex >= 0
    ? hoveredIndex
    : activeIndex >= 0
      ? activeIndex
      : diffs.length - 1
  const selectedEntry = diffs[selectedIndex]
  const zoomDurations = useMemo(
    () => fullWindow ? buildHistoryZoomDurations(fullWindow) : [],
    [fullWindow]
  )
  const boundedZoomIndex = Math.min(zoomIndex, Math.max(0, zoomDurations.length - 1))
  const selectedEntryMs = selectedEntry ? Date.parse(selectedEntry.entry.created_at) : 0
  const visibleWindow = useMemo(
    () => fullWindow
      ? computeHistoryZoomWindow(
          fullWindow,
          zoomDurations[boundedZoomIndex] ?? fullWindow.endMs - fullWindow.startMs,
          zoomAnchorMs ?? selectedEntryMs
        )
      : null,
    [boundedZoomIndex, fullWindow, selectedEntryMs, zoomAnchorMs, zoomDurations]
  )
  const fullDuration = fullWindow ? fullWindow.endMs - fullWindow.startMs : 0
  const isOverview = boundedZoomIndex === 0
    && (fullDuration > OVERVIEW_DAY_THRESHOLD_MS || diffs.length > OVERVIEW_ENTRY_THRESHOLD)
  const dailyGroups = useMemo(() => groupActivityByDay(diffs), [diffs])
  const visibleDiffs = useMemo(
    () => visibleWindow
      ? diffs.filter((entry) => {
          const timestamp = Date.parse(entry.entry.created_at)
          return timestamp >= visibleWindow.startMs && timestamp <= visibleWindow.endMs
        })
      : [],
    [diffs, visibleWindow]
  )
  const positions = useMemo(
    () => visibleWindow
      ? computeActivityPositions(visibleDiffs, visibleWindow, CHART_WIDTH, CHART_INSET)
      : [],
    [visibleDiffs, visibleWindow]
  )
  const dayPositions = useMemo(
    () => visibleWindow
      ? dailyGroups.map((group) => (
          CHART_INSET
          + positionInActivityWindow(group.midpointMs, visibleWindow)
          * (CHART_WIDTH - CHART_INSET * 2)
        ))
      : [],
    [dailyGroups, visibleWindow]
  )

  const selectByIndex = useCallback((index: number) => {
    const next = diffs[Math.max(0, Math.min(diffs.length - 1, index))]
    if (!next) return
    setZoomAnchorMs(Date.parse(next.entry.created_at))
    onEntryClick(next.entry)
  }, [diffs, onEntryClick])

  const maxAbsChange = isOverview
    ? Math.max(1, ...dailyGroups.flatMap((group) => [group.additions, group.deletions]))
    : Math.max(1, ...visibleDiffs.map((entry) => Math.abs(entry.charDiff)))

  const findNearestEntry = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    if (!visibleWindow || bounds.width <= 0) return null
    let nearestEntry: EntryWithDiff | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    if (isOverview) {
      for (let index = 0; index < dailyGroups.length; index += 1) {
        const group = dailyGroups[index]
        const entryX = bounds.left + (dayPositions[index] / CHART_WIDTH) * bounds.width
        const distance = Math.abs(clientX - entryX)
        if (distance < nearestDistance) {
          nearestEntry = group.finalEntry
          nearestDistance = distance
        }
      }
      return nearestEntry
    }

    for (let index = 0; index < visibleDiffs.length; index += 1) {
      const entry = visibleDiffs[index]
      const entryX = bounds.left + (positions[index] / CHART_WIDTH) * bounds.width
      const entryY = bounds.top + (pointY(entry.charDiff, maxAbsChange) / CHART_HEIGHT) * bounds.height
      const distance = Math.hypot(clientX - entryX, clientY - entryY)
      if (distance < nearestDistance) {
        nearestEntry = entry
        nearestDistance = distance
      }
    }

    return nearestEntry
  }, [dailyGroups, dayPositions, isOverview, maxAbsChange, positions, visibleDiffs, visibleWindow])

  const handlePointer = useCallback((event: React.MouseEvent<SVGSVGElement>, select: boolean) => {
    const entry = findNearestEntry(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    )
    if (!entry) return
    setZoomAnchorMs(Date.parse(entry.entry.created_at))

    if (select) {
      onEntryClick(entry.entry)
      return
    }

    if (entry.entry.id !== lastHoveredEntryIdRef.current) {
      lastHoveredEntryIdRef.current = entry.entry.id
      setHoveredEntryId(entry.entry.id)
      onEntryHover?.(entry.entry)
    }
  }, [findNearestEntry, onEntryClick, onEntryHover])

  if (entries.length === 0 || !fullWindow || !visibleWindow || !selectedEntry) {
    return (
      <section className="px-3 py-2" aria-label={heading}>
        {showHeading && <h3 className="text-sm font-semibold text-text-default">{heading}</h3>}
        <p className={showHeading ? 'mt-1 text-xs text-text-muted' : 'text-xs text-text-muted'}>
          No saves yet
        </p>
      </section>
    )
  }

  const visibleStartMs = visibleWindow.startMs
  const visibleEndMs = visibleWindow.endMs - 1
  const firstDay = formatInTimeZone(new Date(visibleStartMs), TZ, 'yyyy-MM-dd')
  const lastDay = formatInTimeZone(new Date(visibleEndMs), TZ, 'yyyy-MM-dd')
  const zoomDurationMs = visibleWindow.endMs - visibleWindow.startMs
  const zoomStatus = boundedZoomIndex === 0
    ? 'Showing all activity'
    : zoomDurationMs >= 24 * 60 * 60 * 1000
      ? `Showing ${Math.round(zoomDurationMs / (24 * 60 * 60 * 1000))} days`
      : `Showing ${Math.round(zoomDurationMs / (60 * 60 * 1000))} hours`
  const showZoomControls = zoomDurations.length > 1 && diffs.length > 1

  const setZoom = (nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(zoomDurations.length - 1, nextIndex))
    setZoomIndex(boundedIndex)
  }

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
          aria-describedby={zoomStatusId}
          data-view-mode={isOverview ? 'daily' : 'saves'}
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
          {isOverview
            ? dailyGroups.map((group, index) => {
                const x = dayPositions[index]
                const additionY = pointY(group.additions, maxAbsChange)
                const deletionY = pointY(-group.deletions, maxAbsChange)
                const isSelected = group.entries.some(
                  (entry) => entry.entry.id === selectedEntry.entry.id
                )
                const dominantChange = group.additions >= group.deletions
                  ? group.additions
                  : -group.deletions
                const selectedY = pointY(dominantChange, maxAbsChange)
                const selectedColor = dominantChange >= 0
                  ? 'var(--color-success)'
                  : 'var(--color-danger)'

                return (
                  <g key={group.day} data-activity-day={group.day}>
                    <title>{`${formatDate(group.midpointMs)}: +${group.additions}, -${group.deletions} characters`}</title>
                    {group.additions > 0 && (
                      <line
                        x1={x}
                        y1={BASELINE_Y}
                        x2={x}
                        y2={additionY}
                        stroke="var(--color-success)"
                        strokeWidth={isSelected ? 4 : 3}
                        strokeLinecap="round"
                        data-change-direction="up"
                        data-change-value={group.additions}
                      />
                    )}
                    {group.deletions > 0 && (
                      <line
                        x1={x}
                        y1={BASELINE_Y}
                        x2={x}
                        y2={deletionY}
                        stroke="var(--color-danger)"
                        strokeWidth={isSelected ? 4 : 3}
                        strokeLinecap="round"
                        data-change-direction="down"
                        data-change-value={group.deletions}
                      />
                    )}
                    {group.additions === 0 && group.deletions === 0 && (
                      <circle
                        cx={x}
                        cy={BASELINE_Y}
                        r={isSelected ? 4 : 2.5}
                        fill="var(--color-text-muted)"
                        stroke={isSelected ? 'var(--color-surface)' : undefined}
                        strokeWidth={isSelected ? 2 : undefined}
                        data-change-direction="none"
                        data-change-value={0}
                      />
                    )}
                    {isSelected && dominantChange !== 0 && (
                      <circle
                        cx={x}
                        cy={selectedY}
                        r={4}
                        fill={selectedColor}
                        stroke="var(--color-surface)"
                        strokeWidth={2}
                      />
                    )}
                  </g>
                )
              })
            : visibleDiffs.map((entry, index) => {
                const x = positions[index]
                const y = pointY(entry.charDiff, maxAbsChange)
                const isSelected = entry.entry.id === selectedEntry.entry.id
                const direction = entry.charDiff > 0 ? 'up' : entry.charDiff < 0 ? 'down' : 'none'
                const color = entry.charDiff > 0
                  ? 'var(--color-success)'
                  : entry.charDiff < 0
                    ? 'var(--color-danger)'
                    : 'var(--color-text-muted)'
                return (
                  <g key={entry.entry.id} data-change-direction={direction}>
                    <title>{entryLabel(entry)}</title>
                    <line
                      x1={x}
                      y1={BASELINE_Y}
                      x2={x}
                      y2={y}
                      stroke={color}
                      strokeWidth={isSelected ? 4 : 3}
                      strokeLinecap="round"
                      data-change-value={Math.abs(entry.charDiff)}
                    />
                    {entry.charDiff === 0 && !isSelected && (
                      <circle
                        cx={x}
                        cy={BASELINE_Y}
                        r={2.5}
                        fill="var(--color-text-muted)"
                      />
                    )}
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

      <span id={zoomStatusId} className="sr-only" aria-live="polite">{zoomStatus}</span>
      <div className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-center gap-1 text-xs leading-tight text-text-muted">
        <span className={!showZoomControls && firstDay === lastDay ? 'col-span-3 text-center' : undefined}>
          {formatDate(visibleStartMs)}
        </span>
        {showZoomControls && (
          <div className="flex items-center" role="group" aria-label="History zoom">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label="Zoom out history"
              onClick={() => setZoom(boundedZoomIndex - 1)}
              disabled={boundedZoomIndex === 0}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label="Zoom in history"
              onClick={() => setZoom(boundedZoomIndex + 1)}
              disabled={boundedZoomIndex === zoomDurations.length - 1}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        {firstDay === lastDay
          ? showZoomControls && <span />
          : <span className="text-right">{formatDate(visibleEndMs)}</span>}
      </div>
    </section>
  )
}
