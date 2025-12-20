'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Assignment } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'

interface EditAssignmentModalProps {
  isOpen: boolean
  assignment: Assignment | null
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
}

export function EditAssignmentModal({ isOpen, assignment, onClose, onSuccess }: EditAssignmentModalProps) {
  const initialValuesRef = useRef<{ title: string; description: string; dueAt: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const { dueAt, error, updateDueDate, moveDueDate, setDueAt, setError } = useAssignmentDateValidation(
    getTodayInToronto()
  )

  useEffect(() => {
    if (!isOpen || !assignment) return
    const nextTitle = assignment.title
    const nextDescription = assignment.description ?? ''
    const nextDueAt = formatDateInToronto(new Date(assignment.due_at))
    initialValuesRef.current = { title: nextTitle, description: nextDescription, dueAt: nextDueAt }
    setTitle(nextTitle)
    setDescription(nextDescription)
    setDueAt(nextDueAt)
    setError('')
    setShowCancelConfirm(false)

    // Focus the title input when modal opens
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 100)
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
          description,
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

  function hasChanges() {
    const initial = initialValuesRef.current
    if (!initial) return false
    return title !== initial.title || description !== initial.description || dueAt !== initial.dueAt
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
          description={description}
          dueAt={dueAt}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
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
