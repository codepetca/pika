'use client'

import { Eye, EyeOff } from 'lucide-react'
import { IconButton } from '@/ui'

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
    <div data-testid="teacher-gradebook-visibility-control" className="inline-flex">
      <IconButton
        icon={gradesVisible ? Eye : EyeOff}
        label="Student grades visibility"
        tooltip={tooltip}
        variant={gradesVisible ? 'subtle' : 'ghost'}
        aria-pressed={gradesVisible}
        disabled={disabled}
        loading={saving}
        onClick={() => onChange(!gradesVisible)}
      />
    </div>
  )
}
