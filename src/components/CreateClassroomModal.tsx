'use client'

import { useState, FormEvent } from 'react'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

interface CreateClassroomModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (classroom: any) => void
}

export function CreateClassroomModal({ isOpen, onClose, onSuccess }: CreateClassroomModalProps) {
  const [title, setTitle] = useState('')
  const [classCode, setClassCode] = useState('')
  const [termLabel, setTermLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/teacher/classrooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, classCode, termLabel }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create classroom')
      }

      onSuccess(data.classroom)
      setTitle('')
      setClassCode('')
      setTermLabel('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Create Classroom</h2>

        <form onSubmit={handleSubmit}>
          <Input
            label="Course Name"
            type="text"
            placeholder="GLD2O - Career Studies"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Class Code"
            type="text"
            placeholder="GLD2O-P1"
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Term"
            type="text"
            placeholder="Semester 2 2024-25"
            value={termLabel}
            onChange={(e) => setTermLabel(e.target.value)}
            disabled={loading}
            className="mb-4"
          />

          {error && (
            <div className="mb-4 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !title || !classCode}
              className="flex-1"
            >
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
