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
  computeHistoryWindowTransform,
  easeHistoryZoomProgress,
  computeHistoryZoomWindow,
  computeLinearChangeHeight,
  groupActivityByDay,
  interpolateActivityWindow,
  sampleHistoryEntries,
  type ActivityWindow,
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

interface ZoomTween {
  fromWindow: ActivityWindow
  toWindow: ActivityWindow
  fromSaveMaxAbsChange: number
  toSaveMaxAbsChange: number
  fromDailyOpacity: number
  toDailyOpacity: number
}

interface RenderedHistoryFrame {
  window: ActivityWindow
  dailyOpacity: number
  saveMaxAbsChange: number
  visibleDailyGroups: ReturnType<typeof groupActivityByDay>
  dayPositions: number[]
  visibleDiffs: EntryWithDiff[]
  positions: number[]
}

interface HistoryScene {
  window: ActivityWindow
  dailyGroups: ReturnType<typeof groupActivityByDay>
  dayPositions: number[]
  diffs: EntryWithDiff[]
  positions: number[]
}

interface ZoomTweenFrame {
  window: ActivityWindow
  progress: number
  saveMaxAbsChange: number
  dailyOpacity: number
}

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

function timestampInWindow(timestamp: number, window: ActivityWindow): boolean {
  return timestamp >= window.startMs && timestamp <= window.endMs
}

function timestampInWindows(timestamp: number, windows: ActivityWindow[]): boolean {
  return windows.some((window) => timestampInWindow(timestamp, window))
}

