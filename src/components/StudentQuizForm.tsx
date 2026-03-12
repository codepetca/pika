'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfirmDialog } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import {
  DEFAULT_OPEN_RESPONSE_MAX_CHARS,
  normalizeTestResponses,
  type TestResponses,
} from '@/lib/test-attempts'
import { applyTextareaIndent } from '@/lib/textarea-indent'
import type { QuizAssessmentType, QuizQuestion, TestResponseDraftValue } from '@/types'

interface Props {
  quizId: string
  questions: QuizQuestion[]
  initialResponses?: Record<string, number | TestResponseDraftValue> | TestResponses
  enableDraftAutosave?: boolean
  previewMode?: boolean
  isInteractionLocked?: boolean
  assessmentType?: QuizAssessmentType
  apiBasePath?: string
  onSubmitted: () => void
}

export function StudentQuizForm({
  quizId,
  questions,
  initialResponses,
  enableDraftAutosave = false,
  previewMode = false,
  isInteractionLocked = false,
  assessmentType,
  apiBasePath = '/api/student/quizzes',
  onSubmitted,
}: Props) {
  const OPEN_RESPONSE_TAB_INDENT = '    '
  const OPEN_RESPONSE_TAB_SIZE = 4
  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000
  const isTestMode =
    assessmentType === 'test' ||
    apiBasePath.includes('/tests') ||
    enableDraftAutosave ||
    questions.some((question) => question.question_type === 'open_response')

  const [responses, setResponses] = useState<TestResponses>(
    normalizeTestResponses(initialResponses)
  )
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [previewSubmitMessage, setPreviewSubmitMessage] = useState('')
  const shouldAutosave = enableDraftAutosave && !previewMode

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingResponsesRef = useRef<TestResponses | null>(null)
  const lastSavedResponsesRef = useRef('')
  const lastSaveAttemptAtRef = useRef(0)

  const allAnswered = questions.every((question) => {
    const response = responses[question.id]
    const questionType =
      question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
    if (!response) return false
    if (questionType === 'open_response') {
      return response.question_type === 'open_response' && response.response_text.trim().length > 0
    }
    return response.question_type === 'multiple_choice'
  })
  useEffect(() => {
    const normalized = normalizeTestResponses(initialResponses)
    setResponses(normalized)
    pendingResponsesRef.current = normalized
    lastSavedResponsesRef.current = JSON.stringify(normalized)
    setSaveStatus('saved')
  }, [initialResponses, quizId])

  const saveDraft = useCallback(async (
    draftResponses: TestResponses,
    options?: { trigger?: 'autosave' | 'blur'; force?: boolean }
  ) => {
    if (!shouldAutosave) return

    const next = normalizeTestResponses(draftResponses)
    const serialized = JSON.stringify(next)
    if (!options?.force && serialized === lastSavedResponsesRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    lastSaveAttemptAtRef.current = Date.now()

    try {
      const res = await fetch(`${apiBasePath}/${quizId}/attempt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: next,
          trigger: options?.trigger ?? 'autosave',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save draft')
      }
      lastSavedResponsesRef.current = serialized
      setSaveStatus('saved')
    } catch (saveError) {
      console.error('Error saving test draft:', saveError)
      setSaveStatus('unsaved')
    }
  }, [apiBasePath, quizId, shouldAutosave])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (throttledSaveTimeoutRef.current) clearTimeout(throttledSaveTimeoutRef.current)
      if (!shouldAutosave || !pendingResponsesRef.current) return
      void saveDraft(pendingResponsesRef.current, { trigger: 'blur' })
    }
  }, [saveDraft, shouldAutosave])

  const scheduleSave = useCallback((
    draftResponses: TestResponses,
    options?: { force?: boolean; trigger?: 'autosave' | 'blur' }
  ) => {
    if (!shouldAutosave) return

    pendingResponsesRef.current = draftResponses

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptAtRef.current
    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void saveDraft(draftResponses, { trigger: options?.trigger, force: options?.force })
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingResponsesRef.current
      if (latest) {
        void saveDraft(latest, { trigger: options?.trigger, force: options?.force })
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, saveDraft, shouldAutosave])

  function toQuizSubmissionPayload(nextResponses: TestResponses): Record<string, number> {
    const payload: Record<string, number> = {}
    for (const [questionId, response] of Object.entries(nextResponses)) {
      if (response.question_type === 'multiple_choice') {
        payload[questionId] = response.selected_option
      }
    }
    return payload
  }

  function handleOptionSelect(questionId: string, optionIndex: number) {
    if (isInteractionLocked) return
    setResponses((prev) => {
      const next = normalizeTestResponses({
        ...prev,
        [questionId]: {
          question_type: 'multiple_choice',
          selected_option: optionIndex,
        },
      })
      if (shouldAutosave) {
        setSaveStatus('unsaved')
        pendingResponsesRef.current = next
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => {
          scheduleSave(next, { trigger: 'autosave' })
        }, AUTOSAVE_DEBOUNCE_MS)
      }
      return next
    })
  }

  function handleOpenResponseChange(questionId: string, value: string, maxChars: number) {
    if (isInteractionLocked) return
    const limited = value.slice(0, maxChars)
    setResponses((prev) => {
      const next = normalizeTestResponses({
        ...prev,
        [questionId]: {
          question_type: 'open_response',
          response_text: limited,
        },
      })
      if (shouldAutosave) {
        setSaveStatus('unsaved')
        pendingResponsesRef.current = next
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => {
          scheduleSave(next, { trigger: 'autosave' })
        }, AUTOSAVE_DEBOUNCE_MS)
      }
      return next
    })
  }

  function handleOpenResponseTabKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    questionId: string,
    maxChars: number
  ) {
    if (isInteractionLocked) return
    if (event.key !== 'Tab') return
    event.preventDefault()

    const target = event.currentTarget
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
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    setPreviewSubmitMessage('')

    try {
      if (previewMode) {
        setPreviewSubmitMessage('Preview mode only. Submission was not saved.')
        return
      }

      if (shouldAutosave) {
        await saveDraft(responses, { trigger: 'blur', force: true })
      }

      const res = await fetch(`${apiBasePath}/${quizId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: isTestMode ? responses : toQuizSubmissionPayload(responses),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit response')
      }
      onSubmitted()
    } catch (err: any) {
      setError(err.message || 'Failed to submit response')
    } finally {
      setSubmitting(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className="mt-4 space-y-6">
      {questions.map((question, index) => (
        <div key={question.id} className="space-y-2">
          {(() => {
            const response = responses[question.id]
            const openResponseText =
              response?.question_type === 'open_response' ? response.response_text : ''
            const selectedOption =
              response?.question_type === 'multiple_choice' ? response.selected_option : null

            return (
              <>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Q{index + 1}
                    {isTestMode && typeof question.points === 'number' ? ` · ${question.points} pts` : ''}
                  </p>
                  <QuestionMarkdown content={question.question_text} />
                </div>
                {question.question_type === 'open_response' ? (
                  <div className="space-y-2">
                    <textarea
                      value={openResponseText}
                      disabled={isInteractionLocked}
                      onChange={(event) =>
                        handleOpenResponseChange(
                          question.id,
                          event.target.value,
                          Number(question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS)
                        )
                      }
                      onKeyDown={(event) =>
                        handleOpenResponseTabKeyDown(
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
                        <label
                          key={optionIndex}
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-surface-hover'
                          } ${isInteractionLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                        >
                          <input
                            type="radio"
                            name={`question-${question.id}`}
                            checked={isSelected}
                            disabled={isInteractionLocked}
                            onChange={() => handleOptionSelect(question.id, optionIndex)}
                            className="sr-only"
                          />
                          <span
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                              isSelected ? 'border-primary' : 'border-border'
                            }`}
                          >
                            {isSelected && (
                              <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                            )}
                          </span>
                          <span className="text-text-default">{option}</span>
                        </label>
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
        <div className="p-3 bg-danger-bg text-danger text-sm rounded-lg">{error}</div>
      )}

      {shouldAutosave && (
        <p className="text-xs text-text-muted">
          {saveStatus === 'saving'
            ? 'Saving...'
            : saveStatus === 'saved'
              ? 'Saved'
              : 'Unsaved changes'}
        </p>
      )}

      {previewSubmitMessage && (
        <div className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm text-success">
          {previewSubmitMessage}
        </div>
      )}

      <div className="pt-4">
        <Button
          onClick={() => setShowConfirm(true)}
          disabled={isInteractionLocked || !allAnswered || submitting}
          className="w-full"
        >
          Submit
        </Button>
        {!allAnswered && (
          <p className="text-sm text-text-muted text-center mt-2">
            Answer all questions to submit
          </p>
        )}
      </div>

      <ConfirmDialog
        isOpen={showConfirm}
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
    </div>
  )
}
