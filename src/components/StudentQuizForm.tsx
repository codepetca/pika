'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfirmDialog } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import {
  DEFAULT_OPEN_RESPONSE_MAX_CHARS,
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
  onAvailabilityLoss?: () => void
  onSubmitted: () => void
}

function isAssessmentAvailabilityError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('not active') ||
    normalized.includes('not found') ||
    normalized.includes('submitted test') ||
    normalized.includes('already responded')
  )
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
  onAvailabilityLoss,
  onSubmitted,
}: Props) {
  const OPEN_RESPONSE_TAB_INDENT = '\t'
  const OPEN_RESPONSE_TAB_SIZE = 4
  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000
  const isTestMode =
    assessmentType === 'test' ||
    apiBasePath.includes('/tests') ||
    enableDraftAutosave ||
    questions.some((question) => question.question_type === 'open_response')
  const isTestAssessment = assessmentType === 'test' || apiBasePath.includes('/tests')

  const [responses, setResponses] = useState<TestResponses>(
    normalizeTestResponses(initialResponses)
  )
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [previewSubmitMessage, setPreviewSubmitMessage] = useState('')
  const [flaggedQuestions, setFlaggedQuestions] = useState<string[]>([])
  const [showFlaggedWarning, setShowFlaggedWarning] = useState(false)
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
  const saveStatusLabel =
    saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Unsaved changes'

  const submitActions = (
    <div
      data-testid="student-quiz-action-footer"
      className={
        isTestAssessment
          ? 'rounded-xl border border-border bg-surface p-4 shadow-sm'
          : 'sticky bottom-0 z-10 mt-auto rounded-lg border border-border bg-surface p-3 shadow-sm'
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          {shouldAutosave && (
            <p className="text-xs text-text-muted">{saveStatusLabel}</p>
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
          disabled={isInteractionLocked || !allAnswered || submitting}
          className="w-full sm:min-w-[10rem] sm:w-auto"
        >
          Submit
        </Button>
      </div>
    </div>
  )

  useEffect(() => {
    const normalized = normalizeTestResponses(initialResponses)
    setResponses(normalized)
    pendingResponsesRef.current = normalized
    lastSavedResponsesRef.current = JSON.stringify(normalized)
    setSaveStatus('saved')
  }, [initialResponses, quizId])

  // Load and monitor flagged questions from localStorage
  useEffect(() => {
    const loadFlaggedQuestions = () => {
      const flagged = getFlaggedQuestions(quizId)
      setFlaggedQuestions(flagged)
    }
    loadFlaggedQuestions()

    // Set up storage event listener for changes in other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `pika:flagged-questions:${quizId}`) {
        loadFlaggedQuestions()
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [quizId])

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
      const message = saveError instanceof Error ? saveError.message : 'Failed to save draft'
      if (isAssessmentAvailabilityError(message)) {
        onAvailabilityLoss?.()
      }
      setSaveStatus('unsaved')
    }
  }, [apiBasePath, onAvailabilityLoss, quizId, shouldAutosave])

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

  function handleOpenResponseKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    questionId: string,
    maxChars: number
  ) {
    if (isInteractionLocked) return

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
      // Clear flagged questions on successful submission
      clearFlaggedQuestions(quizId)
      setFlaggedQuestions([])
      onSubmitted()
    } catch (err: any) {
      const message = err?.message || 'Failed to submit response'
      if (isAssessmentAvailabilityError(message)) {
        onAvailabilityLoss?.()
      }
      setError(message)
    } finally {
      setSubmitting(false)
      setShowConfirm(false)
      setShowFlaggedWarning(false)
    }
  }

  function handleToggleFlagged(questionId: string) {
    const newState = toggleFlaggedQuestion(quizId, questionId)
    const updated = getFlaggedQuestions(quizId)
    setFlaggedQuestions(updated)
  }

  return (
    <>
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
                const isFlagged = isQuestionFlagged(quizId, question.id)

                return (
                  <>
                    <div
                      data-question-title-id={question.id}
                      className={`group relative space-y-1 cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                        isFlagged ? 'bg-info-bg' : 'hover:bg-surface-hover'
                      } ${isInteractionLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                      onClick={() => !isInteractionLocked && handleToggleFlagged(question.id)}
                      title={isFlagged ? 'Unflag question' : 'Flag for review'}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && !isInteractionLocked) {
                          handleToggleFlagged(question.id)
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Q{index + 1}
                            {isTestMode && typeof question.points === 'number'
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
                                disabled={isInteractionLocked}
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
            <div className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</div>
          )}

          {previewSubmitMessage && (
            <div className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm text-success">
              {previewSubmitMessage}
            </div>
          )}

          {isTestAssessment ? submitActions : null}
        </div>

        {isTestAssessment ? null : submitActions}
      </div>

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
