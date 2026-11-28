'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfirmDialog, SaveStatus } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import {
  DEFAULT_OPEN_RESPONSE_MAX_CHARS,
  isCompleteTestResponseForQuestion,
  normalizeTestResponses,
  type TestResponses,
} from '@/lib/test-attempts'
import { applyTextareaIndent, applyBracketIndent } from '@/lib/textarea-indent'
import {
  clearFlaggedQuestions,
  getFlaggedQuestions,
  isQuestionFlagged,
  toggleFlaggedQuestion,
} from '@/lib/flag-questions'
import type { TestAssessmentQuestion, TestResponseDraftValue } from '@/types'

const AUTOSAVE_DEBOUNCE_MS = 5_000
const AUTOSAVE_MIN_INTERVAL_MS = 15_000
const AUTOSAVE_MAX_DIRTY_MS = 20_000
const AUTOSAVE_REQUEST_TIMEOUT_MS = 35_000
const AUTOSAVE_RECOVERY_TIMEOUT_MS = 10_000

interface DraftScope {
  testId: string
  revision: number | null | undefined
  conflicted: boolean
  autosaveQueued: boolean
  retriedAutosave: boolean
  unconfirmedSave: { revision: number; responses: TestResponses } | null
  tail: Promise<boolean>
}

function createDraftScope(testId: string, revision: DraftScope['revision']): DraftScope {
  return { testId, revision, conflicted: false, autosaveQueued: false, retriedAutosave: false, unconfirmedSave: null, tail: Promise.resolve(true) }
}

function matchesResponses(first: TestResponses, second: TestResponses) {
  const keys = Object.keys(first)
  return keys.length === Object.keys(second).length
    && keys.every(key => JSON.stringify(first[key]) === JSON.stringify(second[key]))
}

interface Props {
  testId: string
  questions: TestAssessmentQuestion[]
  initialDraftRevision?: number | null
  initialResponses?: Record<string, number | TestResponseDraftValue> | TestResponses
  enableDraftAutosave?: boolean
  previewMode?: boolean
  isInteractionLocked?: boolean
  apiBasePath?: string
  onAvailabilityLoss?: () => void
  onSubmissionStateChange?: (active: boolean) => void
  onSubmitted: () => void
}

function isAssessmentAvailabilityError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('not active') ||
    normalized.includes('not found') ||
    normalized.includes('closed for you') ||
    normalized.includes('closed for grading') ||
    normalized.includes('submitted test') ||
    normalized.includes('already responded')
  )
}

