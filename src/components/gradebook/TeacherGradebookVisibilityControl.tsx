'use client'

import { SettingsSwitchRow } from '@/components/settings/SettingsSwitchRow'
import { Card } from '@/ui'

export function TeacherGradebookVisibilityControl({
  gradesVisible,
  onChange,
  disabled = false,
  saving = false,
  error = '',
}: {
  gradesVisible: boolean
  onChange: (visible: boolean) => void
  disabled?: boolean
  saving?: boolean
  error?: string
}) {
  return (
    <div data-testid="teacher-gradebook-visibility-control">
      <Card tone="muted" padding="none">
        <SettingsSwitchRow
          checked={gradesVisible}
          onChange={onChange}
          disabled={disabled || saving}
          ariaLabel="Show grades to students"
          className="px-4 py-3"
        >
          <span className="block font-medium">Show grades to students</span>
          <span className="mt-0.5 block text-xs leading-5 text-text-muted">
            Students see their current grade and returned work.
          </span>
        </SettingsSwitchRow>
        <p className="border-t border-border px-4 py-2 text-xs leading-5 text-text-muted" aria-live="polite">
          {saving
            ? 'Saving visibility…'
            : gradesVisible
              ? 'Grades is visible in student classroom navigation.'
              : 'Grades is hidden from student classroom navigation.'}
          {' '}Returning Classwork or a Test remains the release action for each result.
        </p>
        {error ? <p role="alert" className="border-t border-danger px-4 py-2 text-xs text-danger">{error}</p> : null}
      </Card>
    </div>
  )
}
