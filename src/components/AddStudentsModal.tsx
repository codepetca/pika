'use client'

import { useState, useLayoutEffect, useRef } from 'react'
import { parseRosterInput, ParsedStudent, ParseError } from '@/lib/roster-parser'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  TableCard,
} from '@/ui'

interface AddStudentsModalProps {
  isOpen: boolean
  onClose: () => void
  classroomId: string
  onSuccess: (classroomId: string) => void
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
  const scopeRef = useRef({ classroomId, isOpen, generation: 0 })

  function isCurrentScope(scope: typeof scopeRef.current) {
    return scopeRef.current.classroomId === scope.classroomId
      && scopeRef.current.isOpen === scope.isOpen
      && scopeRef.current.generation === scope.generation
  }

  // Reset state when modal opens/closes
  useLayoutEffect(() => {
    const generation = scopeRef.current.generation + 1
    scopeRef.current = { classroomId, isOpen, generation }
    setInput('')
    setPreview(null)
    setShowPreview(false)
    setIsSubmitting(false)
    setError('')
    return () => {
      if (scopeRef.current.generation === generation) {
        scopeRef.current = {
          ...scopeRef.current,
          generation: generation + 1,
        }
      }
    }
  }, [classroomId, isOpen])

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

    const operationScope = { ...scopeRef.current }
    const operationClassroomId = classroomId
    setIsSubmitting(true)
    setError('')

    try {
      const res = await fetch(`/api/teacher/classrooms/${operationClassroomId}/roster/add`, {
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
      onSuccess(operationClassroomId)
      if (isCurrentScope(operationScope)) onClose()
    } catch (err: any) {
      if (isCurrentScope(operationScope)) {
        setError(err.message || 'Failed to add students')
      }
    } finally {
      if (isCurrentScope(operationScope)) setIsSubmitting(false)
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
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
                         focus:outline-none focus:ring-2 focus:ring-primary
                         resize-none font-mono text-sm"
              rows={8}
              placeholder={`John Doe john@example.com
Jane Smith jane@example.com 123456
Bob Lee bob@example.com 789012 alt@example.com`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onBlur={handleParseInput}
              disabled={isSubmitting}
            />
            <p className="text-xs text-text-muted mt-2">
              One student per line. Student number and alt email are optional:<br />
              <span className="font-mono">First Last Email [StudentNumber] [AltEmail]</span>
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
              className="text-sm text-primary hover:text-primary-hover mb-3"
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
                    <span className="text-danger ml-2">
                      • {errorCount} error{errorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Valid Students */}
              {preview.students.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-medium text-text-muted mb-2">Valid Students</h4>
                  <TableCard overflowX chrome="flush">
                    <DataTable density="compact" className="min-w-full">
                      <DataTableHead>
                        <DataTableRow>
                          <DataTableHeaderCell className="text-xs">
                            First Name
                          </DataTableHeaderCell>
                          <DataTableHeaderCell className="text-xs">
                            Last Name
                          </DataTableHeaderCell>
                          <DataTableHeaderCell className="text-xs">
                            Email
                          </DataTableHeaderCell>
                          <DataTableHeaderCell className="text-xs">
                            Student #
                          </DataTableHeaderCell>
                          <DataTableHeaderCell className="text-xs">
                            Alt email
                          </DataTableHeaderCell>
                        </DataTableRow>
                      </DataTableHead>
                      <DataTableBody>
                        {preview.students.map((student, idx) => (
                          <DataTableRow key={idx}>
                            <DataTableCell>{student.firstName}</DataTableCell>
                            <DataTableCell>{student.lastName}</DataTableCell>
                            <DataTableCell className="text-text-muted">{student.email}</DataTableCell>
                            <DataTableCell className="text-text-muted">
                              {student.studentNumber || '—'}
                            </DataTableCell>
                            <DataTableCell className="text-text-muted">
                              {student.counselorEmail || '—'}
                            </DataTableCell>
                          </DataTableRow>
                        ))}
                      </DataTableBody>
                    </DataTable>
                  </TableCard>
                </div>
              )}

              {/* Errors */}
              {preview.errors.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-danger mb-2">Errors</h4>
                  <div className="space-y-1">
                    {preview.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="text-xs text-danger bg-danger-bg px-2 py-1 rounded"
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
            <div className="mb-4 text-sm text-danger bg-danger-bg border border-danger rounded-md px-3 py-2">
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
            className="flex-1 px-4 py-2 bg-surface-2 hover:bg-surface-hover
                       text-text-default font-medium rounded-md
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !preview || preview.students.length === 0}
            className="flex-1 px-4 py-2 bg-primary-solid hover:bg-primary-solid-hover
                       text-text-inverse font-medium rounded-md
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Adding...' : `Add ${validCount} Student${validCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
