'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { AssignmentForm } from '@/components/AssignmentForm'
import { addDaysToDateString } from '@/lib/date-string'
import { getTodayInToronto, toTorontoEndOfDayIso } from '@/lib/timezone'
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
  const [dueAt, setDueAt] = useState(getTodayInToronto())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setDescription('')
    setDueAt(addDaysToDateString(getTodayInToronto(), 1))
    setError('')
    setCreating(false)
  }, [isOpen])

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

      onSuccess(data.assignment as Assignment)
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[min(92vw,64rem)] p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">New Assignment</h2>

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
        />
      </div>
    </div>
  )
}
