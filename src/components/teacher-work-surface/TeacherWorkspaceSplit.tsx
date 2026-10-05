'use client'

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SummaryDetailWorkspaceShell } from '@/components/SummaryDetailWorkspaceShell'
import { useWindowSize } from '@/hooks/use-window-size'
import { DESKTOP_BREAKPOINT } from '@/lib/layout-config'
import { cn } from '@/ui'

const DEFAULT_MIN_INSPECTOR_PX = 320
const DEFAULT_MIN_PRIMARY_PX = 320
const GAPPED_SPLIT_HANDLE_WIDTH_PX = 12

interface TeacherWorkspaceSplitProps {
  primary: ReactNode
  inspector?: ReactNode
  mobileInspector?: ReactNode
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
  splitVariant?: 'joined' | 'gapped'
  /** Opt-in pilot: preserve pane identity and animate disclosure, never drag resizing. */
  animateInspector?: boolean
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
  mobileInspector,
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
  splitVariant = 'joined',
  animateInspector = false,
}: TeacherWorkspaceSplitProps) {
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [splitWidth, setSplitWidth] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanupRef.current?.(), [])
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
      resizeCleanupRef.current?.()
      onInspectorCollapsedChange?.(false)

      const { right, width } = splitRef.current.getBoundingClientRect()
      if (width <= 0) return
      setIsResizing(true)

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

      const handleResizeEnd = () => {
        setIsResizing(false)
        resizeCleanupRef.current = null
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handleResizeEnd)
        window.removeEventListener('pointercancel', handleResizeEnd)
        window.removeEventListener('blur', handleResizeEnd)
      }

      resizeCleanupRef.current = handleResizeEnd
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handleResizeEnd)
      window.addEventListener('pointercancel', handleResizeEnd)
      window.addEventListener('blur', handleResizeEnd)
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

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const baseWidth = splitWidth || splitRef.current?.getBoundingClientRect().width || 0
      const getClampedWidth = (nextWidth: number) =>
        clampInspectorWidthPercent(
          nextWidth,
          baseWidth,
          {
            minInspectorPx,
            minPrimaryPx,
            minInspectorPercent,
            maxInspectorPercent,
          },
        )

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onInspectorCollapsedChange?.(false)
        onInspectorWidthChange(getClampedWidth(inspectorWidth + 5))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onInspectorCollapsedChange?.(false)
        onInspectorWidthChange(getClampedWidth(inspectorWidth - 5))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onInspectorCollapsedChange?.(false)
        onInspectorWidthChange(getClampedWidth(maxInspectorPercent))
      } else if (event.key === 'End') {
        event.preventDefault()
        onInspectorCollapsedChange?.(false)
        onInspectorWidthChange(getClampedWidth(minInspectorPercent))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handleResizeReset()
      }
    },
    [
      handleResizeReset,
      inspectorWidth,
      maxInspectorPercent,
      minInspectorPercent,
      minInspectorPx,
      minPrimaryPx,
      onInspectorCollapsedChange,
      onInspectorWidthChange,
      splitWidth,
    ],
  )

  if (splitVariant === 'gapped') {
    const keepInspectorMounted = animateInspector && !!inspector
    const inspectorPaneStyle = {
      '--teacher-workspace-inspector-width': inspectorVisible
        ? `calc(${constrainedInspectorWidth}% - ${GAPPED_SPLIT_HANDLE_WIDTH_PX / 2}px)`
        : '0%',
    } as CSSProperties
    const motionClass = animateInspector && !isResizing
      ? 'transition-[flex-basis,flex-grow,opacity] duration-standard ease-standard motion-reduce:transition-none'
      : undefined

    return (
      <div
        ref={splitRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col bg-page lg:h-full lg:overflow-hidden lg:flex-row lg:gap-0',
          keepInspectorMounted && !inspectorVisible ? 'gap-0' : 'gap-3',
          animateInspector && !isResizing && 'transition-[gap] duration-standard ease-standard motion-reduce:transition-none',
          className,
        )}
      >
        {inspectorVisible && mobileInspector ? (
          <div
            className={cn(
              'min-h-0 w-full overflow-hidden lg:hidden',
              inspectorClassName,
            )}
          >
            {mobileInspector}
          </div>
        ) : null}

        <div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', primaryClassName)}>
          {primary}
        </div>

        {inspectorVisible || keepInspectorMounted ? (
          <div className={cn(
            'hidden shrink-0 self-stretch overflow-hidden lg:flex',
            inspectorVisible ? 'w-3' : 'w-0',
            animateInspector && !isResizing && 'transition-[width] duration-standard ease-standard motion-reduce:transition-none',
          )}>
            {inspectorVisible ? (
              <div
                role="separator"
                aria-label={dividerLabel}
                aria-orientation="vertical"
                aria-valuemin={minInspectorPercent}
                aria-valuemax={maxInspectorPercent}
                aria-valuenow={constrainedInspectorWidth}
                tabIndex={0}
                className="min-h-full flex-1 cursor-col-resize rounded-full outline-none hover:bg-surface-hover focus:bg-info-bg"
                onPointerDown={handleResizeStart}
                onDoubleClick={handleResizeReset}
                onKeyDown={handleResizeKeyDown}
              />
            ) : null}
          </div>
        ) : null}

        {inspectorVisible || keepInspectorMounted ? (
          <div
            aria-hidden={!inspectorVisible || undefined}
            ref={(element) => { element?.toggleAttribute('inert', !inspectorVisible) }}
            data-workspace-inspector={inspectorVisible ? 'open' : 'closed'}
            className={cn(
              'min-h-0 min-w-0 w-full basis-0 overflow-hidden lg:shrink-0 lg:grow-0 lg:basis-[var(--teacher-workspace-inspector-width)]',
              inspectorVisible ? 'grow' : 'grow-0',
              mobileInspector && 'hidden lg:block',
              animateInspector && (inspectorVisible ? 'opacity-100' : 'pointer-events-none opacity-0'),
              motionClass,
              inspectorClassName,
            )}
            style={inspectorPaneStyle}
          >
            {inspector}
          </div>
        ) : null}
      </div>
    )
  }

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
                onKeyDown: handleResizeKeyDown,
                ariaValueMin: minInspectorPercent,
                ariaValueMax: maxInspectorPercent,
                ariaValueNow: constrainedInspectorWidth,
              }
            : undefined
        }
        left={primary}
        right={inspector}
      />
    </div>
  )
}
