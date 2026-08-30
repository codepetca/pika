'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  hoverEnabled?: boolean
}

const TZ = 'America/Toronto'
const CHART_WIDTH = 256
const CHART_HEIGHT = 78
const CHART_INSET = 5
const BASELINE_Y = CHART_HEIGHT / 2
const MAX_CHANGE_HEIGHT = 28
const OVERVIEW_DAY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000
const OVERVIEW_ENTRY_THRESHOLD = 60
const ZOOM_ANIMATION_MS = 420
const WHEEL_ZOOM_THROTTLE_MS = ZOOM_ANIMATION_MS
const MIN_ZOOM_ANIMATION_SCALE = 0.05
const MAX_ZOOM_ANIMATION_SCALE = 20

function formatDate(timestamp: number): string {
  return formatInTimeZone(new Date(timestamp), TZ, 'MMM d')
}

function formatTime(timestamp: number): string {
  return formatInTimeZone(new Date(timestamp), TZ, 'h:mm a')
}

function entryLabel(entry: EntryWithDiff, isBaseline: boolean): string {
  const change = isBaseline
    ? 'first save'
    : entry.charDiff === 0
      ? 'no character-count change since previous'
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
  hoverEnabled = true,
}: HistoryGraphProps) {
  const diffs = useMemo(() => computeCharDiffs(entries), [entries])
  const fullWindow = useMemo(() => computeActivityWindow(entries), [entries])
  const heading = audience === 'teacher' ? 'Student activity' : 'Version history'
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null)
  const [zoomIndex, setZoomIndex] = useState(0)
  const [zoomAnchorMs, setZoomAnchorMs] = useState<number | null>(null)
  const [viewTransitionActive, setViewTransitionActive] = useState(false)
  const lastHoveredEntryIdRef = useRef<string | null>(null)
  const previousActiveEntryIdRef = useRef<string | null>(activeEntryId)
  const lastWheelZoomAtRef = useRef(0)
  const chartRef = useRef<SVGSVGElement | null>(null)
  const plotRef = useRef<SVGGElement | null>(null)
  const dailyPlotRef = useRef<SVGGElement | null>(null)
  const savePlotRef = useRef<SVGGElement | null>(null)
  const pendingZoomAnimationRef = useRef<{
    scale: number
    originRatio: number
    viewModeChanged: boolean
  } | null>(null)
  const zoomAnimationRef = useRef<Animation | null>(null)
  const viewModeAnimationsRef = useRef<Animation[]>([])
  const zoomStatusId = useId()
  const gestureInstructionsId = useId()
  const historyKey = `${entries[0]?.id ?? 'empty'}:${entries[entries.length - 1]?.id ?? 'empty'}:${entries.length}`

  useEffect(() => {
    setZoomIndex(0)
    setZoomAnchorMs(null)
    setHoveredEntryId(null)
    lastHoveredEntryIdRef.current = null
    zoomAnimationRef.current?.cancel()
    zoomAnimationRef.current = null
    viewModeAnimationsRef.current.forEach((animation) => animation.cancel())
    viewModeAnimationsRef.current = []
    pendingZoomAnimationRef.current = null
    setViewTransitionActive(false)
  }, [historyKey])

  useEffect(() => {
    if (!hoverEnabled) {
      setHoveredEntryId(null)
      lastHoveredEntryIdRef.current = null
    }
  }, [hoverEnabled])

  useEffect(() => {
    if (previousActiveEntryIdRef.current !== null && activeEntryId === null) {
      setZoomAnchorMs(null)
    }
    previousActiveEntryIdRef.current = activeEntryId
  }, [activeEntryId])

  const activeIndex = diffs.findIndex((entry) => entry.entry.id === activeEntryId)
  const hoveredIndex = hoverEnabled
    ? diffs.findIndex((entry) => entry.entry.id === hoveredEntryId)
    : -1
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
  const zoomDurationMs = visibleWindow ? visibleWindow.endMs - visibleWindow.startMs : 0
  const showZoomControls = zoomDurations.length > 1 && diffs.length > 1
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

  const cancelZoomAnimation = useCallback(() => {
    pendingZoomAnimationRef.current = null
    zoomAnimationRef.current?.cancel()
    zoomAnimationRef.current = null
    viewModeAnimationsRef.current.forEach((animation) => animation.cancel())
    viewModeAnimationsRef.current = []
    setViewTransitionActive(false)
  }, [])

  const selectByIndex = useCallback((index: number) => {
    const next = diffs[Math.max(0, Math.min(diffs.length - 1, index))]
    if (!next) return
    cancelZoomAnimation()
    setZoomAnchorMs(Date.parse(next.entry.created_at))
    onEntryClick(next.entry)
  }, [cancelZoomAnimation, diffs, onEntryClick])

  const dailyMaxAbsChange = Math.max(
    1,
    ...dailyGroups.flatMap((group) => [group.additions, group.deletions]),
  )
  const saveMaxAbsChange = Math.max(
    1,
    ...visibleDiffs.map((entry) => Math.abs(entry.charDiff)),
  )
  const maxAbsChange = isOverview ? dailyMaxAbsChange : saveMaxAbsChange

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
    cancelZoomAnimation()
    const entry = findNearestEntry(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect()
    )
    if (!entry) return

    if (select) {
      setZoomAnchorMs(Date.parse(entry.entry.created_at))
      onEntryClick(entry.entry)
      return
    }

    if (!hoverEnabled) return

    if (entry.entry.id !== lastHoveredEntryIdRef.current) {
      lastHoveredEntryIdRef.current = entry.entry.id
      setHoveredEntryId(entry.entry.id)
      onEntryHover?.(entry.entry)
    }
  }, [cancelZoomAnimation, findNearestEntry, hoverEnabled, onEntryClick, onEntryHover])

  const setZoom = useCallback(
    (
      nextIndex: number,
      anchorMs: number = zoomAnchorMs ?? selectedEntryMs,
      animationOriginRatio?: number
    ) => {
      if (!fullWindow || !visibleWindow) return
      const boundedIndex = Math.max(0, Math.min(zoomDurations.length - 1, nextIndex))
      const nextWindow = computeHistoryZoomWindow(
        fullWindow,
        zoomDurations[boundedIndex] ?? fullDuration,
        anchorMs
      )
      const currentDuration = visibleWindow.endMs - visibleWindow.startMs
      const nextDuration = nextWindow.endMs - nextWindow.startMs
      const nextIsOverview = boundedIndex === 0
        && (fullDuration > OVERVIEW_DAY_THRESHOLD_MS || diffs.length > OVERVIEW_ENTRY_THRESHOLD)
      const viewModeChanged = nextIsOverview !== isOverview
      pendingZoomAnimationRef.current = {
        // Render the new window at the exact visual scale of the old one, then
        // ease it to 1. This keeps bars spatially continuous in both directions
        // instead of jumping most of the distance before the animation begins.
        scale: Math.max(
          MIN_ZOOM_ANIMATION_SCALE,
          Math.min(MAX_ZOOM_ANIMATION_SCALE, nextDuration / currentDuration),
        ),
        originRatio: animationOriginRatio
          ?? positionInActivityWindow(anchorMs, visibleWindow),
        viewModeChanged,
      }
      setViewTransitionActive(viewModeChanged)
      setZoomAnchorMs((nextWindow.startMs + nextWindow.endMs) / 2)
      setZoomIndex(boundedIndex)
    },
    [diffs.length, fullDuration, fullWindow, isOverview, selectedEntryMs, visibleWindow, zoomAnchorMs, zoomDurations]
  )

  useLayoutEffect(() => {
    const pending = pendingZoomAnimationRef.current
    pendingZoomAnimationRef.current = null
    const plot = plotRef.current
    if (!pending || !plot) return
    if (
      typeof plot.animate !== 'function'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setViewTransitionActive(false)
      return
    }

    zoomAnimationRef.current?.cancel()
    viewModeAnimationsRef.current.forEach((animation) => animation.cancel())
    viewModeAnimationsRef.current = []
    const animation = plot.animate(
      [
        {
          transform: `scaleX(${pending.scale})`,
          transformOrigin: `${pending.originRatio * 100}% 50%`,
        },
        {
          transform: 'scaleX(1)',
          transformOrigin: `${pending.originRatio * 100}% 50%`,
        },
      ],
      {
        duration: ZOOM_ANIMATION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      }
    )
    if (pending.viewModeChanged) {
      const options: KeyframeAnimationOptions = {
        duration: ZOOM_ANIMATION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      }
      const dailyAnimation = typeof dailyPlotRef.current?.animate === 'function'
        ? dailyPlotRef.current.animate(
            isOverview
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [{ opacity: 1 }, { opacity: 0 }],
            options,
          )
        : null
      const saveAnimation = typeof savePlotRef.current?.animate === 'function'
        ? savePlotRef.current.animate(
            isOverview
              ? [{ opacity: 1 }, { opacity: 0 }]
              : [{ opacity: 0 }, { opacity: 1 }],
            options,
          )
        : null
      viewModeAnimationsRef.current = [dailyAnimation, saveAnimation].filter(
        (candidate): candidate is Animation => Boolean(candidate),
      )
    }
    zoomAnimationRef.current = animation
    animation.onfinish = () => {
      if (zoomAnimationRef.current === animation) {
        zoomAnimationRef.current = null
        viewModeAnimationsRef.current = []
        setViewTransitionActive(false)
      }
    }
  }, [boundedZoomIndex, isOverview])

  useEffect(() => () => {
    zoomAnimationRef.current?.cancel()
    viewModeAnimationsRef.current.forEach((animation) => animation.cancel())
  }, [])

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!fullWindow || !visibleWindow) return
    const bounds = chartRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return

    const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX
    const isPanGesture = boundedZoomIndex > 0
      && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))

    if (isPanGesture && horizontalDelta !== 0) {
      cancelZoomAnimation()
      event.preventDefault()
      const currentCenter = (visibleWindow.startMs + visibleWindow.endMs) / 2
      const nextCenter = currentCenter + (horizontalDelta / bounds.width) * zoomDurationMs
      const nextWindow = computeHistoryZoomWindow(fullWindow, zoomDurationMs, nextCenter)

      if (
        nextWindow.startMs !== visibleWindow.startMs
        || nextWindow.endMs !== visibleWindow.endMs
      ) {
        setZoomAnchorMs((nextWindow.startMs + nextWindow.endMs) / 2)
      }
      return
    }

    if (!showZoomControls || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return

    const nextIndex = Math.max(
      0,
      Math.min(zoomDurations.length - 1, boundedZoomIndex + (event.deltaY < 0 ? 1 : -1))
    )
    if (nextIndex === boundedZoomIndex) return

    event.preventDefault()
    const now = Date.now()
    if (now - lastWheelZoomAtRef.current < WHEEL_ZOOM_THROTTLE_MS) return
    lastWheelZoomAtRef.current = now

    const pointerRatio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const pointerTime = visibleWindow.startMs + pointerRatio * zoomDurationMs
    const nextDuration = zoomDurations[nextIndex] ?? fullDuration
    const nextAnchor = pointerTime + (0.5 - pointerRatio) * nextDuration
    setZoom(nextIndex, nextAnchor, pointerRatio)
  }, [
    boundedZoomIndex,
    cancelZoomAnimation,
    fullDuration,
    fullWindow,
    setZoom,
    showZoomControls,
    visibleWindow,
    zoomDurationMs,
    zoomDurations,
  ])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    chart.addEventListener('wheel', handleWheel, { passive: false })
    return () => chart.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

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
  const zoomStatus = boundedZoomIndex === 0
    ? 'Showing all activity'
    : zoomDurationMs >= 24 * 60 * 60 * 1000
      ? `Showing ${Math.round(zoomDurationMs / (24 * 60 * 60 * 1000))} days`
      : `Showing ${Math.round(zoomDurationMs / (60 * 60 * 1000))} hours`
  return (
    <section className="px-3 py-2" aria-label={heading}>
      {showHeading && <h3 className="text-sm font-semibold text-text-default">{heading}</h3>}
      <div className={`relative overflow-hidden ${showHeading ? 'mt-1' : ''}`}>
        <svg
          ref={chartRef}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="block h-20 w-full cursor-crosshair overflow-hidden outline-none focus-visible:ring-foundation focus-visible:ring-focus"
          role="slider"
          tabIndex={0}
          aria-label="Complete save history"
          aria-valuemin={1}
          aria-valuemax={diffs.length}
          aria-valuenow={selectedIndex + 1}
          aria-valuetext={entryLabel(selectedEntry, selectedIndex === 0)}
          aria-describedby={showZoomControls
            ? `${zoomStatusId} ${gestureInstructionsId}`
            : zoomStatusId}
          data-view-mode={isOverview ? 'daily' : 'saves'}
          data-visible-start-ms={visibleWindow.startMs}
          data-visible-end-ms={visibleWindow.endMs}
          preserveAspectRatio="none"
          onMouseMove={variant === 'desktop' && hoverEnabled
            ? (event) => handlePointer(event, false)
            : undefined}
          onMouseLeave={() => {
            lastHoveredEntryIdRef.current = null
            setHoveredEntryId(null)
          }}
          onClick={(event) => handlePointer(event, true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              selectByIndex(selectedIndex - 1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              selectByIndex(selectedIndex - 1)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              selectByIndex(selectedIndex + 1)
            } else if (event.key === 'ArrowUp') {
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
          <g ref={plotRef}>
            <line
            x1={CHART_INSET}
            y1={BASELINE_Y}
            x2={CHART_WIDTH - CHART_INSET}
            y2={BASELINE_Y}
            stroke="var(--color-border-strong)"
            strokeWidth={2}
          />
            {(isOverview || viewTransitionActive) && (
              <g
                ref={dailyPlotRef}
                data-history-view-layer="daily"
                opacity={isOverview ? 1 : 0}
                aria-hidden={!isOverview}
                pointerEvents="none"
              >
                {dailyGroups.map((group, index) => {
                const x = dayPositions[index]
                const additionY = pointY(group.additions, dailyMaxAbsChange)
                const deletionY = pointY(-group.deletions, dailyMaxAbsChange)
                const isSelected = group.entries.some(
                  (entry) => entry.entry.id === selectedEntry.entry.id
                )
                const additionIsTiny = group.additions > 0
                  && Math.abs(additionY - BASELINE_Y) < 2
                const deletionIsTiny = group.deletions > 0
                  && Math.abs(deletionY - BASELINE_Y) < 2

                return (
                  <g key={group.day} data-activity-day={isOverview ? group.day : undefined}>
                    <title>{`${formatDate(group.midpointMs)}: +${group.additions}, -${group.deletions} characters`}</title>
                    {isSelected && (group.additions > 0 || group.deletions > 0) && (
                      <circle
                        cx={x}
                        cy={BASELINE_Y}
                        r={4}
                        fill="var(--color-surface)"
                        stroke="var(--color-text-default)"
                        strokeWidth={2}
                        data-selected-day="true"
                      />
                    )}
                    {group.additions > 0 && (
                      <>
                        <line
                          x1={x}
                          y1={BASELINE_Y}
                          x2={x}
                          y2={additionY}
                          stroke="var(--color-success)"
                          strokeWidth={isSelected ? 4 : 3}
                          strokeLinecap="round"
                          data-change-direction={isOverview ? 'up' : undefined}
                          data-change-value={isOverview ? group.additions : undefined}
                        />
                        {additionIsTiny && (
                          <circle
                            cx={x}
                            cy={additionY}
                            r={2}
                            fill="var(--color-success)"
                            data-small-change-marker={isOverview ? 'up' : undefined}
                          />
                        )}
                      </>
                    )}
                    {group.deletions > 0 && (
                      <>
                        <line
                          x1={x}
                          y1={BASELINE_Y}
                          x2={x}
                          y2={deletionY}
                          stroke="var(--color-danger)"
                          strokeWidth={isSelected ? 4 : 3}
                          strokeLinecap="round"
                          data-change-direction={isOverview ? 'down' : undefined}
                          data-change-value={isOverview ? group.deletions : undefined}
                        />
                        {deletionIsTiny && (
                          <circle
                            cx={x}
                            cy={deletionY}
                            r={2}
                            fill="var(--color-danger)"
                            data-small-change-marker={isOverview ? 'down' : undefined}
                          />
                        )}
                      </>
                    )}
                    {group.additions === 0 && group.deletions === 0 && (
                      <circle
                        cx={x}
                        cy={BASELINE_Y}
                        r={isSelected ? 4 : 2.5}
                        fill="var(--color-text-muted)"
                        stroke={isSelected ? 'var(--color-surface)' : undefined}
                        strokeWidth={isSelected ? 2 : undefined}
                        data-change-direction={isOverview ? 'none' : undefined}
                        data-change-value={isOverview ? 0 : undefined}
                      />
                    )}
                  </g>
                )
                })}
              </g>
            )}
            {(!isOverview || viewTransitionActive) && (
              <g
                ref={savePlotRef}
                data-history-view-layer="saves"
                opacity={isOverview ? 0 : 1}
                aria-hidden={isOverview}
                pointerEvents="none"
              >
                {visibleDiffs.map((entry, index) => {
                const x = positions[index]
                const y = pointY(entry.charDiff, saveMaxAbsChange)
                const isSelected = entry.entry.id === selectedEntry.entry.id
                const isBaseline = entry.entry.id === diffs[0]?.entry.id
                const direction = entry.charDiff > 0 ? 'up' : entry.charDiff < 0 ? 'down' : 'none'
                const color = entry.charDiff > 0
                  ? 'var(--color-success)'
                  : entry.charDiff < 0
                    ? 'var(--color-danger)'
                    : 'var(--color-text-muted)'
                const isTiny = entry.charDiff !== 0 && Math.abs(y - BASELINE_Y) < 2
                return (
                  <g
                    key={entry.entry.id}
                    data-change-direction={!isOverview ? direction : undefined}
                  >
                    <title>{entryLabel(entry, isBaseline)}</title>
                    <line
                      x1={x}
                      y1={BASELINE_Y}
                      x2={x}
                      y2={y}
                      stroke={color}
                      strokeWidth={isSelected ? 4 : 3}
                      strokeLinecap="round"
                      data-change-value={!isOverview ? Math.abs(entry.charDiff) : undefined}
                    />
                    {isTiny && (
                      <circle
                        cx={x}
                        cy={y}
                        r={2}
                        fill={color}
                        data-small-change-marker={!isOverview ? direction : undefined}
                      />
                    )}
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
              </g>
            )}
          </g>
        </svg>
      </div>

      <span id={zoomStatusId} className="sr-only" aria-live="polite">{zoomStatus}</span>
      {showZoomControls && (
        <span id={gestureInstructionsId} className="sr-only">
          Use the mouse wheel to zoom. Scroll horizontally or hold Shift while scrolling to pan.
        </span>
      )}
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
