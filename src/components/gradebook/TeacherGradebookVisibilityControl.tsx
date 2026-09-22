'use client'

import { Users } from 'lucide-react'
import { SettingsSwitch } from '@/components/settings/SettingsSwitchRow'

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
  return (
    <div
      data-testid="teacher-gradebook-visibility-control"
      className="inline-flex"
      aria-busy={saving || undefined}
    >
      <SettingsSwitch
        checked={gradesVisible}
        onChange={onChange}
        ariaLabel="Student grades visibility"
        tooltip={tooltip}
        checkedTone="success"
        checkedIcon={<Users className="h-3.5 w-3.5 text-success" aria-hidden="true" />}
        uncheckedIcon={<Users className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />}
        retainCheckedToneWhenDisabled
        disabled={disabled || saving}
      />
      <span className="sr-only" aria-live="polite">{saving ? 'Saving grade visibility' : ''}</span>
    </div>
  )
}
