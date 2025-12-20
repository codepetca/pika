'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { Assignment } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { addDaysToDateString } from '@/lib/date-string'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'

interface EditAssignmentModalProps {
  isOpen: boolean
  assignment: Assignment | null
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
}

export function EditAssignmentModal({ isOpen, assignment, onClose, onSuccess }: EditAssignmentModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState(getTodayInToronto())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen || !assignment) return
    setTitle(assignment.title)
    setDescription(assignment.description ?? '')
    setDueAt(formatDateInToronto(new Date(assignment.due_at)))
    setError('')
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

  if (!isOpen || !assignment) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[min(96vw,80rem)] p-6">
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
          onCancel={onClose}
          submitLabel={saving ? 'Saving...' : 'Save changes'}
          disabled={saving}
          error={error}
        />
      </div>
    </div>
  )
}
