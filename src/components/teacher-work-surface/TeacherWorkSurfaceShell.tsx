'use client'

import type { ReactNode, Ref } from 'react'
import {
  PageActionBar,
  PageContent,
  PageLayout,
  type ActionBarItem,
} from '@/components/PageLayout'
import { cn } from '@/ui/utils'

export type TeacherWorkSurfaceState = 'summary' | 'workspace'
export type TeacherWorkSurfaceWorkspaceFrame = 'attachedTabs' | 'standalone'

interface TeacherWorkSurfaceShellProps {
  state: TeacherWorkSurfaceState
  primary: ReactNode
  actions?: ActionBarItem[]
  trailing?: ReactNode
  feedback?: ReactNode
  summary: ReactNode
  workspace: ReactNode
  className?: string
  actionBarClassName?: string
  contentClassName?: string
  summaryClassName?: string
  workspaceClassName?: string
  workspaceFrameClassName?: string
  workspaceFrame?: TeacherWorkSurfaceWorkspaceFrame
  workspaceRef?: Ref<HTMLDivElement>
}

export function TeacherWorkSurfaceShell({
  state,
  primary,
  actions = [],
  trailing,
  feedback,
  summary,
  workspace,
  className,
  actionBarClassName,
  contentClassName,
  summaryClassName,
  workspaceClassName,
  workspaceFrameClassName,
  workspaceFrame = 'attachedTabs',
  workspaceRef,
}: TeacherWorkSurfaceShellProps) {
  const isSummary = state === 'summary'
  const usesAttachedTabsFrame = workspaceFrame === 'attachedTabs'

  return (
    <PageLayout
      className={cn('flex h-full min-h-0 flex-col', className)}
    >
      <PageActionBar
        primary={primary}
        actions={actions}
        trailing={trailing}
        className={cn(!isSummary && usesAttachedTabsFrame ? 'pl-0 pr-2' : '', actionBarClassName)}
      />

      <PageContent
        className={cn(
          isSummary
            ? 'flex flex-col gap-3'
            : 'px-0 flex min-h-0 flex-1 flex-col gap-3 pt-0',
          contentClassName,
        )}
      >
        {feedback}

        {isSummary ? (
          <div className={summaryClassName}>{summary}</div>
        ) : (
          <div
            className={cn(
              'flex min-h-0 flex-1 overflow-hidden border border-border bg-surface',
              usesAttachedTabsFrame ? 'rounded-b-lg' : 'rounded-lg',
              workspaceFrameClassName,
            )}
          >
            <div
              ref={workspaceRef}
              className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', workspaceClassName)}
            >
              {workspace}
            </div>
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
