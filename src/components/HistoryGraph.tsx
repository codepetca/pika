'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import type { AssignmentDocHistoryEntry } from '@/types'
import {
  computeCharDiffs,
  computeStemLayout,
  findNearestStem,
  groupByDate,
  type Stem,
  type StemLayout,
} from '@/lib/history-graph'

// ── Props ──────────────────────────────────────────────────────────

export interface HistoryGraphProps {
  entries: AssignmentDocHistoryEntry[]
  activeEntryId: string | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  variant?: 'desktop' | 'mobile'
}

// ── Constants ──────────────────────────────────────────────────────

const CHART_HEIGHT = 32
const TZ = 'America/Toronto'
const MIN_TAP_WIDTH = 44

// ── Color helpers ──────────────────────────────────────────────────

function stemColor(color: Stem['color']): string {
  switch (color) {
    case 'success':
      return 'var(--color-success)'
    case 'danger':
      return 'var(--color-danger)'
    case 'warning':
      return 'var(--color-warning)'
    case 'muted':
      return 'var(--color-text-muted)'
  }
}

function diffColorClass(color: Stem['color']): string {
  switch (color) {
    case 'success':
      return 'text-success'
    case 'danger':
      return 'text-danger'
    case 'warning':
      return 'text-warning'
    case 'muted':
      return 'text-text-muted'
  }
}

// ── HourChart sub-component ─────────────────────────────────────────

interface HourChartProps {
  layout: StemLayout
  width: number
  activeEntryId: string | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  variant: 'desktop' | 'mobile'
}

