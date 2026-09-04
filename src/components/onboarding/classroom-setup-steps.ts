import type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'
import type { OnboardingStep } from './OnboardingChecklistProvider'
import { ONBOARDING_RAIL_SELECTORS, ONBOARDING_TARGET_IDS } from './classroom-setup-onboarding-ids'

export interface ClassroomSetupContext {
  attendancePolicy: TeacherAttendancePolicy | null
}

export const CLASSROOM_SETUP_ONBOARDING_KEY_PREFIX = 'onboarding:classroom:'

export function classroomSetupOnboardingKey(classroomId: string) {
  return `${CLASSROOM_SETUP_ONBOARDING_KEY_PREFIX}${classroomId}`
}

/**
 * The 3-step chain shown right after a teacher creates a classroom. The
 * first and third steps are acknowledgment-only — class days already have a
 * default calendar by then, and "invited" isn't something the app can
 * detect from data alone — while the middle step reflects real state.
 */
export const CLASSROOM_SETUP_STEPS: Array<OnboardingStep<ClassroomSetupContext>> = [
  {
    id: 'class-days',
    tab: 'settings',
    section: 'class-days',
    targetSelector: `#${ONBOARDING_TARGET_IDS.settingsClassDaysTab}`,
    pathTargetSelector: ONBOARDING_RAIL_SELECTORS.settings,
    label: 'Review your class days',
    title: 'Review your class days',
    body: 'A default calendar is already set. Add holidays, PA days, and any other days off here.',
  },
  {
    id: 'attendance-hours',
    tab: 'daily',
    targetSelector: `#${ONBOARDING_TARGET_IDS.attendanceWindow}`,
    pathTargetSelector: ONBOARDING_RAIL_SELECTORS.daily,
    label: 'Set attendance hours',
    title: 'Set your attendance window',
    body: 'Students can only check in during this window on class days.',
    isDone: (context) => Boolean(context.attendancePolicy?.enabled),
  },
  {
    id: 'invite-students',
    tab: 'settings',
    section: 'access',
    targetSelector: `#${ONBOARDING_TARGET_IDS.joinCodeCard}`,
    pathTargetSelector: ONBOARDING_RAIL_SELECTORS.settings,
    label: 'Invite students',
    title: 'Share your join code',
    body: 'Students enter this code once to join the classroom — no invite required.',
  },
]