export function StudentTestForm({
  testId,
  questions,
  initialResponses,
  initialDraftRevision,
  enableDraftAutosave = false,
  previewMode = false,
  isInteractionLocked = false,
  apiBasePath = '/api/student/tests',
  onAvailabilityLoss,
  onSubmissionStateChange,
  onSubmitted,
}: Props) {
  if (!testId) {
    throw new Error('StudentTestForm requires testId')
  }

  const OPEN_RESPONSE_TAB_INDENT = '\t'
  const OPEN_RESPONSE_TAB_SIZE = 4
  const [responses, setResponses] = useState<TestResponses>(
    normalizeTestResponses(initialResponses)
  )
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [showLoadSaved, setShowLoadSaved] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkingSubmission, setCheckingSubmission] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [submissionMismatch, setSubmissionMismatch] = useState(false)
  const [retryAvailable, setRetryAvailable] = useState(false)
  const submissionUncertainRef = useRef(false)
  const retryInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [autosaveAnnouncement, setAutosaveAnnouncement] = useState('')
  const [previewSubmitMessage, setPreviewSubmitMessage] = useState('')
  const [flaggedQuestions, setFlaggedQuestions] = useState<string[]>([])
  const [flagAnnouncement, setFlagAnnouncement] = useState('')
  const [showFlaggedWarning, setShowFlaggedWarning] = useState(false)
  const shouldAutosave = enableDraftAutosave && !previewMode

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingResponsesRef = useRef<TestResponses | null>(null)
  const dirtySinceRef = useRef<number | null>(null)
  const lastSavedResponsesRef = useRef('')
  const lastSaveAttemptAtRef = useRef(0)
  const initializedTestIdRef = useRef<string | null>(null)
  const draftScopeRef = useRef<DraftScope>(createDraftScope(testId, initialDraftRevision))

  const allAnswered = questions.every((question) =>
    isCompleteTestResponseForQuestion(question, responses[question.id])
  )

  const submitActions = (
    <div
      data-testid="student-test-action-footer"
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      {submitting && (
        <div role="status" aria-live="polite" className="mb-3 rounded-lg border border-border bg-surface-2 p-4 text-sm text-text-default">
          {submissionUncertain ? (
            <div className="space-y-3">
              <p>{checkingSubmission ? 'Checking whether your submission was received…' : submissionMismatch ? 'A submission was found, but it does not match the answers shown here. Please ask your teacher for help.' : retryAvailable ? 'Your submission is not confirmed. Your saved answers are still shown here. You can retry this submission or check again.' : 'We could not confirm your submission. Your answers are still shown here. Please check again or ask your teacher for help.'}</p>
              {!checkingSubmission && <div className="flex flex-wrap gap-2">
                <Button type="button" variant={retryAvailable ? 'secondary' : 'primary'} onClick={() => { void checkSubmission() }}>Check submission status</Button>
                {retryAvailable && <Button type="button" onClick={() => { void retrySubmission() }}>Retry submission</Button>}
              </div>}
            </div>
          ) : 'Submitting your answers… Please keep this page open.'}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          {shouldAutosave && (
            <>
              <SaveStatus aria-hidden="true" status={revisionConflict ? 'error' : saveStatus} errorMessage="Save conflict" />
              <p
                data-testid="student-test-autosave-status"
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {autosaveAnnouncement}
              </p>
            </>
          )}
          {!allAnswered && (
            <p className="text-sm text-text-muted">Answer all questions to submit</p>
          )}
        </div>
        <Button
          onClick={() => {
            if (flaggedQuestions.length > 0) {
              setShowFlaggedWarning(true)
            } else {
              setShowConfirm(true)
            }
          }}
          disabled={isInteractionLocked || revisionConflict || !allAnswered || submitting || loadingSaved}
          className="w-full sm:min-w-[10rem] sm:w-auto"
        >
          Submit
        </Button>
      </div>
    </div>
  )

  useEffect(() => {
    // Background detail refreshes must never replace edits or reset a live CAS queue.
    if (initializedTestIdRef.current === testId) return
    initializedTestIdRef.current = testId
    const normalized = normalizeTestResponses(initialResponses)
    draftScopeRef.current = createDraftScope(testId, initialDraftRevision)
    setRevisionConflict(false)
    setShowLoadSaved(false)
    setError('')
    setResponses(normalized)
    pendingResponsesRef.current = normalized
    dirtySinceRef.current = null
    lastSaveAttemptAtRef.current = 0
    lastSavedResponsesRef.current = JSON.stringify(normalized)
    setSaveStatus('saved')
    setAutosaveAnnouncement('')
  }, [initialResponses, initialDraftRevision, testId])

  // Load and monitor flagged questions from localStorage
  useEffect(() => {
    setFlagAnnouncement('')

    const loadFlaggedQuestions = () => {
      const flagged = getFlaggedQuestions(testId)
      setFlaggedQuestions(flagged)
    }
    loadFlaggedQuestions()

    // Set up storage event listener for changes in other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `pika:flagged-questions:${testId}`) {
        loadFlaggedQuestions()
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [testId])

  const saveDraft = useCallback((
    draftResponses: TestResponses,
    trigger: 'autosave' | 'blur'
  ): Promise<boolean> => {
    if (!shouldAutosave) return Promise.resolve(true)
    const scope = draftScopeRef.current
    if (scope.testId !== testId || scope.conflicted) return Promise.resolve(false)
    if (trigger === 'autosave') {
      if (scope.autosaveQueued) return scope.tail
      scope.autosaveQueued = true
    }
    const queued = scope.tail.then(async () => {
      if (trigger === 'autosave') scope.autosaveQueued = false
      if (draftScopeRef.current !== scope || scope.conflicted) return false
      const next = normalizeTestResponses(trigger === 'autosave'
        ? pendingResponsesRef.current ?? draftResponses
        : draftResponses)
      const serialized = JSON.stringify(next)
      const isLatestPendingDraft = () => serialized === JSON.stringify(pendingResponsesRef.current)
      if (isLatestPendingDraft()) dirtySinceRef.current = null
      const announceSaved = () => {
        if (!isLatestPendingDraft()) return
        setError('')
        setSaveStatus('saved')
        setAutosaveAnnouncement('Saved')
      }
      const showRevisionConflict = () => {
        scope.conflicted = true
        setRevisionConflict(true)
        setError('Saved answers changed in another tab. Your answers are still here. Load saved answers to continue.')
        setSaveStatus('unsaved')
        setAutosaveAnnouncement('Save conflict. Your answers are still here.')
      }
      const reconcile = async () => {
        const unconfirmed = scope.unconfirmedSave
        if (!unconfirmed) return true
        // Recovery must inspect the latest committed revision before a resend.
        const res = await fetch(`${apiBasePath}/${testId}/attempt`, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(AUTOSAVE_RECOVERY_TIMEOUT_MS),
        })
        const data = await res.json()
        if (draftScopeRef.current !== scope) return false
        const attempt = data.attempt
        const revision = attempt?.draft_revision
        if (!res.ok || !Number.isSafeInteger(revision) || revision < unconfirmed.revision
          || !attempt.responses || typeof attempt.is_submitted !== 'boolean') {
          throw new Error(data.error || 'Unable to confirm the save. Your answers are still here.')
        }
        const matches = matchesResponses(normalizeTestResponses(attempt.responses), unconfirmed.responses)
        scope.unconfirmedSave = null
        if (attempt.is_submitted || (revision > unconfirmed.revision && !matches)) {
          showRevisionConflict()
          return false
        }
        if (matches) {
          scope.revision = revision
          lastSavedResponsesRef.current = JSON.stringify(unconfirmed.responses)
        }
        return true
      }
      let sent = false
      let retryable = false
      try {
        if (scope.unconfirmedSave && !(await reconcile())) return false
        if (draftScopeRef.current !== scope) return false
        if (serialized === lastSavedResponsesRef.current) {
          announceSaved()
          return true
        }
        const expectedRevision = scope.revision
        if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
          throw new Error('Reload the test before saving. Your answers are still here.')
        }
        setError('')
        setSaveStatus('saving')
        setAutosaveAnnouncement('Saving')
        lastSaveAttemptAtRef.current = Date.now()
        scope.unconfirmedSave = { revision: expectedRevision, responses: next }
        sent = true
        const res = await fetch(`${apiBasePath}/${testId}/attempt`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responses: next, expected_revision: expectedRevision, trigger }),
          signal: AbortSignal.timeout(AUTOSAVE_REQUEST_TIMEOUT_MS),
        })
        const data = await res.json()
        if (draftScopeRef.current !== scope) return false
        if (data.error_code === 'test_attempt_revision_conflict') {
          scope.unconfirmedSave = null
          showRevisionConflict()
          return false
        }
        if (!res.ok) {
          if (!(res.status >= 500 || res.status === 408)) scope.unconfirmedSave = null
          retryable = res.status === 409 && data.error === 'Test is busy. Try again.'
          throw new Error(data.error || 'Failed to save draft')
        }
        const revision = data.attempt?.draft_revision
        if (!Number.isSafeInteger(revision) || revision < expectedRevision) throw new Error('Unable to confirm the save.')
        scope.unconfirmedSave = null
        scope.revision = revision
        lastSavedResponsesRef.current = serialized
        announceSaved()
        return true
      } catch (saveError) {
        if (draftScopeRef.current !== scope) return false
        if (sent && scope.unconfirmedSave) {
          try {
            if (!(await reconcile())) return false
            if (serialized === lastSavedResponsesRef.current) {
              announceSaved()
              return true
            }
            // The same revision is still current. Retrying uses its CAS, so a
            // first request that commits late cannot overwrite newer work.
            retryable = true
          } catch { /* Keep the unconfirmed revision for the next recovery check. */ }
        }
        if (draftScopeRef.current !== scope) return false
        const message = saveError instanceof Error ? saveError.message : 'Failed to save draft'
        if (isAssessmentAvailabilityError(message)) onAvailabilityLoss?.()
        if (isLatestPendingDraft()) {
          setError(message)
          setSaveStatus('unsaved')
          setAutosaveAnnouncement('Unsaved changes')
          if (trigger === 'autosave' && retryable && !scope.retriedAutosave && mountedRef.current && !saveTimeoutRef.current) {
            scope.retriedAutosave = true
            saveTimeoutRef.current = setTimeout(() => {
              saveTimeoutRef.current = null
              const pending = pendingResponsesRef.current
              if (draftScopeRef.current === scope && pending) void saveDraft(pending, 'autosave')
            }, AUTOSAVE_MIN_INTERVAL_MS)
          }
        }
        return false
      }
    })
    scope.tail = queued
    return queued
  }, [apiBasePath, onAvailabilityLoss, testId, shouldAutosave])

  async function loadSavedAnswers() {
    const scope = draftScopeRef.current
    setLoadingSaved(true)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/attempt`, { method: 'GET', cache: 'no-store' })
      const data = await res.json()
      if (draftScopeRef.current !== scope) return
      const revision = data.attempt?.draft_revision
      if (!res.ok || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error(data.error || 'Unable to load saved answers. Your answers are still here.')
      }
      const saved = normalizeTestResponses(data.attempt.responses)
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      scope.revision = revision
      scope.conflicted = false
      scope.unconfirmedSave = null
      pendingResponsesRef.current = saved
      dirtySinceRef.current = null
      lastSavedResponsesRef.current = JSON.stringify(saved)
      setResponses(saved)
      setRevisionConflict(false)
      setError('')
      setSaveStatus('saved')
      setAutosaveAnnouncement('Saved answers loaded')
      setShowLoadSaved(false)
    } catch (error) {
      if (draftScopeRef.current === scope) setError(error instanceof Error ? error.message : 'Unable to load saved answers')
    } finally {
      if (draftScopeRef.current === scope) setLoadingSaved(false)
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (!shouldAutosave || !pendingResponsesRef.current) return
      void saveDraft(pendingResponsesRef.current, 'blur')
    }
  }, [saveDraft, shouldAutosave])

  function scheduleAutosave(next: TestResponses) {
    setSaveStatus('unsaved')
    setAutosaveAnnouncement('Unsaved changes')
    pendingResponsesRef.current = next
    draftScopeRef.current.retriedAutosave = false

    const now = Date.now()
    dirtySinceRef.current ??= now
    const debounceAt = Math.min(now + AUTOSAVE_DEBOUNCE_MS, dirtySinceRef.current + AUTOSAVE_MAX_DIRTY_MS)
    const saveAt = Math.max(debounceAt, lastSaveAttemptAtRef.current + AUTOSAVE_MIN_INTERVAL_MS)
    const scope = draftScopeRef.current
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      const pending = pendingResponsesRef.current
      if (draftScopeRef.current === scope && pending) void saveDraft(pending, 'autosave')
    }, Math.max(0, saveAt - now))
  }

  function handleOptionSelect(questionId: string, optionIndex: number) {
    if (isInteractionLocked || submitting || loadingSaved) return
    setResponses((prev) => {
      const next = normalizeTestResponses({
        ...prev,
        [questionId]: {
          question_type: 'multiple_choice',
          selected_option: optionIndex,
        },
      })
      if (shouldAutosave) scheduleAutosave(next)
      return next
    })
  }

  function handleOpenResponseChange(questionId: string, value: string, maxChars: number) {
    if (isInteractionLocked || submitting || loadingSaved) return
    const limited = value.slice(0, maxChars)
    setResponses((prev) => {
      const next = normalizeTestResponses({
        ...prev,
        [questionId]: {
          question_type: 'open_response',
          response_text: limited,
        },
      })
      if (shouldAutosave) scheduleAutosave(next)
      return next
    })
  }

  function handleOpenResponseKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    questionId: string,
    maxChars: number
  ) {
    if (isInteractionLocked || submitting || loadingSaved) return

    const target = event.currentTarget

    if (event.key === 'Tab') {
      event.preventDefault()

      const next = applyTextareaIndent({
        value: target.value,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        shiftKey: event.shiftKey,
        indent: OPEN_RESPONSE_TAB_INDENT,
      })

      if (!next.changed) return

      const limitedValue = next.value.slice(0, maxChars)
      const limitedSelectionStart = Math.min(next.selectionStart, limitedValue.length)
      const limitedSelectionEnd = Math.min(next.selectionEnd, limitedValue.length)

      handleOpenResponseChange(questionId, limitedValue, maxChars)

      requestAnimationFrame(() => {
        target.selectionStart = limitedSelectionStart
        target.selectionEnd = limitedSelectionEnd
      })
    } else if (event.key === 'Enter') {
      // Check if we should apply smart bracket indentation
      const currentCaret = target.selectionStart
      const before = target.value.slice(0, currentCaret)
      const after = target.value.slice(currentCaret)

      // Insert newline and check bracket indentation
      const valueWithNewline = before + '\n' + after
      const newCaret = currentCaret + 1

      const bracketIndentResult = applyBracketIndent({
        value: valueWithNewline,
        selectionStart: newCaret,
        selectionEnd: newCaret,
        indent: OPEN_RESPONSE_TAB_INDENT,
      })

      if (bracketIndentResult.changed) {
        event.preventDefault()

        const limitedValue = bracketIndentResult.value.slice(0, maxChars)
        const limitedCaret = Math.min(bracketIndentResult.selectionStart, limitedValue.length)

        handleOpenResponseChange(questionId, limitedValue, maxChars)

        requestAnimationFrame(() => {
          target.selectionStart = limitedCaret
          target.selectionEnd = limitedCaret
        })
      }
    } else if (event.key === '}') {
      // Auto-dedent closing brace when it's the first non-whitespace character on the line
      const currentCaret = target.selectionStart
      const lineStart = target.value.lastIndexOf('\n', currentCaret - 1) + 1
      const beforeBrace = target.value.slice(lineStart, currentCaret)

      // Only dedent if the brace will be the only non-whitespace character typed so far
      if (beforeBrace.trim() === '') {
        // Simulate the brace being typed and check for dedenting
        const valueWithBrace = target.value.slice(0, currentCaret) + '}' + target.value.slice(currentCaret)

        const bracketIndentResult = applyBracketIndent({
          value: valueWithBrace,
          selectionStart: currentCaret,
          selectionEnd: currentCaret,
          indent: OPEN_RESPONSE_TAB_INDENT,
        })

        if (bracketIndentResult.changed) {
          event.preventDefault()

          const limitedValue = bracketIndentResult.value.slice(0, maxChars)
          // +1 to position cursor after the `}` we inserted
          const limitedCaret = Math.min(bracketIndentResult.selectionStart + 1, limitedValue.length)

          handleOpenResponseChange(questionId, limitedValue, maxChars)

          requestAnimationFrame(() => {
            target.selectionStart = limitedCaret
            target.selectionEnd = limitedCaret
          })
        }
      }
    }
  }

  function finishSubmission() {
    if (!mountedRef.current) return
    submissionUncertainRef.current = false
    onSubmissionStateChange?.(false)
    pendingResponsesRef.current = null
    dirtySinceRef.current = null
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    clearFlaggedQuestions(testId)
    setFlaggedQuestions([])
    onSubmitted()
  }

  async function checkSubmission() {
    const scope = draftScopeRef.current
    setCheckingSubmission(true)
    setRetryAvailable(false)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      // Reconciliation must read current authoritative state, not a cached attempt.
      const response = await fetch(`${apiBasePath}/${testId}/attempt`, { method: 'GET', cache: 'no-store', signal: controller.signal })
      const data = await response.json()
      if (!mountedRef.current || draftScopeRef.current !== scope) return
      if (response.ok && data.attempt && typeof data.attempt.is_submitted === 'boolean' && data.attempt.responses && typeof data.attempt.responses === 'object') {
        const saved = normalizeTestResponses(data.attempt.responses)
        const shown = normalizeTestResponses(responses)
        const matches = matchesResponses(saved, shown)
        if (matches && data.attempt.is_submitted) {
          setSubmissionUncertain(false)
          finishSubmission()
          return
        }
        if (!matches) setSubmissionMismatch(true)
        else if (!data.attempt.is_submitted && data.attempt.draft_revision === scope.revision) {
          setSubmissionMismatch(false)
          setRetryAvailable(true)
        }
      }
    } catch { /* The outcome remains unknown; preserve the answers. */ }
    finally { clearTimeout(timeout); if (mountedRef.current && draftScopeRef.current === scope) setCheckingSubmission(false) }
  }

  async function sendSubmission(scope: typeof draftScopeRef.current, retry: boolean) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let knownFailure = false
    try {
      const response = await fetch(`${apiBasePath}/${testId}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ responses, expected_revision: scope.revision }),
      })
      const data = await response.json()
      if (!mountedRef.current || draftScopeRef.current !== scope) return
      if (response.status >= 500 || (response.ok && data.success !== true) || (retry && !response.ok)) throw new Error('Submission outcome unknown')
      if (data.error_code === 'test_attempt_revision_conflict') {
        scope.conflicted = true
        setRevisionConflict(true)
        knownFailure = true
        throw new Error('Saved answers changed in another tab. Your answers are still here. Load saved answers to continue.')
      }
      if (!response.ok) { knownFailure = true; throw new Error(data.error || 'Failed to submit response') }
      finishSubmission()
    } catch (error) {
      if (!mountedRef.current || draftScopeRef.current !== scope) return
      if (knownFailure) throw error
      submissionUncertainRef.current = true
      setSubmissionUncertain(true)
      await checkSubmission()
    } finally { clearTimeout(timeout) }
  }

  async function retrySubmission() {
    if (!retryAvailable || retryInFlightRef.current) return
    retryInFlightRef.current = true
    setRetryAvailable(false)
    setSubmissionUncertain(false)
    try { await sendSubmission(draftScopeRef.current, true) }
    finally { retryInFlightRef.current = false }
  }

  async function handleSubmit() {
    const scope = draftScopeRef.current
    setSubmitting(true)
    onSubmissionStateChange?.(true)
    setShowConfirm(false)
    setError('')
    setPreviewSubmitMessage('')

    try {
      if (previewMode) {
        setPreviewSubmitMessage('Preview mode only. Submission was not saved.')
        return
      }

      if (shouldAutosave) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        const saved = await saveDraft(responses, 'blur')
        if (!saved) return
      }
      if (!mountedRef.current || draftScopeRef.current !== scope) return
      if (scope.conflicted || !Number.isSafeInteger(scope.revision) || Number(scope.revision) < 1) {
        throw new Error('Reload the test before submitting. Your answers are still here.')
      }

      await sendSubmission(scope, false)
    } catch (err: any) {
      if (!mountedRef.current || draftScopeRef.current !== scope) return
      const message = err?.message || 'Failed to submit response'
      if (isAssessmentAvailabilityError(message)) {
        onAvailabilityLoss?.()
      }
      setError(message)
    } finally {
      if (mountedRef.current && draftScopeRef.current === scope) {
        // An ambiguous response may still be committing. Keep answers locked
        // until an authoritative read confirms submission.
        if (!submissionUncertainRef.current) {
          setSubmitting(false)
          onSubmissionStateChange?.(false)
        }
        setShowConfirm(false)
        setShowFlaggedWarning(false)
      }
    }
  }

  function handleToggleFlagged(questionId: string, questionNumber: number) {
    if (isInteractionLocked || submitting || loadingSaved) return

    const wasFlagged = isQuestionFlagged(testId, questionId)
    toggleFlaggedQuestion(testId, questionId)
    const updated = getFlaggedQuestions(testId)
    setFlaggedQuestions(updated)
    setFlagAnnouncement(
      wasFlagged
        ? `Question ${questionNumber} removed from review.`
        : `Question ${questionNumber} flagged for review.`
    )
  }

  return (
    <>
      <p
        data-testid="student-test-flag-status"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {flagAnnouncement}
      </p>
      <div className="mt-4 flex min-h-full flex-col gap-6">
        <div className="space-y-6">
          {questions.map((question, index) => (
            <div key={question.id} data-question-id={question.id} className="space-y-2">
              {(() => {
                const response = responses[question.id]
                const openResponseText =
                  response?.question_type === 'open_response' ? response.response_text : ''
                const selectedOption =
                  response?.question_type === 'multiple_choice' ? response.selected_option : null
                const isFlagged = isQuestionFlagged(testId, question.id)

                return (
                  <>
                    <div
                      data-question-title-id={question.id}
                      className={`group relative space-y-1 cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                        isFlagged ? 'bg-info-bg' : 'hover:bg-surface-hover'
                      } ${isInteractionLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                      onClick={() =>
                        !isInteractionLocked && handleToggleFlagged(question.id, index + 1)
                      }
                      title={isFlagged ? 'Unflag question' : 'Flag for review'}
                      role="button"
                      aria-label={`Flag question ${index + 1} for review`}
                      aria-pressed={isFlagged}
                      aria-disabled={isInteractionLocked || submitting || loadingSaved}
                      tabIndex={isInteractionLocked ? -1 : 0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                        }
                        if (
                          (e.key === 'Enter' || e.key === ' ') &&
                          !e.repeat &&
                          !isInteractionLocked
                        ) {
                          handleToggleFlagged(question.id, index + 1)
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Q{index + 1}
                            {typeof question.points === 'number'
                              ? ` · ${question.points} pts`
                              : ''}
                          </p>
                          <QuestionMarkdown content={question.question_text} />
                        </div>
                        <div
                          className={`text-2xl leading-none flex-shrink-0 pt-1 transition-opacity ${
                            isFlagged ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          {isFlagged ? '★' : '☆'}
                        </div>
                      </div>
                    </div>
                    {question.question_type === 'open_response' ? (
                      <div className="space-y-2">
                        <textarea
                          aria-label={`Response for question ${index + 1}`}
                          value={openResponseText}
                          disabled={isInteractionLocked || submitting || loadingSaved}
                          onChange={(event) =>
                            handleOpenResponseChange(
                              question.id,
                              event.target.value,
                              Number(question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS)
                            )
                          }
                          onKeyDown={(event) =>
                            handleOpenResponseKeyDown(
                              event,
                              question.id,
                              Number(question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS)
                            )
                          }
                          rows={6}
                          maxLength={Number(question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS)}
                          className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary ${
                            question.response_monospace ? 'font-mono leading-6' : ''
                          }`}
                          style={{ tabSize: OPEN_RESPONSE_TAB_SIZE }}
                          placeholder="Write your response..."
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {question.options.map((option, optionIndex) => {
                          const isSelected = selectedOption === optionIndex

                          return (
                            <div
                              key={optionIndex}
                              data-question-option
                              className={`relative flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                isSelected
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:bg-surface-hover'
                              } ${isInteractionLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                              onClick={() => {
                                if (!isInteractionLocked) {
                                  handleOptionSelect(question.id, optionIndex)
                                }
                              }}
                            >
                              <input
                                type="radio"
                                name={`question-${question.id}`}
                                checked={isSelected}
                                disabled={isInteractionLocked || submitting || loadingSaved}
                                aria-label={option}
                                onChange={() => handleOptionSelect(question.id, optionIndex)}
                                className="peer absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                              />
                              <span
                                aria-hidden="true"
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 ${
                                  isSelected ? 'border-primary' : 'border-border'
                                }`}
                              >
                                {isSelected && (
                                  <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                                )}
                              </span>
                              <QuestionMarkdown content={option} className="min-w-0 flex-1" />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))}

          {error && (
            <div
              className="rounded-lg bg-danger-bg p-3 text-sm text-danger"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              <p>{error}</p>
              {revisionConflict && <Button variant="surface" className="mt-3" onClick={() => setShowLoadSaved(true)} disabled={loadingSaved}>Load saved answers</Button>}
            </div>
          )}

          {previewSubmitMessage && (
            <div className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm text-success">
              {previewSubmitMessage}
            </div>
          )}

          {submitActions}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showLoadSaved}
        title="Load saved answers?"
        description="This replaces the answers currently shown with the latest saved answers. Cancel to keep your current answers."
        confirmLabel={loadingSaved ? 'Loading…' : 'Load saved answers'}
        cancelLabel="Cancel"
        isConfirmDisabled={loadingSaved}
        isCancelDisabled={loadingSaved}
        onCancel={() => setShowLoadSaved(false)}
        onConfirm={loadSavedAnswers}
      />

      <ConfirmDialog
        isOpen={showFlaggedWarning}
        title="Questions flagged for review"
        description={`You have ${flaggedQuestions.length} question${flaggedQuestions.length === 1 ? '' : 's'} flagged for review. Are you sure you want to submit?`}
        confirmLabel="Submit Anyway"
        cancelLabel="Cancel"
        isConfirmDisabled={submitting}
        isCancelDisabled={submitting}
        onCancel={() => {
          setShowFlaggedWarning(false)
        }}
        onConfirm={() => {
          setShowFlaggedWarning(false)
          setShowConfirm(true)
        }}
      />

      <ConfirmDialog
        isOpen={showConfirm && !showFlaggedWarning}
        title={previewMode ? 'Simulate submit?' : 'Submit your answers?'}
        description={
          previewMode
            ? 'This preview does not save data.'
            : 'You cannot change your answers after submitting.'
        }
        confirmLabel={submitting ? 'Submitting...' : previewMode ? 'Simulate Submit' : 'Submit'}
        cancelLabel="Cancel"
        isConfirmDisabled={submitting}
        isCancelDisabled={submitting}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleSubmit}
      />
    </>
  )
}
