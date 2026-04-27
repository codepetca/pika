'use client'

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SummaryDetailWorkspaceShell } from '@/components/SummaryDetailWorkspaceShell'
import { useWindowSize } from '@/hooks/use-window-size'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'

const DEFAULT_MIN_INSPECTOR_PX = 320
const DEFAULT_MIN_PRIMARY_PX = 320

interface TeacherWorkspaceSplitProps {
  primary: ReactNode
  inspector?: ReactNode
  inspectorWidth: number
  onInspectorWidthChange: (nextWidth: number) => void
  inspectorCollapsed: boolean
  onInspectorCollapsedChange?: (collapsed: boolean) => void
  className?: string
  primaryClassName?: string
  inspectorClassName?: string
  dividerLabel?: string
  defaultInspectorWidth?: number
  minInspectorPx?: number
  minPrimaryPx?: number
  minInspectorPercent?: number
  maxInspectorPercent?: number
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10
}

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) return min
  return Math.min(max, Math.max(min, value))
}

function clampInspectorWidthPercent(
  value: number,
  totalWidth: number,
  {
    minInspectorPx,
    minPrimaryPx,
    minInspectorPercent,
    maxInspectorPercent,
  }: {
    minInspectorPx: number
    minPrimaryPx: number
    minInspectorPercent: number
    maxInspectorPercent: number
  },
): number {
  const boundedMinPercent = clampNumber(minInspectorPercent, 0, 100)
  const boundedMaxPercent = clampNumber(maxInspectorPercent, 0, 100)
  const candidate = Number.isFinite(value) ? value : 50

  if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
    return roundPercent(clampNumber(candidate, boundedMinPercent, boundedMaxPercent))
  }

  const minByInspectorPx = minInspectorPx > 0 ? (minInspectorPx / totalWidth) * 100 : 0
  const maxByPrimaryPx = minPrimaryPx > 0 ? ((totalWidth - minPrimaryPx) / totalWidth) * 100 : 100
  const min = clampNumber(Math.max(boundedMinPercent, minByInspectorPx), 0, 100)
  const max = clampNumber(Math.min(boundedMaxPercent, maxByPrimaryPx), 0, 100)

  return roundPercent(clampNumber(candidate, min, max))
}

export function TeacherWorkspaceSplit({
  primary,
  inspector,
  inspectorWidth,
  onInspectorWidthChange,
  inspectorCollapsed,
  onInspectorCollapsedChange,
  className,
  primaryClassName,
  inspectorClassName,
  dividerLabel = 'Resize workspace panes',
  defaultInspectorWidth = 50,
  minInspectorPx = DEFAULT_MIN_INSPECTOR_PX,
  minPrimaryPx = DEFAULT_MIN_PRIMARY_PX,
  minInspectorPercent = 0,
  maxInspectorPercent = 100,
}: TeacherWorkspaceSplitProps) {
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [splitWidth, setSplitWidth] = useState(0)
  const { width: viewportWidth } = useWindowSize()
  const isDesktop = viewportWidth >= DESKTOP_BREAKPOINT
  const inspectorVisible = !!inspector && !inspectorCollapsed
  const constrainedInspectorWidth = clampInspectorWidthPercent(
    inspectorWidth,
    splitWidth,
    {
      minInspectorPx,
      minPrimaryPx,
      minInspectorPercent,
      maxInspectorPercent,
    },
  )

  useEffect(() => {
    const splitElement = splitRef.current
    if (!splitElement) return

    const updateSplitWidth = () => {
      setSplitWidth(splitElement.getBoundingClientRect().width)
    }

    updateSplitWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(updateSplitWidth)
      resizeObserver.observe(splitElement)
      return () => resizeObserver.disconnect()
    }

    window.addEventListener('resize', updateSplitWidth)
    return () => window.removeEventListener('resize', updateSplitWidth)
  }, [])

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!splitRef.current) return

      event.preventDefault()
      onInspectorCollapsedChange?.(false)

      const { right, width } = splitRef.current.getBoundingClientRect()
      if (width <= 0) return

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        onInspectorWidthChange(
          clampInspectorWidthPercent(
            ((right - moveEvent.clientX) / width) * 100,
            width,
            {
              minInspectorPx,
              minPrimaryPx,
              minInspectorPercent,
              maxInspectorPercent,
            },
          ),
        )
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [
      maxInspectorPercent,
      minInspectorPercent,
      minInspectorPx,
      minPrimaryPx,
      onInspectorCollapsedChange,
      onInspectorWidthChange,
    ],
  )

  const handleResizeReset = useCallback(() => {
    onInspectorWidthChange(
      clampInspectorWidthPercent(
        defaultInspectorWidth,
        splitWidth,
        {
          minInspectorPx,
          minPrimaryPx,
          minInspectorPercent,
          maxInspectorPercent,
        },
      ),
    )
  }, [
    defaultInspectorWidth,
    maxInspectorPercent,
    minInspectorPercent,
    minInspectorPx,
    minPrimaryPx,
    onInspectorWidthChange,
    splitWidth,
  ])

  return (
    <div ref={splitRef} className="flex h-full min-h-0 flex-1">
      <SummaryDetailWorkspaceShell
        className={className}
        orientation="responsive"
        leftPaneClassName={primaryClassName}
        rightVisible={inspectorVisible}
        rightPaneClassName={inspectorClassName}
        rightWidthPercent={inspectorVisible && isDesktop ? constrainedInspectorWidth : undefined}
        divider={
          inspectorVisible
            ? {
                label: dividerLabel,
                onPointerDown: handleResizeStart,
                onDoubleClick: handleResizeReset,
              }
            : undefined
        }
        left={primary}
        right={inspector}
      />
    </div>
  )
}
