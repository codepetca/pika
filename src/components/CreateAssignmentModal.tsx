'use client'

import { useEffect, useState, useRef, type FormEvent } from 'react'
import { AssignmentForm } from '@/components/AssignmentForm'
import { addDaysToDateString } from '@/lib/date-string'
import { getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'
import type { Assignment } from '@/types'

interface CreateAssignmentModalProps {
  isOpen: boolean
  classroomId: string
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
}

export function CreateAssignmentModal({ isOpen, classroomId, onClose, onSuccess }: CreateAssignmentModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const { dueAt, error, updateDueDate, moveDueDate, setDueAt, setError } = useAssignmentDateValidation(
    addDaysToDateString(getTodayInToronto(), 1)
  )
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setDescription('')
    setDueAt(addDaysToDateString(getTodayInToronto(), 1))
    setError('')
    setCreating(false)

    // Focus the title input when modal opens
    setTimeout(() => {
      titleInputRef.current?.focus()
    }, 100)
  }, [isOpen, setDueAt, setError])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCreating(true)

    try {
      const response = await fetch('/api/teacher/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroomId,
          title,
          description,
          due_at: toTorontoEndOfDayIso(dueAt),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create assignment')
      }

      if (!data.assignment) {
        throw new Error('Invalid response: missing assignment data')
      }

      onSuccess(data.assignment)
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
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
        aria-labelledby="create-assignment-modal-title"
      >
        <h2 id="create-assignment-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          New Assignment
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
          onCancel={onClose}
          submitLabel={creating ? 'Creating...' : 'Create Assignment'}
          disabled={creating}
          error={error}
          titleInputRef={titleInputRef}
        />
      </div>
    </div>
  )
}
