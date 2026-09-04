'use client'

import { useEffect, useState } from 'react'
import { useTeacherUiState } from '@/hooks/useTeacherUiState'
import { readTeacherAttendancePolicy, type TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'
import { OnboardingChecklistProvider, type OnboardingState } from './OnboardingChecklistProvider'
import { CLASSROOM_SETUP_STEPS, classroomSetupOnboardingKey } from './classroom-setup-steps'

interface ClassroomSetupOnboardingProps {
  classroomId: string
  activeTab: string
  autoStart: boolean
  onNavigate: (tab: string, section?: string) => void
  onAutoStartConsumed: () => void
  onDismissedResolved?: (dismissed: boolean) => void
}

/**
 * Wires the classroom-setup step chain (class days review → attendance
 * hours → invite students) into one classroom. Teacher-only — mount this
 * only when `user.role === 'teacher'`.
 */
export function ClassroomSetupOnboarding({
  classroomId,
  activeTab,
  autoStart,
  onNavigate,
  onAutoStartConsumed,
  onDismissedResolved,
}: ClassroomSetupOnboardingProps) {
  const uiState = useTeacherUiState<OnboardingState>(classroomSetupOnboardingKey(classroomId), true)
  const dismissed = uiState.value?.dismissed ?? false

  // Only fetched once the chain isn't already dismissed — a classroom past
  // onboarding costs nothing here beyond the small uiState read above.
  const [attendancePolicy, setAttendancePolicy] = useState<TeacherAttendancePolicy | null>(null)
  useEffect(() => {
    if (uiState.isLoading || dismissed) return
    let cancelled = false
    readTeacherAttendancePolicy(classroomId)
      .then((policy) => {
        if (!cancelled) setAttendancePolicy(policy)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [classroomId, dismissed, uiState.isLoading])

  return (
    <OnboardingChecklistProvider
      title="Getting started"
      steps={CLASSROOM_SETUP_STEPS}
      context={{ attendancePolicy }}
      activeTab={activeTab}
      onNavigate={onNavigate}
      autoStart={autoStart}
      onAutoStartConsumed={onAutoStartConsumed}
      uiState={uiState}
      onDismissedResolved={onDismissedResolved}
    />
  )
}
