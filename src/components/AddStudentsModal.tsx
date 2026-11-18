'use client'

import { useState, useLayoutEffect, useRef } from 'react'
import { CircleHelp } from 'lucide-react'
import { parseRosterInput, ParsedStudent, ParseError } from '@/lib/roster-parser'
import { DialogPanel, IconButton } from '@/ui'

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
  const [notice, setNotice] = useState('')
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
    setNotice('')
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
    const rejectedLines = new Set(parseResult.errors.map((item) => item.line))
    const rejectedInput = input.split('\n').filter((_, index) => rejectedLines.has(index + 1)).join('\n')
    const submittedCount = parseResult.students.length
    setIsSubmitting(true)
    setError('')
    setNotice('')

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

      const confirmed = data.success === true && data.upsertedCount === submittedCount && !data.errors?.length
      let refreshFailed = false
      try {
        await onSuccess(operationClassroomId)
      } catch {
        refreshFailed = true
      }
      if (!isCurrentScope(operationScope)) return
      if (!confirmed) {
        setError('Some students may have been added. Check the roster before retrying.')
      } else if (rejectedInput || refreshFailed) {
        setInput(rejectedInput)
        setParseResult(rejectedInput ? parseRosterInput(rejectedInput) : null)
        if (refreshFailed) setError('Students were added, but the roster could not be refreshed.')
        else setNotice('Valid students added. Correct the remaining lines.')
      } else {
        onClose()
      }
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

  const validCount = parseResult?.students.length || 0
  const problemLineNumbers = new Set(parseResult?.errors.map((parseError) => parseError.line) || [])
  const rosterInputLines = input.split('\n').map((line) => {
    return {
      line,
    }
  })

  return (
    <DialogPanel isOpen={isOpen} onClose={handleClose} closeDisabled={isSubmitting} closeLabel="Close Add Students" ariaLabelledBy="add-students-title" maxWidth="sm:max-w-2xl">
        <h2 id="add-students-title" className="pr-14 text-xl font-bold text-text-default mb-4">Add Students</h2>

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
                      [First name] [Last name] [Email] [<em>ID</em>] [<em>Guardian email</em>]
                    </div>
                    <div>ID and guardian email are optional</div>
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
                    {rosterInputLines.map(({ line }, index) => (
                      <div
                        key={index}
                        className={
                          problemLineNumbers.has(index + 1)
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
                placeholder="Jane Doe jane@example.com [123456] [guardian@example.com]"
                value={input}
                onChange={(e) => {
                  const nextInput = e.target.value
                  setInput(nextInput)
                  setNotice('')
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
                  <div id="roster-format-guidance" role="status" aria-live="polite">
                    {parseResult.errors.map((item) => <p key={item.line}>Line {item.line}: {item.error}</p>)}
                    {validCount > 0 && <p>Only valid rows will be added.</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="mb-4 text-sm text-danger bg-danger-bg border border-danger rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {notice && <p role="status" className="mb-4 text-sm text-text-muted">{notice}</p>}
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
    </DialogPanel>
  )
}
