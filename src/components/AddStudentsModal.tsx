'use client'

import { useState, useLayoutEffect, useRef } from 'react'
import { CircleHelp } from 'lucide-react'
import { parseRosterInput, ParsedStudent, ParseError } from '@/lib/roster-parser'
import { IconButton } from '@/ui'

interface AddStudentsModalProps {
  isOpen: boolean
  onClose: () => void
  classroomId: string
  onSuccess: (classroomId: string) => void | Promise<void>
}

export function AddStudentsModal({ isOpen, onClose, classroomId, onSuccess }: AddStudentsModalProps) {
  const [input, setInput] = useState('')
  const [parseResult, setParseResult] = useState<{
    students: ParsedStudent[]
    errors: ParseError[]
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [textareaScroll, setTextareaScroll] = useState({ top: 0, left: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
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
    setParseResult(null)
    setIsSubmitting(false)
    setError('')
    setTextareaScroll({ top: 0, left: 0 })
    return () => {
      if (scopeRef.current.generation === generation) {
        scopeRef.current = {
          ...scopeRef.current,
          generation: generation + 1,
        }
      }
    }
  }, [classroomId, isOpen])

  // Match the usable area, including when classic scrollbars consume width.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    const syncSize = () => {
      mirror.style.width = `${textarea.clientWidth}px`
      mirror.style.height = `${textarea.clientHeight}px`
    }
    syncSize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncSize)
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [input, isOpen])

  // Parse input as it changes so guidance and the submit count stay current.
  function handleParseInput(value: string) {
    if (!value.trim()) {
      setParseResult(null)
      return
    }

    setParseResult(parseRosterInput(value))
  }

  async function handleSubmit() {
    if (!parseResult || parseResult.students.length === 0) {
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
          students: parseResult.students.map((s) => ({
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
      await onSuccess(operationClassroomId)
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

  const validCount = parseResult?.students.length || 0
  const problemLineNumbers = new Set(parseResult?.errors.map((parseError) => parseError.line) || [])
  let rosterLineNumber = 0
  const rosterInputLines = input.split('\n').map((line) => {
    const isRosterLine = line.trim().length > 0
    if (isRosterLine) rosterLineNumber += 1

    return {
      line,
      lineNumber: isRosterLine ? rosterLineNumber : null,
    }
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-lg shadow-xl border border-border max-w-2xl w-full p-6 max-h-[90vh] flex flex-col">
        <h2 className="text-xl font-bold text-text-default mb-4">Add Students</h2>

        <div className="flex-1 overflow-auto">
          {/* Input Textarea */}
          <div className="mb-4">
            <div className="mb-1 flex items-center gap-2">
              <label htmlFor="roster-input" className="block text-sm font-medium text-text-default">
                Enter student information
              </label>
              <IconButton
                icon={CircleHelp}
                label="Roster format help"
                tooltipOnClick
                tooltip={
                  <div className="space-y-1">
                    <div>One student per line.</div>
                    <div className="font-semibold">
                      [First name] [Last name] [Email] [<em>ID</em>] [<em>Email 2</em>]
                    </div>
                    <div>ID and Email2 are optional</div>
                  </div>
                }
                variant="ghost"
                className="h-11 w-11"
              />
            </div>
            <div className="relative">
              {input.length > 0 && (
                <div
                  ref={mirrorRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-px top-px overflow-hidden rounded-md px-3 py-2 font-mono text-sm leading-5"
                >
                  <div
                    className="whitespace-pre-wrap break-words"
                    style={{
                      transform: `translate(${-textareaScroll.left}px, ${-textareaScroll.top}px)`,
                    }}
                  >
                    {rosterInputLines.map(({ line, lineNumber }, index) => (
                      <div
                        key={index}
                        className={
                          lineNumber !== null && problemLineNumbers.has(lineNumber)
                            ? 'rounded-sm bg-warning-bg text-warning'
                            : 'text-text-default'
                        }
                      >
                        {line || '\u00a0'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                id="roster-input"
                className="relative block w-full px-3 py-2 border border-border-strong rounded-md
                           bg-transparent text-transparent caret-text-default placeholder:text-text-muted
                           focus:outline-none focus:ring-2 focus:ring-primary
                           resize-none font-mono text-sm leading-5"
                rows={12}
                aria-invalid={Boolean(parseResult?.errors.length)}
                aria-describedby={parseResult?.errors.length ? 'roster-format-guidance' : undefined}
                placeholder="Jane Doe jane@example.com [123456] [jane2@example.com]"
                value={input}
                onChange={(e) => {
                  const nextInput = e.target.value
                  setInput(nextInput)
                  handleParseInput(nextInput)
                }}
                onBlur={() => handleParseInput(input)}
                onScroll={(e) => {
                  setTextareaScroll({
                    top: e.currentTarget.scrollTop,
                    left: e.currentTarget.scrollLeft,
                  })
                }}
                disabled={isSubmitting}
              />
            </div>
            <div className="mt-2 min-h-10">
              {parseResult && parseResult.errors.length > 0 && (
                <div
                  className="text-sm text-warning"
                >
                  <p id="roster-format-guidance" role="status" aria-live="polite">
                    Use this format: Jane Doe email@example.com
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 text-sm text-danger bg-danger-bg border border-danger rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-4 pt-2">
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
            disabled={isSubmitting || !parseResult || parseResult.students.length === 0}
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
