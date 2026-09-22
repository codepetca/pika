'use client'

import { DoorClosed, DoorOpen } from 'lucide-react'
import { SettingsSwitch } from '@/components/settings/SettingsSwitchRow'
import { cn } from '@/ui'

export function TeacherGradebookVisibilityControl({
  gradesVisible,
  onChange,
  disabled = false,
  saving = false,
}: {
  gradesVisible: boolean
  onChange: (visible: boolean) => void
  disabled?: boolean
  saving?: boolean
}) {
  const tooltip = gradesVisible ? 'Hide grades from students' : 'Show grades to students'
  const StatusIcon = gradesVisible ? DoorOpen : DoorClosed

  return (
    <div
      data-testid="teacher-gradebook-visibility-control"
      className="inline-flex items-center gap-1"
      aria-busy={saving || undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-11 w-7 items-center justify-center',
          gradesVisible ? 'text-success' : 'text-danger',
        )}
      >
        <StatusIcon className="h-4 w-4" />
      </span>
      <SettingsSwitch
        checked={gradesVisible}
        onChange={onChange}
        ariaLabel="Student grades visibility"
        tooltip={tooltip}
        disabled={disabled || saving}
      />
      <span className="sr-only" aria-live="polite">{saving ? 'Saving grade visibility' : ''}</span>
    </div>
  )
}
