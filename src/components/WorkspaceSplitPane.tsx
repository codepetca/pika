'use client'

import type { CSSProperties, KeyboardEventHandler, ReactNode, PointerEventHandler } from 'react'
import { cn } from '@/ui/utils'

interface WorkspaceSplitDivider {
  label: string
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onDoubleClick?: () => void
  className?: string
  lineClassName?: string
  ariaValueMin?: number
  ariaValueMax?: number
  ariaValueNow?: number
}

interface WorkspaceSplitPaneProps {
  left: ReactNode
  right?: ReactNode
  rightVisible?: boolean
  className?: string
  leftPaneClassName?: string
  rightPaneClassName?: string
  leftPaneStyle?: CSSProperties
  rightPaneStyle?: CSSProperties
  divider?: WorkspaceSplitDivider
  orientation?: 'row' | 'responsive'
  ['data-testid']?: string
}

export function WorkspaceSplitPane({
  left,
  right,
  rightVisible = true,
  className,
  leftPaneClassName,
  rightPaneClassName,
  leftPaneStyle,
  rightPaneStyle,
  divider,
  orientation = 'responsive',
  'data-testid': dataTestId,
}: WorkspaceSplitPaneProps) {
  const rootOrientationClass = orientation === 'row' ? 'flex-row' : 'flex-col lg:flex-row'
  const dividerVisibilityClass = orientation === 'row' ? 'block' : 'hidden lg:block'
  const rightBorderClass = orientation === 'row' ? 'border-l border-border' : 'border-t border-border lg:border-l lg:border-t-0'

  return (
    <div
      className={cn('flex h-full min-h-0 overflow-hidden', rootOrientationClass, className)}
      data-testid={dataTestId}
    >
      <div
        className={cn('min-h-0 flex-1 overflow-hidden', leftPaneClassName)}
        style={leftPaneStyle}
      >
        {left}
      </div>

      {rightVisible && divider ? (
        <div className={cn('relative w-0 shrink-0', dividerVisibilityClass)}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={divider.label}
            aria-valuemin={divider.ariaValueMin}
            aria-valuemax={divider.ariaValueMax}
            aria-valuenow={divider.ariaValueNow}
            tabIndex={divider.onKeyDown ? 0 : undefined}
            className={cn(
              'absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize bg-transparent outline-none',
              divider.className,
            )}
            onPointerDown={divider.onPointerDown}
            onDoubleClick={divider.onDoubleClick}
            onKeyDown={divider.onKeyDown}
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border',
                divider.lineClassName,
              )}
            />
          </div>
        </div>
      ) : null}

      {rightVisible ? (
        <div
          className={cn('min-h-0 overflow-hidden', !divider && rightBorderClass, rightPaneClassName)}
          style={rightPaneStyle}
        >
          {right}
        </div>
      ) : null}
    </div>
  )
}
