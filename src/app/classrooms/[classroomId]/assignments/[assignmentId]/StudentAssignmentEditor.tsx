'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { RichTextEditor } from '@/components/RichTextEditor'
import { ACTIONBAR_BUTTON_CLASSNAME, PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import {
  formatDueDate,
  formatRelativeDueDate,
  calculateAssignmentStatus,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
  isPastDue
} from '@/lib/assignments'
import { countCharacters, isEmpty } from '@/lib/tiptap-content'
import type { Assignment, AssignmentDoc, TiptapContent } from '@/types'

interface Props {
  classroomId: string
  assignmentId: string
}

export function StudentAssignmentEditor({ classroomId, assignmentId }: Props) {
  const router = useRouter()

  const AUTOSAVE_DEBOUNCE_MS = 5000
  const AUTOSAVE_MIN_INTERVAL_MS = 15000

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [doc, setDoc] = useState<AssignmentDoc | null>(null)
  const [content, setContent] = useState<TiptapContent>({ type: 'doc', content: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Save state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [submitting, setSubmitting] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAttemptAtRef = useRef(0)
  const pendingContentRef = useRef<TiptapContent | null>(null)

  useEffect(() => {
    loadAssignment()
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
      }
    }
  }, [assignmentId])

  async function loadAssignment() {
    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load assignment')
      }

      setAssignment(data.assignment)
      setDoc(data.doc)
      setContent(data.doc?.content || { type: 'doc', content: [] })
      lastSavedContentRef.current = JSON.stringify(data.doc?.content || { type: 'doc', content: [] })
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }

  // Autosave with debouncing
  const saveContent = useCallback(async (newContent: TiptapContent) => {
    const newContentStr = JSON.stringify(newContent)
    if (newContentStr === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')
    lastSaveAttemptAtRef.current = Date.now()

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save')
      }

      setDoc(data.doc)
      lastSavedContentRef.current = newContentStr
      setSaveStatus('saved')
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
    }
  }, [assignmentId])

  const scheduleSave = useCallback((newContent: TiptapContent, options?: { force?: boolean }) => {
    pendingContentRef.current = newContent

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastAttempt = now - lastSaveAttemptAtRef.current

    if (options?.force || msSinceLastAttempt >= AUTOSAVE_MIN_INTERVAL_MS) {
      void saveContent(newContent)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastAttempt
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingContentRef.current
      if (latest) {
        void saveContent(latest)
      }
    }, waitMs)
  }, [AUTOSAVE_MIN_INTERVAL_MS, saveContent])

  function handleContentChange(newContent: TiptapContent) {
    setContent(newContent)
    setSaveStatus('unsaved')
    pendingContentRef.current = newContent

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(newContent)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function flushAutosave() {
    if (saveStatus === 'unsaved' && pendingContentRef.current) {
      scheduleSave(pendingContentRef.current, { force: true })
    }
  }

  async function handleSubmit() {
    // Save first if there are unsaved changes
    if (JSON.stringify(content) !== lastSavedContentRef.current) {
      await saveContent(content)
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/submit`, {
        method: 'POST'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit')
      }

      setDoc(data.doc)
    } catch (err: any) {
      console.error('Error submitting:', err)
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUnsubmit() {
    setSubmitting(true)

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/unsubmit`, {
        method: 'POST'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unsubmit')
      }

      setDoc(data.doc)
    } catch (err: any) {
      console.error('Error unsubmitting:', err)
      setError(err.message || 'Failed to unsubmit')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error && !assignment) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => router.back()}
          className="text-blue-600 hover:text-blue-700"
        >
          Go back
        </button>
      </div>
    )
  }

  if (!assignment) {
    return null
  }

  const status = calculateAssignmentStatus(assignment, doc)
  const isLate = isPastDue(assignment.due_at)
  const isSubmitted = doc?.is_submitted || false

  return (
    <PageLayout>
      <PageActionBar
        primary={
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                className={ACTIONBAR_BUTTON_CLASSNAME}
                onClick={() => router.push(`/classrooms/${classroomId}`)}
              >
                Back to classroom
              </button>
              <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {assignment.title}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                Due: {formatDueDate(assignment.due_at)} • {formatRelativeDueDate(assignment.due_at)}
              </div>
            </div>
            <span className={`px-3 py-1 rounded text-sm font-medium ${getAssignmentStatusBadgeClass(status)}`}>
              {getAssignmentStatusLabel(status)}
            </span>
          </div>
        }
      />

      <PageContent className="space-y-6">
        {/* Description */}
        {assignment.description && (
          <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{assignment.description}</p>
          </div>
        )}

        {/* Editor */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Your Response</span>
            <span className={`text-xs ${
              saveStatus === 'saved' ? 'text-green-600 dark:text-green-400' :
              saveStatus === 'saving' ? 'text-gray-500 dark:text-gray-400' :
              'text-orange-600 dark:text-orange-400'
            }`}>
              {saveStatus === 'saved' ? 'Saved' :
               saveStatus === 'saving' ? 'Saving...' :
               'Unsaved changes'}
            </span>
          </div>

          <div className="p-4">
            <RichTextEditor
              content={content}
              onChange={handleContentChange}
              placeholder="Write your response here..."
              disabled={submitting}
              editable={!isSubmitted}
              onBlur={flushAutosave}
            />
          </div>

          {error && (
            <div className="px-4 pb-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {countCharacters(content)} characters
            </div>

            <div className="flex gap-2">
              {isSubmitted ? (
                <Button
                  onClick={handleUnsubmit}
                  variant="secondary"
                  disabled={submitting}
                >
                  {submitting ? 'Unsubmitting...' : 'Unsubmit'}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || isEmpty(content)}
                >
                  {submitting ? 'Submitting...' : 'Submit'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Submission info */}
        {isSubmitted && doc?.submitted_at && (
          <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
            Submitted on {new Date(doc.submitted_at).toLocaleString('en-CA', {
              timeZone: 'America/Toronto',
              dateStyle: 'medium',
              timeStyle: 'short'
            })}
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
