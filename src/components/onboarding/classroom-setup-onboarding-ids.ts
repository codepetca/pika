/**
 * DOM ids the classroom-setup onboarding chain rings. Shared between the
 * step config (src/components/onboarding/classroom-setup-steps.ts) and the
 * components that render the actual controls, so the two never drift.
 */
export const ONBOARDING_TARGET_IDS = {
  settingsClassDaysTab: 'onboarding-settings-class-days-tab',
  settingsAccessTab: 'onboarding-settings-access-tab',
  attendanceWindow: 'onboarding-attendance-window',
  joinCodeCard: 'onboarding-join-code-card',
} as const
