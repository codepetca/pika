'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Coachmark } from './Coachmark'
import { OnboardingChecklist } from './OnboardingChecklist'

export interface OnboardingStep<Ctx> {
  id: string
  /** Classroom tab this step's control lives on, e.g. 'settings' or 'daily'. */
  tab: string
  /** Optional sub-section within that tab, e.g. a Settings SegmentedControl value. */
  section?: string
  /** CSS selector for the coachmark to ring. */
  targetSelector: string
  /** Checklist row text. */
  label: string
  /** Coachmark card copy. */
  title: string
  body: string
  /**
   * Derives completion from real app state. Omit for an acknowledgment-only
   * step (done once the teacher clicks "Got it" on its coachmark) — use
   * that when there's no reliable signal that the underlying task is
   * actually finished (e.g. "review your calendar", "share this code").
   */
  isDone?: (context: Ctx) => boolean
}

export interface OnboardingState {
  dismissed?: boolean
  ackSteps?: string[]
}

export interface OnboardingChecklistProviderProps<Ctx> {
  title: string
  steps: Array<OnboardingStep<Ctx>>
  /** Data the isDone selectors read — pass through whatever they need. */
  context: Ctx
  activeTab: string
  onNavigate: (tab: string, section?: string) => void
  /** One-shot signal (e.g. a `?onboarding=start` query param) to auto-open on the first step. */
  autoStart: boolean
  /** Called once autoStart has been consumed, so the caller can strip the query param. */
  onAutoStartConsumed?: () => void
  /**
   * Persisted dismissal/progress state, owned by the caller (typically via
   * useTeacherUiState) so it can also gate other work — e.g. skipping a
   * fetch for isDone context once the chain is already dismissed.
   */
  uiState: {
    value: OnboardingState | null
    isLoading: boolean
    update: (next: OnboardingState) => Promise<void>
  }
}

/**
 * Generic getting-started step chain: a checklist that drives spotlight
 * coachmarks across tabs. Reusable for any future onboarding flow — pass a
 * new `steps` array and `storageKey`, nothing else changes.
 */
export function OnboardingChecklistProvider<Ctx>({
  title,
  steps,
  context,
  activeTab,
  onNavigate,
  autoStart,
  onAutoStartConsumed,
  uiState,
}: OnboardingChecklistProviderProps<Ctx>) {
  const { value, isLoading, update } = uiState
  const dismissed = value?.dismissed ?? false
  const ackSteps = useMemo(() => new Set(value?.ackSteps ?? []), [value])

  const [panelOpen, setPanelOpen] = useState(false)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [justCompleted, setJustCompleted] = useState(false)
  const autoStartedRef = useRef(false)
  const dismissedForCompletionRef = useRef(false)

  const isStepDone = (step: OnboardingStep<Ctx>) => (step.isDone ? step.isDone(context) : ackSteps.has(step.id))
  const doneCount = steps.filter(isStepDone).length
  const allDone = steps.length > 0 && doneCount === steps.length

  // Auto-open on the first incomplete step right after classroom creation.
  useEffect(() => {
    if (autoStartedRef.current || isLoading || dismissed || allDone || !autoStart) return
    autoStartedRef.current = true
    const firstPending = steps.find((step) => !isStepDone(step))
    if (firstPending) {
      setPanelOpen(true)
      setActiveStepId(firstPending.id)
      if (firstPending.tab !== activeTab) onNavigate(firstPending.tab, firstPending.section)
    }
    onAutoStartConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, isLoading, dismissed, allDone])

  // Once every step is done, persist the dismissal so it never shows again
  // for this classroom, after a brief "all set" moment in the panel.
  useEffect(() => {
    if (!allDone || dismissed || isLoading || dismissedForCompletionRef.current) return
    dismissedForCompletionRef.current = true
    setJustCompleted(true)
    setPanelOpen(true)
    setActiveStepId(null)
    const timeout = setTimeout(() => {
      void update({ ackSteps: Array.from(ackSteps), dismissed: true })
      setPanelOpen(false)
    }, 2200)
    return () => clearTimeout(timeout)
  }, [allDone, dismissed, isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || dismissed || steps.length === 0) return null

  const activeStep = steps.find((step) => step.id === activeStepId) ?? null

  const handleSelectItem = (id: string) => {
    const step = steps.find((candidate) => candidate.id === id)
    if (!step || isStepDone(step)) return
    setActiveStepId(id)
    if (step.tab !== activeTab || step.section) onNavigate(step.tab, step.section)
  }

  const handleAcknowledge = () => {
    if (!activeStep) return
    if (!activeStep.isDone) {
      void update({ ackSteps: Array.from(new Set([...ackSteps, activeStep.id])), dismissed: false })
    }
    setActiveStepId(null)
  }

  return (
    <>
      <OnboardingChecklist
        title={title}
        items={steps.map((step) => ({ id: step.id, label: step.label, done: isStepDone(step) }))}
        activeStepId={activeStepId}
        open={panelOpen}
        justCompleted={justCompleted}
        onSelectItem={handleSelectItem}
        onToggleOpen={() => setPanelOpen((current) => !current)}
      />
      {activeStep ? (
        <Coachmark
          targetSelector={activeStep.targetSelector}
          title={activeStep.title}
          body={activeStep.body}
          stepLabel={`Step ${steps.findIndex((s) => s.id === activeStep.id) + 1} of ${steps.length}`}
          open
          onAcknowledge={handleAcknowledge}
          onSkip={() => setActiveStepId(null)}
        />
      ) : null}
    </>
  )
}
