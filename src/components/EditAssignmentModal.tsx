'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Assignment, TiptapContent } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'

const EMPTY_INSTRUCTIONS: TiptapContent = { type: 'doc', content: [] }

interface EditAssignmentModalProps {
  isOpen: boolean
  assignment: Assignment | null
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
}

export function EditAssignmentModal({ isOpen, assignment, onClose, onSuccess }: EditAssignmentModalProps) {
  const initialValuesRef = useRef<{ title: string; dueAt: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  // Track whether TipTap has finished initializing (to ignore normalization changes)
  const isInitializedRef = useRef(false)
  // Track whether user has made actual edits to instructions (after initialization)
  const instructionsChangedRef = useRef(false)
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState<TiptapContent>(EMPTY_INSTRUCTIONS)
  const [saving, setSaving] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const { dueAt, error, updateDueDate, moveDueDate, setDueAt, setError } = useAssignmentDateValidation(
    getTodayInToronto()
  )

  useEffect(() => {
    if (!isOpen || !assignment) return
    const nextTitle = assignment.title
    const nextInstructions = assignment.rich_instructions ?? EMPTY_INSTRUCTIONS
    const nextDueAt = formatDateInToronto(new Date(assignment.due_at))
    initialValuesRef.current = { title: nextTitle, dueAt: nextDueAt }
    // Reset dirty tracking refs
    isInitializedRef.current = false
    instructionsChangedRef.current = false
    setTitle(nextTitle)
    setInstructions(nextInstructions)
    setDueAt(nextDueAt)
    setError('')
    setShowCancelConfirm(false)

    // Focus the title input when modal opens
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 100)

    // Mark as initialized after TipTap has had time to normalize content
    requestAnimationFrame(() => {
      isInitializedRef.current = true
    })
  }, [assignment, isOpen, setDueAt, setError])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assignment) return
    setError('')
    setSaving(true)

    try {
      const response = await fetch(`/api/teacher/assignments/${assignment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          rich_instructions: instructions,
          due_at: toTorontoEndOfDayIso(dueAt),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update assignment')
      }

      if (!data.assignment) {
        throw new Error('Invalid response: missing assignment data')
      }

      onSuccess(data.assignment)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment')
    } finally {
      setSaving(false)
    }
  }

  function handleInstructionsChange(newInstructions: TiptapContent) {
    // Only mark as changed if TipTap has finished initializing
    // This prevents false positives from TipTap's content normalization
    if (isInitializedRef.current) {
      instructionsChangedRef.current = true
    }
    setInstructions(newInstructions)
  }

  function hasChanges() {
    const initial = initialValuesRef.current
    if (!initial) return false
    return (
      title !== initial.title ||
      instructionsChangedRef.current ||
      dueAt !== initial.dueAt
    )
  }

  function handleCancel() {
    if (hasChanges()) {
      setShowCancelConfirm(true)
      return
    }
    onClose()
  }

  if (!isOpen || !assignment) return null

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      handleCancel()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[min(90vw,56rem)] p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-assignment-modal-title"
      >
        <h2 id="edit-assignment-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Edit Assignment
        </h2>

        <AssignmentForm
          title={title}
          instructions={instructions}
          dueAt={dueAt}
          onTitleChange={setTitle}
          onInstructionsChange={handleInstructionsChange}
          onDueAtChange={updateDueDate}
          onPrevDate={() => moveDueDate(-1)}
          onNextDate={() => moveDueDate(1)}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          submitLabel={saving ? 'Saving...' : 'Save changes'}
          disabled={saving}
          error={error}
          titleInputRef={titleInputRef}
        />
      </div>

      <ConfirmDialog
        isOpen={showCancelConfirm}
        title="You have unsaved changes."
        confirmLabel="Discard changes"
        cancelLabel="Continue editing"
        confirmVariant="danger"
        onCancel={() => setShowCancelConfirm(false)}
        onConfirm={() => {
          setShowCancelConfirm(false)
          onClose()
        }}
      />
    </div>
  )
}
