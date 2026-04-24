'use client'

import type { CSSProperties, ComponentProps, ReactNode } from 'react'
import { WorkspaceSplitPane } from '@/components/WorkspaceSplitPane'
import { cn } from '@/ui/utils'

type WorkspaceSplitDivider = NonNullable<ComponentProps<typeof WorkspaceSplitPane>['divider']>

interface SummaryDetailWorkspaceShellProps {
  left: ReactNode
  right?: ReactNode
  rightVisible?: boolean
  className?: string
  leftPaneClassName?: string
  rightPaneClassName?: string
  leftPaneStyle?: CSSProperties
  rightPaneStyle?: CSSProperties
  rightWidthPercent?: number
  divider?: WorkspaceSplitDivider
  orientation?: 'row' | 'responsive'
  ['data-testid']?: string
}

export function SummaryDetailWorkspaceShell({
  left,
  right,
  rightVisible = true,
  className,
  leftPaneClassName,
  rightPaneClassName,
  leftPaneStyle,
  rightPaneStyle,
  rightWidthPercent,
  divider,
  orientation = 'responsive',
  'data-testid': dataTestId,
}: SummaryDetailWorkspaceShellProps) {
  const effectiveRightWidthPercent =
    typeof rightWidthPercent === 'number'
      ? rightWidthPercent
      : orientation === 'row'
        ? 50
        : undefined

  const resolvedRightPaneStyle = rightVisible
    ? effectiveRightWidthPercent != null
      ? {
          width: `${effectiveRightWidthPercent}%`,
          flexBasis: `${effectiveRightWidthPercent}%`,
          ...rightPaneStyle,
        }
      : rightPaneStyle
    : rightPaneStyle

  const responsiveDividerBorderClass =
    divider && orientation === 'responsive' ? 'border-t border-border lg:border-t-0' : ''

  return (
    <WorkspaceSplitPane
      left={left}
      right={right}
      rightVisible={rightVisible}
      divider={divider}
      orientation={orientation}
      data-testid={dataTestId}
      className={cn('h-full w-full min-w-0 flex-1', className)}
      leftPaneClassName={cn('min-h-0 flex-1 overflow-hidden', leftPaneClassName)}
      rightPaneClassName={cn(
        'min-h-0 overflow-hidden bg-surface',
        responsiveDividerBorderClass,
        rightPaneClassName,
      )}
      leftPaneStyle={leftPaneStyle}
      rightPaneStyle={resolvedRightPaneStyle}
    />
  )
}
