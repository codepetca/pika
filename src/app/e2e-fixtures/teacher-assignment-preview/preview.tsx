'use client'

import { useCallback, useEffect, useState } from 'react'
import { AssignmentModal } from '@/components/AssignmentModal'
import { Button, PageDensityProvider } from '@/ui'
import type { Assignment } from '@/types'

const assignment: Assignment = {
  id: '30000000-0000-4000-8000-000000000081',
  classroom_id: '30000000-0000-4000-8000-000000000082',
  title: 'Field observations',
  description: 'Read the field guide.\n\nBring one observation and one question to discuss.',
  instructions_markdown: 'Read the field guide.\n\nBring one observation and one question to discuss.',
  rich_instructions: null,
  due_at: '2026-11-01T04:59:59.000Z',
  position: 0,
  released_at: null,
  is_draft: true,
  track_authenticity: true,
  created_by: '30000000-0000-4000-8000-000000000083',
  created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
}

/** Browser tests intercept all API traffic; this fixture uses the real editor owner. */
export function TeacherAssignmentPreviewFixture() {
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<Assignment | null>(assignment)
  const [publications, setPublications] = useState(0)

  const closeOwner = useCallback(() => {
    setOpen(false)
    setRecord(null)
  }, [])

  // Deterministic external parent transitions; native drags/menus stay real.
  useEffect(() => {
    const close = () => closeOwner()
    const savedRequirements = () => setRecord({
      ...assignment,
      submission_requirements: [
        { id: 'fixture-saved-link-one', assignment_id: assignment.id, type: 'link', label: 'Saved link one', instructions: '', required: true, position: 0, validation_policy_json: {}, created_at: assignment.created_at, updated_at: assignment.updated_at },
        { id: 'fixture-saved-link-two', assignment_id: assignment.id, type: 'link', label: 'Saved link two', instructions: '', required: true, position: 1, validation_policy_json: {}, created_at: assignment.created_at, updated_at: assignment.updated_at },
      ],
    })
    window.addEventListener('pika-assignment-fixture-close', close)
    window.addEventListener('pika-assignment-fixture-requirements', savedRequirements)
    return () => {
      window.removeEventListener('pika-assignment-fixture-close', close)
      window.removeEventListener('pika-assignment-fixture-requirements', savedRequirements)
    }
  }, [closeOwner])

  return (
    <PageDensityProvider density="teacher">
      <main className="min-h-screen bg-page p-4 text-text-default">
        <h1 className="text-xl font-semibold">Assignment preview fixture</h1>
        <Button className="mt-4" onClick={() => { setRecord(assignment); setOpen(true) }}>Edit fixture assignment</Button>
        <output className="sr-only" data-testid="fixture-publications">{publications}</output>
        <AssignmentModal
          isOpen={open}
          classroomId={assignment.classroom_id}
          assignment={record}
          onClose={closeOwner}
          onSuccess={(_published, options) => {
            setPublications((value) => value + 1)
            if (options?.closeModal !== false) closeOwner()
          }}
        />
      </main>
    </PageDensityProvider>
  )
}
