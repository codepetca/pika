'use client'

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { ClassroomSetupOnboarding } from './ClassroomSetupOnboarding'

interface OnboardingLauncherProps {
  classroomId: string
  activeTab: string
  /** One-shot signal (e.g. a `?onboarding=start` query param) — opens immediately, no click needed. */
  autoStart: boolean
  onNavigate: (tab: string, section?: string) => void
  onAutoStartConsumed: () => void
}

/**
 * A small, always-cheap "?" affordance for teachers: costs nothing until
 * clicked, and reopens the getting-started chain from wherever it left off
 * — in any session, not just the one the classroom was created in. This is
 * how the checklist stays findable later without adding a background fetch
 * to every classroom visit.
 */
export function OnboardingLauncher({
  classroomId,
  activeTab,
  autoStart,
  onNavigate,
  onAutoStartConsumed,
}: OnboardingLauncherProps) {
  const [open, setOpen] = useState(autoStart)
  // Once we learn every step is actually done, stop offering the button for
  // the rest of this session rather than reopening to an empty chain.
  const [resolvedDone, setResolvedDone] = useState(false)

  if (resolvedDone) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Reopen the getting-started guide"
        title="Getting-started guide"
        className="fixed bottom-5 right-5 z-popover flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text-muted shadow-elevated hover:bg-surface-hover hover:text-text-default"
      >
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <ClassroomSetupOnboarding
      classroomId={classroomId}
      activeTab={activeTab}
      // Whether this mount came from the URL flag or a manual click, always
      // resume at the first pending step — that's what "reopen" means here.
      autoStart
      onNavigate={onNavigate}
      onAutoStartConsumed={onAutoStartConsumed}
      onDismissedResolved={(dismissed) => {
        if (dismissed) setResolvedDone(true)
      }}
    />
  )
}