function positionInUnclampedWindow(timestamp: number, window: ActivityWindow): number {
  const duration = window.endMs - window.startMs
  if (duration <= 0) return CHART_INSET
  return CHART_INSET
    + ((timestamp - window.startMs) / duration) * (CHART_WIDTH - CHART_INSET * 2)
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
  const [zoomTween, setZoomTween] = useState<ZoomTween | null>(null)
  const lastHoveredEntryIdRef = useRef<string | null>(null)
  const previousActiveEntryIdRef = useRef<string | null>(activeEntryId)
  const lastWheelZoomAtRef = useRef(0)
  const chartRef = useRef<SVGSVGElement | null>(null)
  const dailyPlotRef = useRef<SVGGElement | null>(null)
  const savePlotRef = useRef<SVGGElement | null>(null)
  const sceneRef = useRef<HistoryScene | null>(null)
  const renderedFrameRef = useRef<RenderedHistoryFrame | null>(null)
  const zoomAnimationFrameRef = useRef<number | null>(null)
  const zoomStatusId = useId()
  const gestureInstructionsId = useId()
  const historyKey = `${entries[0]?.id ?? 'empty'}:${entries[entries.length - 1]?.id ?? 'empty'}:${entries.length}`

  useEffect(() => {
    setZoomIndex(0)
    setZoomAnchorMs(null)
    setHoveredEntryId(null)
    lastHoveredEntryIdRef.current = null
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current)
      zoomAnimationFrameRef.current = null
    }
    setZoomTween(null)
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
  const effectiveZoomAnchorMs = zoomAnchorMs ?? selectedEntryMs
  const visibleWindow = useMemo(
    () => fullWindow
      ? computeHistoryZoomWindow(
          fullWindow,
          zoomDurations[boundedZoomIndex] ?? fullWindow.endMs - fullWindow.startMs,
          effectiveZoomAnchorMs
        )
      : null,
    [boundedZoomIndex, effectiveZoomAnchorMs, fullWindow, zoomDurations]
  )
  const fullDuration = fullWindow ? fullWindow.endMs - fullWindow.startMs : 0
  const zoomDurationMs = visibleWindow ? visibleWindow.endMs - visibleWindow.startMs : 0
  const showZoomControls = zoomDurations.length > 1 && diffs.length > 1
  const isOverview = boundedZoomIndex === 0
    && (fullDuration > OVERVIEW_DAY_THRESHOLD_MS || diffs.length > OVERVIEW_ENTRY_THRESHOLD)
  const isZoomTweening = zoomTween !== null
  const dailyGroups = useMemo(() => groupActivityByDay(diffs), [diffs])
  const sceneWindow = zoomTween?.toWindow ?? visibleWindow
  const dailySceneWindows = useMemo(() => {
    if (!sceneWindow) return []
    if (!zoomTween) return isOverview ? [sceneWindow] : []

    const windows: ActivityWindow[] = []
    if (zoomTween.fromDailyOpacity > 0) windows.push(zoomTween.fromWindow)
    if (zoomTween.toDailyOpacity > 0) windows.push(zoomTween.toWindow)
    return windows
  }, [isOverview, sceneWindow, zoomTween])
  const saveSceneWindows = useMemo(() => {
    if (!sceneWindow) return []
    if (!zoomTween) return isOverview ? [] : [sceneWindow]

    const windows: ActivityWindow[] = []
    if (zoomTween.fromDailyOpacity < 1) windows.push(zoomTween.fromWindow)
    if (zoomTween.toDailyOpacity < 1) windows.push(zoomTween.toWindow)
    return windows
  }, [isOverview, sceneWindow, zoomTween])
  const sceneDailyGroups = useMemo(() => {
    return dailyGroups.filter((group) => (
      timestampInWindows(group.midpointMs, dailySceneWindows)
    ))
  }, [dailyGroups, dailySceneWindows])
  const sceneDiffs = useMemo(() => {
    const candidates = diffs.filter((entry) => {
      const timestamp = Date.parse(entry.entry.created_at)
      return timestampInWindows(timestamp, saveSceneWindows)
    })
    return sampleHistoryEntries(candidates, undefined, selectedEntry?.entry.id)
  }, [diffs, saveSceneWindows, selectedEntry?.entry.id])
  const scenePositions = useMemo(() => {
    if (!sceneWindow) return []
    const targetDiffs = sceneDiffs.filter((entry) => (
      timestampInWindow(Date.parse(entry.entry.created_at), sceneWindow)
    ))
    const targetPositions = computeActivityPositions(
      targetDiffs,
      sceneWindow,
      CHART_WIDTH,
      CHART_INSET,
    )
    const targetPositionById = new Map(
      targetDiffs.map((entry, index) => [entry.entry.id, targetPositions[index]])
    )
    return sceneDiffs.map((entry) => (
      targetPositionById.get(entry.entry.id)
      ?? positionInUnclampedWindow(Date.parse(entry.entry.created_at), sceneWindow)
    ))
  }, [sceneDiffs, sceneWindow])
  const sceneDayPositions = useMemo(
    () => sceneWindow
      ? sceneDailyGroups.map((group) => positionInUnclampedWindow(group.midpointMs, sceneWindow))
      : [],
    [sceneDailyGroups, sceneWindow]
  )
  const targetVisibleDiffs = useMemo(
    () => sceneWindow
      ? diffs.filter((entry) => (
          timestampInWindow(Date.parse(entry.entry.created_at), sceneWindow)
        ))
      : [],
    [diffs, sceneWindow]
  )
  const targetSaveMaxAbsChange = Math.max(
    1,
    ...targetVisibleDiffs.map((entry) => Math.abs(entry.charDiff)),
  )
  const sceneSaveMaxAbsChange = Math.max(
    1,
    ...sceneDiffs.map((entry) => Math.abs(entry.charDiff)),
  )
  const dailyMaxAbsChange = Math.max(
    1,
    ...dailyGroups.flatMap((group) => [group.additions, group.deletions]),
  )
  const targetDailyOpacity = isOverview ? 1 : 0
  const showDailyLayer = isOverview || Boolean(
    zoomTween && (zoomTween.fromDailyOpacity > 0 || zoomTween.toDailyOpacity > 0)
  )
  const showSaveLayer = !isOverview || Boolean(
    zoomTween && (zoomTween.fromDailyOpacity < 1 || zoomTween.toDailyOpacity < 1)
  )
  sceneRef.current = sceneWindow ? {
    window: sceneWindow,
    dailyGroups: sceneDailyGroups,
    dayPositions: sceneDayPositions,
    diffs: sceneDiffs,
    positions: scenePositions,
  } : null

  const finishZoomTween = useCallback(() => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current)
      zoomAnimationFrameRef.current = null
    }
    setZoomTween(null)
  }, [])

  const startZoomTween = useCallback((tween: ZoomTween) => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current)
      zoomAnimationFrameRef.current = null
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setZoomTween(null)
      return
    }
    setZoomTween(tween)
  }, [])

  const applyZoomFrame = useCallback((frame: ZoomTweenFrame) => {
    const chart = chartRef.current
    const dailyPlot = dailyPlotRef.current
    const savePlot = savePlotRef.current
    const scene = sceneRef.current
    if (!chart || !scene) return

    const { scaleX, translateX } = computeHistoryWindowTransform(
      scene.window,
      frame.window,
      CHART_WIDTH,
      CHART_INSET,
    )
    const saveScaleY = scene.diffs.length > 0
      ? sceneSaveMaxAbsChange / Math.max(1, frame.saveMaxAbsChange)
      : 1

    const xTransform = `matrix(${scaleX} 0 0 1 ${translateX} 0)`
    if (dailyPlot) {
      dailyPlot.setAttribute('transform', xTransform)
      dailyPlot.setAttribute('opacity', String(frame.dailyOpacity))
    }
    if (savePlot) {
      savePlot.setAttribute(
        'transform',
        `matrix(${scaleX} 0 0 ${saveScaleY} ${translateX} ${BASELINE_Y * (1 - saveScaleY)})`,
      )
      savePlot.setAttribute('opacity', String(1 - frame.dailyOpacity))
    }

    const keepMarkerShape = (
      plot: SVGGElement,
      inverseScaleY: number,
    ) => {
      plot.querySelectorAll<SVGCircleElement>('[data-history-fixed-marker]').forEach((marker) => {
        const cx = Number(marker.getAttribute('cx'))
        const cy = Number(marker.getAttribute('cy'))
        marker.setAttribute(
          'transform',
          `translate(${cx} ${cy}) scale(${1 / scaleX} ${inverseScaleY}) translate(${-cx} ${-cy})`,
        )
      })
    }
    if (dailyPlot) keepMarkerShape(dailyPlot, 1)
    if (savePlot) keepMarkerShape(savePlot, 1 / saveScaleY)

    chart.setAttribute('data-rendered-start-ms', String(frame.window.startMs))
    chart.setAttribute('data-rendered-end-ms', String(frame.window.endMs))
    if (frame.progress >= 1) {
      chart.removeAttribute('data-zoom-tween-progress')
    } else {
      chart.setAttribute('data-zoom-tween-progress', String(frame.progress))
    }

    const visibleDailyGroups: ReturnType<typeof groupActivityByDay> = []
    const dayPositions: number[] = []
    scene.dailyGroups.forEach((group, index) => {
      if (!timestampInWindow(group.midpointMs, frame.window)) return
      visibleDailyGroups.push(group)
      dayPositions.push(scene.dayPositions[index] * scaleX + translateX)
    })
    const visibleFrameDiffs: EntryWithDiff[] = []
    const framePositions: number[] = []
    scene.diffs.forEach((entry, index) => {
      if (!timestampInWindow(Date.parse(entry.entry.created_at), frame.window)) return
      visibleFrameDiffs.push(entry)
      framePositions.push(scene.positions[index] * scaleX + translateX)
    })
    renderedFrameRef.current = {
      window: frame.window,
      dailyOpacity: frame.dailyOpacity,
      saveMaxAbsChange: frame.saveMaxAbsChange,
      visibleDailyGroups,
      dayPositions,
      visibleDiffs: visibleFrameDiffs,
      positions: framePositions,
    }
  }, [sceneSaveMaxAbsChange])

  useLayoutEffect(() => {
    if (!visibleWindow) return
    if (!zoomTween) {
      applyZoomFrame({
        window: visibleWindow,
        progress: 1,
        saveMaxAbsChange: targetSaveMaxAbsChange,
        dailyOpacity: targetDailyOpacity,
      })
      return
    }

    let startTime: number | null = null
    applyZoomFrame({
      window: zoomTween.fromWindow,
      progress: 0,
      saveMaxAbsChange: zoomTween.fromSaveMaxAbsChange,
      dailyOpacity: zoomTween.fromDailyOpacity,
    })

    const drawFrame = (timestamp: number) => {
      startTime ??= timestamp
      const linearProgress = Math.min(1, (timestamp - startTime) / ZOOM_ANIMATION_MS)
      const easedProgress = easeHistoryZoomProgress(linearProgress)
      applyZoomFrame({
        window: interpolateActivityWindow(
          zoomTween.fromWindow,
          zoomTween.toWindow,
          easedProgress,
        ),
        progress: easedProgress,
        saveMaxAbsChange: zoomTween.fromSaveMaxAbsChange
          + (zoomTween.toSaveMaxAbsChange - zoomTween.fromSaveMaxAbsChange) * easedProgress,
        dailyOpacity: zoomTween.fromDailyOpacity
          + (zoomTween.toDailyOpacity - zoomTween.fromDailyOpacity) * easedProgress,
      })

      if (linearProgress >= 1) {
        zoomAnimationFrameRef.current = null
        setZoomTween(null)
        return
      }
      zoomAnimationFrameRef.current = requestAnimationFrame(drawFrame)
    }

    zoomAnimationFrameRef.current = requestAnimationFrame(drawFrame)
    return () => {
      if (zoomAnimationFrameRef.current !== null) {
        cancelAnimationFrame(zoomAnimationFrameRef.current)
        zoomAnimationFrameRef.current = null
      }
    }
  }, [applyZoomFrame, targetDailyOpacity, targetSaveMaxAbsChange, visibleWindow, zoomTween])

  const selectByIndex = useCallback((index: number) => {
    const next = diffs[Math.max(0, Math.min(diffs.length - 1, index))]
    if (!next) return
    finishZoomTween()
    setZoomAnchorMs(Date.parse(next.entry.created_at))
    onEntryClick(next.entry)
  }, [diffs, finishZoomTween, onEntryClick])

  const findNearestEntry = useCallback((clientX: number, clientY: number, bounds: DOMRect) => {
    const frame = renderedFrameRef.current
    if (!frame || bounds.width <= 0) return null
    let nearestEntry: EntryWithDiff | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    if (frame.dailyOpacity >= 0.5) {
      for (let index = 0; index < frame.visibleDailyGroups.length; index += 1) {
        const group = frame.visibleDailyGroups[index]
        const entryX = bounds.left + (frame.dayPositions[index] / CHART_WIDTH) * bounds.width
        const distance = Math.abs(clientX - entryX)
        if (distance < nearestDistance) {
          nearestEntry = group.finalEntry
          nearestDistance = distance
        }
      }
      return nearestEntry
    }

    for (let index = 0; index < frame.visibleDiffs.length; index += 1) {
      const entry = frame.visibleDiffs[index]
      const entryX = bounds.left + (frame.positions[index] / CHART_WIDTH) * bounds.width
      const entryY = bounds.top
        + (pointY(entry.charDiff, frame.saveMaxAbsChange) / CHART_HEIGHT) * bounds.height
      const distance = Math.hypot(clientX - entryX, clientY - entryY)
      if (distance < nearestDistance) {
        nearestEntry = entry
        nearestDistance = distance
      }
    }

    return nearestEntry
  }, [])

  const handlePointer = useCallback((event: React.MouseEvent<SVGSVGElement>, select: boolean) => {
    if (select) finishZoomTween()
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
  }, [findNearestEntry, finishZoomTween, hoverEnabled, onEntryClick, onEntryHover])

  const setZoom = useCallback(
    (
      nextIndex: number,
      anchorMs: number = zoomAnchorMs ?? selectedEntryMs,
    ) => {
      const fromFrame = renderedFrameRef.current
      if (!fullWindow || !visibleWindow || !fromFrame) return
      const boundedIndex = Math.max(0, Math.min(zoomDurations.length - 1, nextIndex))
      const nextWindow = computeHistoryZoomWindow(
        fullWindow,
        zoomDurations[boundedIndex] ?? fullDuration,
        anchorMs
      )
      const nextIsOverview = boundedIndex === 0
        && (fullDuration > OVERVIEW_DAY_THRESHOLD_MS || diffs.length > OVERVIEW_ENTRY_THRESHOLD)
      const nextVisibleDiffs = diffs.filter((entry) => {
        const timestamp = Date.parse(entry.entry.created_at)
        return timestamp >= nextWindow.startMs && timestamp <= nextWindow.endMs
      })
      const nextSaveMaxAbsChange = Math.max(
        1,
        ...nextVisibleDiffs.map((entry) => Math.abs(entry.charDiff)),
      )
      startZoomTween({
        fromWindow: fromFrame.window,
        toWindow: nextWindow,
        fromSaveMaxAbsChange: fromFrame.saveMaxAbsChange,
        toSaveMaxAbsChange: nextSaveMaxAbsChange,
        fromDailyOpacity: fromFrame.dailyOpacity,
        toDailyOpacity: nextIsOverview ? 1 : 0,
      })
      setZoomAnchorMs((nextWindow.startMs + nextWindow.endMs) / 2)
      setZoomIndex(boundedIndex)
    },
    [
      diffs,
      fullDuration,
      fullWindow,
      selectedEntryMs,
      startZoomTween,
      visibleWindow,
      zoomAnchorMs,
      zoomDurations,
    ]
  )

  useEffect(() => () => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current)
    }
  }, [])

  const handleWheel = useCallback((event: WheelEvent) => {
    const renderedFrame = renderedFrameRef.current
    if (!fullWindow || !visibleWindow || !renderedFrame) return
    const bounds = chartRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return

    const horizontalDelta = event.shiftKey ? event.deltaY : event.deltaX
    const isPanGesture = boundedZoomIndex > 0
      && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))

    if (isPanGesture && horizontalDelta !== 0) {
      event.preventDefault()
      const renderedDurationMs = renderedFrame.window.endMs - renderedFrame.window.startMs
      const currentCenter = (renderedFrame.window.startMs + renderedFrame.window.endMs) / 2
      const panRatio = Math.max(-0.95, Math.min(0.95, horizontalDelta / bounds.width))
      const panDurationMs = Math.min(renderedDurationMs, zoomDurationMs)
      const nextCenter = currentCenter + panRatio * panDurationMs
      const nextWindow = computeHistoryZoomWindow(fullWindow, zoomDurationMs, nextCenter)

      if (
        nextWindow.startMs !== visibleWindow.startMs
        || nextWindow.endMs !== visibleWindow.endMs
      ) {
        if (isZoomTweening) {
          const nextVisibleDiffs = diffs.filter((entry) => {
            const timestamp = Date.parse(entry.entry.created_at)
            return timestamp >= nextWindow.startMs && timestamp <= nextWindow.endMs
          })
          const nextSaveMaxAbsChange = Math.max(
            1,
            ...nextVisibleDiffs.map((entry) => Math.abs(entry.charDiff)),
          )
          startZoomTween({
            fromWindow: renderedFrame.window,
            toWindow: nextWindow,
            fromSaveMaxAbsChange: renderedFrame.saveMaxAbsChange,
            toSaveMaxAbsChange: nextSaveMaxAbsChange,
            fromDailyOpacity: renderedFrame.dailyOpacity,
            toDailyOpacity: isOverview ? 1 : 0,
          })
        }
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
    setZoom(nextIndex, nextAnchor)
  }, [
    boundedZoomIndex,
    diffs,
    fullDuration,
    fullWindow,
    isOverview,
    isZoomTweening,
    setZoom,
    showZoomControls,
    startZoomTween,
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

  if (entries.length === 0 || !fullWindow || !visibleWindow || !sceneWindow || !selectedEntry) {
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
          <g>
            <line
            x1={CHART_INSET}
            y1={BASELINE_Y}
            x2={CHART_WIDTH - CHART_INSET}
            y2={BASELINE_Y}
            stroke="var(--color-border-strong)"
            strokeWidth={2}
          />
            {showDailyLayer && <g
              ref={dailyPlotRef}
              data-history-view-layer="daily"
              opacity={targetDailyOpacity}
              aria-hidden={!isOverview}
              pointerEvents="none"
            >
                {sceneDailyGroups.map((group, index) => {
                const x = sceneDayPositions[index]
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
                  <g key={group.day} data-activity-day={group.day}>
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
                        data-history-fixed-marker="true"
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
                          vectorEffect="non-scaling-stroke"
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
                          vectorEffect="non-scaling-stroke"
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
                        data-history-fixed-marker={isSelected ? 'true' : undefined}
                        data-change-direction={isOverview ? 'none' : undefined}
                        data-change-value={isOverview ? 0 : undefined}
                      />
                    )}
                  </g>
                )
                })}
            </g>}
            {showSaveLayer && <g
              ref={savePlotRef}
              data-history-view-layer="saves"
              opacity={1 - targetDailyOpacity}
              aria-hidden={isOverview}
              pointerEvents="none"
            >
                {sceneDiffs.map((entry, index) => {
                const x = scenePositions[index]
                const y = pointY(entry.charDiff, sceneSaveMaxAbsChange)
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
                    data-history-entry-id={entry.entry.id}
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
                      vectorEffect="non-scaling-stroke"
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
                        data-history-fixed-marker="true"
                      />
                    )}
                  </g>
                )
                })}
            </g>}
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