function HourChart({
  layout,
  width,
  activeEntryId,
  onEntryClick,
  onEntryHover,
  variant,
}: HourChartProps) {
  const { stems, baselineY } = layout
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1)
  const lastHoveredRef = useRef<number>(-1)

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (variant === 'mobile') return
      const rect = e.currentTarget.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const idx = findNearestStem(mouseX, stems)
      if (idx !== lastHoveredRef.current) {
        lastHoveredRef.current = idx
        setHoveredIndex(idx)
        if (idx >= 0 && onEntryHover) {
          onEntryHover(stems[idx].entry)
        }
      }
    },
    [stems, onEntryHover, variant]
  )

  const handleMouseLeave = useCallback(() => {
    lastHoveredRef.current = -1
    setHoveredIndex(-1)
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (variant === 'mobile') return
      const rect = e.currentTarget.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const idx = findNearestStem(mouseX, stems)
      if (idx >= 0) {
        onEntryClick(stems[idx].entry)
      }
    },
    [stems, onEntryClick, variant]
  )

  const handleTap = useCallback(
    (entry: AssignmentDocHistoryEntry) => {
      onEntryClick(entry)
    },
    [onEntryClick]
  )

  if (stems.length === 0) return null

  const margin = 3
  const usableHeight = CHART_HEIGHT / 2 - margin

  // Compute tap target width for mobile
  const tapWidth = Math.max(MIN_TAP_WIDTH, width / stems.length)

  const hoveredStem = hoveredIndex >= 0 ? stems[hoveredIndex] : null

  return (
    <div className="relative">
      <svg
        width={width}
        height={CHART_HEIGHT}
        className="block"
        onMouseMove={variant === 'desktop' ? handleMouseMove : undefined}
        onMouseLeave={variant === 'desktop' ? handleMouseLeave : undefined}
        onClick={variant === 'desktop' ? handleClick : undefined}
        style={{ cursor: variant === 'desktop' ? 'crosshair' : undefined }}
      >
        {/* Baseline */}
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="var(--color-border)"
          strokeWidth={1}
        />

        {/* Active entry highlight */}
        {stems.map((stem, i) =>
          stem.entry.id === activeEntryId ? (
            <rect
              key={`active-${i}`}
              x={stem.x - 4}
              y={0}
              width={8}
              height={CHART_HEIGHT}
              fill="var(--color-info-bg)"
              rx={2}
            />
          ) : null
        )}

        {/* Stems */}
        {stems.map((stem, i) => {
          const pixelHeight = stem.height * usableHeight
          const y1 = baselineY
          const y2 =
            stem.direction === 'up'
              ? baselineY - pixelHeight
              : baselineY + pixelHeight
          const color = stemColor(stem.color)

          return (
            <g key={`stem-${i}`}>
              <line
                x1={stem.x}
                y1={y1}
                x2={stem.x}
                y2={y2}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
              />
              {stem.hasPaste && (
                <circle
                  cx={stem.x}
                  cy={y2}
                  r={2.5}
                  fill={color}
                />
              )}
            </g>
          )
        })}

        {/* Hover cursor line */}
        {hoveredStem && (
          <line
            x1={hoveredStem.x}
            y1={0}
            x2={hoveredStem.x}
            y2={CHART_HEIGHT}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="2 2"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Mobile tap targets */}
        {variant === 'mobile' &&
          stems.map((stem, i) => (
            <rect
              key={`tap-${i}`}
              x={stem.x - tapWidth / 2}
              y={0}
              width={tapWidth}
              height={CHART_HEIGHT}
              fill="transparent"
              onClick={(e) => {
                e.stopPropagation()
                handleTap(stem.entry)
              }}
            />
          ))}
      </svg>

      {/* Tooltip (desktop hover only) */}
      {hoveredStem && variant === 'desktop' && (
        <div
          className="absolute pointer-events-none bg-surface border border-border rounded px-2 py-1 shadow-sm text-xs whitespace-nowrap"
          style={{
            bottom: CHART_HEIGHT + 4,
            left: Math.max(
              0,
              Math.min(hoveredStem.x - 40, width - 80)
            ),
          }}
        >
          <span className="font-mono text-text-muted">
            {formatInTimeZone(
              new Date(hoveredStem.entry.created_at),
              TZ,
              'h:mmaaa'
            )}
          </span>
          <span className={`ml-2 font-medium ${diffColorClass(hoveredStem.color)}`}>
            {hoveredStem.charDiff > 0 ? '+' : ''}
            {hoveredStem.charDiff}
          </span>
          {hoveredStem.hasPaste && (
            <span className="ml-2 text-warning font-medium">paste</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main HistoryGraph component ────────────────────────────────────

/** Width reserved for the hour label on the left side */
const HOUR_LABEL_WIDTH = 24

/** Convert 24h hour to 12h display number */
function displayHour(h: number): number {
  if (h === 0) return 12
  if (h > 12) return h - 12
  return h
}

export function HistoryGraph({
  entries,
  activeEntryId,
  onEntryClick,
  onEntryHover,
  variant = 'desktop',
}: HistoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.floor(entry.contentRect.width))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const diffs = useMemo(() => computeCharDiffs(entries), [entries])
  const dayGroups = useMemo(() => groupByDate(diffs), [diffs])

  // Compute layouts per hour within each day
  const dayLayouts = useMemo(() => {
    if (width === 0) return []
    const chartWidth = width - 24 - HOUR_LABEL_WIDTH // px-3 padding + hour label
    if (chartWidth <= 0) return []
    return dayGroups.map((group) =>
      group.hours.map((hour) =>
        computeStemLayout(hour.entries, chartWidth)
      )
    )
  }, [dayGroups, width])

  if (entries.length === 0) {
    return (
      <div ref={containerRef} className="px-3 py-2">
        <p className="text-xs text-text-muted">No saves yet</p>
      </div>
    )
  }

  const chartWidth = width - 24 - HOUR_LABEL_WIDTH

  return (
    <div ref={containerRef}>
      {dayGroups.map((group, dayIdx) => (
        <div key={group.date} className="px-3 py-2">
          <div className="text-[10px] font-medium text-text-muted bg-surface-2 rounded px-1.5 py-0.5 mb-1">
            {group.date}
          </div>
          <div className="space-y-0.5">
            {group.hours.map((hour, hourIdx) => {
              const layout = dayLayouts[dayIdx]?.[hourIdx]
              const isPM = hour.hour >= 12
              return (
                <div key={hour.hour} className="flex relative" style={{ height: CHART_HEIGHT }}>
                  <span
                    className={`text-[10px] font-mono shrink-0 absolute leading-none w-6 text-right ${
                      isPM ? 'font-bold text-text-default' : 'text-text-muted'
                    }`}
                    style={{
                      top: (layout?.baselineY ?? CHART_HEIGHT / 2) - 5,
                    }}
                  >
                    {displayHour(hour.hour)}
                  </span>
                  <div style={{ marginLeft: HOUR_LABEL_WIDTH }}>
                    {width > 0 && layout && (
                      <HourChart
                        layout={layout}
                        width={chartWidth}
                        activeEntryId={activeEntryId}
                        onEntryClick={onEntryClick}
                        onEntryHover={onEntryHover}
                        variant={variant}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
