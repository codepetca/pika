'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Assignment } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { addDaysToDateString } from '@/lib/date-string'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'

interface EditAssignmentModalProps {
  isOpen: boolean
  assignment: Assignment | null
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
}

export function EditAssignmentModal({ isOpen, assignment, onClose, onSuccess }: EditAssignmentModalProps) {
  const initialValuesRef = useRef<{ title: string; description: string; dueAt: string } | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState(getTodayInToronto())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

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
  }, [assignment, isOpen])

  function updateDueDate(next: string) {
    const today = getTodayInToronto()
    if (next < today) {
      setError('Warning: Due date is in the past')
    } else {
      setError('')
    }
    setDueAt(next)
  }

  function moveDueDate(days: number) {
    const today = getTodayInToronto()
    const base = dueAt || today
    const next = addDaysToDateString(base, days)
    if (next < today) {
      setError('Warning: Due date is in the past')
    } else {
      setError('')
    }
    setDueAt(next)
  }

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
      onSuccess(data.assignment as Assignment)
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[min(90vw,56rem)] p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Edit Assignment</h2>

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
        />
      </div>

      <ConfirmDialog
        isOpen={showCancelConfirm}
        title="Discard changes?"
        description="Your edits will be lost if you cancel."
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
