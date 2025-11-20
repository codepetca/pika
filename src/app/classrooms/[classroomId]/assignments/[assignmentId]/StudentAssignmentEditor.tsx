'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import {
  formatDueDate,
  formatRelativeDueDate,
  calculateAssignmentStatus,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
  isPastDue
} from '@/lib/assignments'
import type { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'

interface Props {
  classroomId: string
  assignmentId: string
}

export function StudentAssignmentEditor({ classroomId, assignmentId }: Props) {
  const router = useRouter()

  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [doc, setDoc] = useState<AssignmentDoc | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Save state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [submitting, setSubmitting] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContentRef = useRef('')

  useEffect(() => {
    loadAssignment()
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
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
      setContent(data.doc?.content || '')
      lastSavedContentRef.current = data.doc?.content || ''
    } catch (err: any) {
      console.error('Error loading assignment:', err)
      setError(err.message || 'Failed to load assignment')
    } finally {
      setLoading(false)
    }
  }

  // Autosave with debouncing
  const saveContent = useCallback(async (newContent: string) => {
    if (newContent === lastSavedContentRef.current) {
      setSaveStatus('saved')
      return
    }

    setSaveStatus('saving')

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
      lastSavedContentRef.current = newContent
      setSaveStatus('saved')
    } catch (err: any) {
      console.error('Error saving:', err)
      setSaveStatus('unsaved')
    }
  }, [assignmentId])

  function handleContentChange(newContent: string) {
    setContent(newContent)
    setSaveStatus('unsaved')

    // Debounce save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveContent(newContent)
    }, 1500) // Save after 1.5 seconds of no typing
  }

  async function handleSubmit() {
    // Save first if there are unsaved changes
    if (content !== lastSavedContentRef.current) {
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
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => router.push(`/classrooms/${classroomId}`)}
            className="text-sm text-blue-600 hover:text-blue-700 mb-2"
          >
            ← Back to classroom
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{assignment.title}</h1>
          <p className="text-gray-600 mt-1">
            Due: {formatDueDate(assignment.due_at)}
          </p>
          <p className={`text-sm mt-1 ${isLate ? 'text-red-600' : 'text-gray-500'}`}>
            {formatRelativeDueDate(assignment.due_at)}
          </p>
        </div>
        <span className={`px-3 py-1 rounded text-sm font-medium ${getAssignmentStatusBadgeClass(status)}`}>
          {getAssignmentStatusLabel(status)}
        </span>
      </div>

      {/* Description */}
      {assignment.description && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-gray-700 whitespace-pre-wrap">{assignment.description}</p>
        </div>
      )}

      {/* Editor */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Your Response</span>
          <span className={`text-xs ${
            saveStatus === 'saved' ? 'text-green-600' :
            saveStatus === 'saving' ? 'text-gray-500' :
            'text-orange-600'
          }`}>
            {saveStatus === 'saved' ? 'Saved' :
             saveStatus === 'saving' ? 'Saving...' :
             'Unsaved changes'}
          </span>
        </div>

        <div className="p-4">
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            rows={16}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder="Write your response here..."
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="px-4 pb-4">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {content.length} characters
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
                disabled={submitting || !content.trim()}
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Submission info */}
      {isSubmitted && doc?.submitted_at && (
        <div className="text-sm text-gray-600 text-center">
          Submitted on {new Date(doc.submitted_at).toLocaleString('en-CA', {
            timeZone: 'America/Toronto',
            dateStyle: 'medium',
            timeStyle: 'short'
          })}
        </div>
      )}
    </div>
  )
}
