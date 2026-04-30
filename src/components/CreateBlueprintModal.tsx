'use client'

import { useState } from 'react'
import { Button, DialogPanel, FormField, Input } from '@/ui'
import type { CourseBlueprint } from '@/types'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: (blueprint: CourseBlueprint) => void
}

export function CreateBlueprintModal({ isOpen, onClose, onSuccess }: Props) {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [termTemplate, setTermTemplate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setTitle('')
    setSubject('')
    setGradeLevel('')
    setCourseCode('')
    setTermTemplate('')
    setError('')
  }

  async function handleCreate() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/teacher/course-blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          subject,
          grade_level: gradeLevel,
          course_code: courseCode,
          term_template: termTemplate,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create blueprint')
      }
      onSuccess(data.blueprint)
      reset()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create blueprint')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    if (loading) return
    reset()
    onClose()
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-xl"
      className="p-6"
      ariaLabelledBy="create-blueprint-title"
    >
      <h2 id="create-blueprint-title" className="mb-4 text-xl font-bold text-text-default">
        Create Course Blueprint
      </h2>

      <div className="space-y-4">
        <FormField label="Blueprint Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Grade 11 Computer Science" />
        </FormField>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Computer Science" />
          </FormField>
          <FormField label="Grade Level">
            <Input value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="Grade 11" />
          </FormField>
          <FormField label="Course Code">
            <Input value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="ICS3U" />
          </FormField>
          <FormField label="Term Template">
            <Input value={termTemplate} onChange={(e) => setTermTemplate(e.target.value)} placeholder="Semester 1" />
          </FormField>
        </div>

        {error ? (
          <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
        ) : null}
      </div>

      <div className="mt-6 flex gap-3">
        <Button type="button" variant="secondary" onClick={handleClose} className="flex-1" disabled={loading}>
          Cancel
        </Button>
        <Button type="button" onClick={handleCreate} className="flex-1" disabled={loading || !title.trim()}>
          {loading ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </DialogPanel>
  )
}
