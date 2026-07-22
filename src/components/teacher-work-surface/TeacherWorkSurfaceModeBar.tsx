'use client'

import type { ReactNode } from 'react'
import { Tabs } from '@/ui'

export interface TeacherWorkSurfaceMode<TMode extends string = string> {
  id: TMode
  label: ReactNode
  disabled?: boolean
}

interface TeacherWorkSurfaceModeBarProps<TMode extends string = string> {
  modes: readonly TeacherWorkSurfaceMode<TMode>[]
  activeMode: TMode
  onModeChange: (mode: TMode) => void
  getTabId?: (mode: TMode) => string
  getPanelId?: (mode: TMode) => string
  center?: ReactNode
  trailing?: ReactNode
  status?: ReactNode
  ariaLabel?: string
}

export function TeacherWorkSurfaceModeBar<TMode extends string = string>({
  modes,
  activeMode,
  onModeChange,
  getTabId,
  getPanelId,
  center,
  trailing,
  status,
  ariaLabel = 'Workspace modes',
}: TeacherWorkSurfaceModeBarProps<TMode>) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:min-h-[2.75rem]">
      <Tabs
        ariaLabel={ariaLabel}
        items={modes.map((mode) => ({
          value: mode.id,
          label: mode.label,
          disabled: mode.disabled,
        }))}
        value={activeMode}
        onValueChange={onModeChange}
        variant="connected"
        getTabId={getTabId}
        getPanelId={getPanelId}
        className="self-end"
      />

      <div className="flex min-w-0 basis-full justify-center sm:basis-auto sm:flex-1">
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2 sm:gap-3">
          {center}
          {status}
        </div>
      </div>

      {trailing ? (
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto sm:gap-2">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}
