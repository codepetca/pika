'use client'

import { useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Spinner } from '@/components/Spinner'
import { formatDueDate } from '@/lib/assignments'
import type { Classroom, Assignment, AssignmentStats } from '@/types'

interface AssignmentWithStats extends Assignment {
  stats: AssignmentStats
}

interface Props {
  classroom: Classroom
}

export function TeacherClassroomView({ classroom }: Props) {
  const [assignments, setAssignments] = useState<AssignmentWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)

  // New assignment form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadAssignments()
  }, [classroom.id])

  async function loadAssignments() {
    try {
      const response = await fetch(`/api/teacher/assignments?classroom_id=${classroom.id}`)
      const data = await response.json()
      setAssignments(data.assignments || [])
    } catch (err) {
      console.error('Error loading assignments:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAssignment(e: FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)

    try {
      const response = await fetch('/api/teacher/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroom.id,
          title,
          description,
          due_at: new Date(dueAt).toISOString()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create assignment')
      }

      // Reset form and reload
      setTitle('')
      setDescription('')
      setDueAt('')
      setShowNewForm(false)
      loadAssignments()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Assignments"
        action={
          <Button
            onClick={() => setShowNewForm(!showNewForm)}
            size="sm"
          >
            {showNewForm ? 'Cancel' : '+ New Assignment'}
          </Button>
        }
      />

      {/* New Assignment Form */}
      {showNewForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4">
          <form onSubmit={handleCreateAssignment} className="space-y-3 max-w-xl">
              <Input
                label="Title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={creating}
                placeholder="Assignment title"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Assignment instructions (optional)"
                  disabled={creating}
                />
              </div>

              <Input
                label="Due Date"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                required
                disabled={creating}
              />

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

            <div className="flex gap-2">
              <Button type="submit" disabled={creating || !title || !dueAt}>
                {creating ? 'Creating...' : 'Create Assignment'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewForm(false)}
                disabled={creating}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Assignments List */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">
            No assignments yet
          </div>
        ) : (
          <div className="space-y-2">
              {assignments.map((assignment) => (
                <Link
                  key={assignment.id}
                  href={`/classrooms/${classroom.id}/assignments/${assignment.id}`}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {assignment.title}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Due: {formatDueDate(assignment.due_at)}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-gray-600">
                        {assignment.stats.submitted} / {assignment.stats.total_students} submitted
                      </div>
                      {assignment.stats.late > 0 && (
                        <div className="text-orange-600">
                          {assignment.stats.late} late
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
