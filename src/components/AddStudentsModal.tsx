'use client'

import { useState, useEffect } from 'react'
import { parseRosterInput, ParsedStudent, ParseError } from '@/lib/roster-parser'

interface AddStudentsModalProps {
  isOpen: boolean
  onClose: () => void
  classroomId: string
  onSuccess: () => void
}

export function AddStudentsModal({ isOpen, onClose, classroomId, onSuccess }: AddStudentsModalProps) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<{
    students: ParsedStudent[]
    errors: ParseError[]
  } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setInput('')
      setPreview(null)
      setShowPreview(false)
      setError('')
    }
  }, [isOpen])

  // Parse input when textarea loses focus or when toggling preview
  function handleParseInput() {
    if (!input.trim()) {
      setPreview(null)
      return
    }

    const result = parseRosterInput(input)
    setPreview(result)
    setShowPreview(true)
  }

  async function handleSubmit() {
    if (!preview || preview.students.length === 0) {
      setError('No valid students to add')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/classrooms/${classroomId}/roster/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: preview.students.map((s) => ({
            email: s.email,
            firstName: s.firstName,
            lastName: s.lastName,
            studentNumber: s.studentNumber || undefined,
            counselorEmail: s.counselorEmail || undefined,
          })),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add students')
      }

      // Success!
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to add students')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleClose() {
    if (isSubmitting) return
    onClose()
  }

  if (!isOpen) return null

  const validCount = preview?.students.length || 0
  const errorCount = preview?.errors.length || 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-lg shadow-xl border border-border max-w-2xl w-full p-6 max-h-[90vh] flex flex-col">
        <h2 className="text-xl font-bold text-text-default mb-4">Add Students</h2>

        <div className="flex-1 overflow-auto">
          {/* Input Textarea */}
          <div className="mb-4">
            <label htmlFor="roster-input" className="block text-sm font-medium text-text-muted mb-2">
              Enter student information
            </label>
            <textarea
              id="roster-input"
              className="w-full px-3 py-2 border border-border-strong rounded-md
                         bg-surface text-text-default
                         focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                         resize-none font-mono text-sm"
              rows={8}
              placeholder={`John Doe john@example.com
Jane Smith jane@example.com 123456
Bob Lee bob@example.com 789012 counselor@school.com`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onBlur={handleParseInput}
              disabled={isSubmitting}
            />
            <p className="text-xs text-text-muted mt-2">
              One student per line. StudentNumber and CounselorEmail are optional:<br />
              <span className="font-mono">First Last Email [StudentNumber] [CounselorEmail]</span>
            </p>
          </div>

          {/* Preview Toggle */}
          {input.trim() && (
            <button
              type="button"
              onClick={() => {
                if (!showPreview) {
                  handleParseInput()
                } else {
                  setShowPreview(!showPreview)
                }
              }}
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mb-3"
              disabled={isSubmitting}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          )}

          {/* Preview Section */}
          {showPreview && preview && (
            <div className="mb-4 p-4 bg-surface-2 rounded-lg border border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-text-default">Preview</h3>
                <div className="text-sm text-text-muted">
                  {validCount} student{validCount !== 1 ? 's' : ''} will be added
                  {errorCount > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-2">
                      • {errorCount} error{errorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Valid Students */}
              {preview.students.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-medium text-text-muted mb-2">Valid Students</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                            First Name
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                            Last Name
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                            Email
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                            Student #
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                            Counselor
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-surface divide-y divide-border">
                        {preview.students.map((student, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-text-default">{student.firstName}</td>
                            <td className="px-3 py-2 text-text-default">{student.lastName}</td>
                            <td className="px-3 py-2 text-text-muted">{student.email}</td>
                            <td className="px-3 py-2 text-text-muted">
                              {student.studentNumber || '—'}
                            </td>
                            <td className="px-3 py-2 text-text-muted">
                              {student.counselorEmail || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Errors */}
              {preview.errors.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-red-700 dark:text-red-400 mb-2">Errors</h4>
                  <div className="space-y-1">
                    {preview.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded"
                      >
                        <strong>Line {err.line}:</strong> {err.error} — <code className="font-mono">{err.raw}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6 pt-4 border-t border-border">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600
                       text-text-default font-medium rounded-md
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !preview || preview.students.length === 0}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600
                       text-white font-medium rounded-md
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Adding...' : `Add ${validCount} Student${validCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
