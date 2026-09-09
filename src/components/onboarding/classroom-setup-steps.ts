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
 * The step chain shown right after a teacher creates a classroom.
 *
 * Class-day review is deliberately NOT a step here: ClassroomPageClient
 * already shows its own persistent "Set up now" / "Review now" banner
 * (classDaysNeedSetup || reviewClassDays=1), driven by a real derived
 * signal. Duplicating that as a coachmark would just be two affordances
 * pointing at the same task — this chain covers what that banner doesn't.
 *
 * "Invite students" is acknowledgment-only — there's no reliable signal
 * that a join code was actually shared — while attendance hours reflects
 * real state.
 */
export const CLASSROOM_SETUP_STEPS: Array<OnboardingStep<ClassroomSetupContext>> = [
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
