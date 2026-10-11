'use client'

import { useEffect, useRef, useState } from 'react'
import { AssignmentModal } from '@/components/AssignmentModal'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'
import { Button, Card } from '@/ui'

// The route exposes this owner only in explicit E2E fixture mode. Browser
// verification must intercept every API request before opening the modal.
const FIXTURE_ASSIGNMENT: Assignment = {
  id: 'assignment-controller-A', classroom_id: 'classroom-controller',
  title: 'Field observations', description: 'Original instructions',
  instructions_markdown: 'Original instructions', rich_instructions: null,
  due_at: toTorontoEndOfDayIso('2030-10-20'), position: 0,
  is_draft: true, released_at: null, track_authenticity: true,
  created_by: 'teacher-controller', submission_requirements: [],
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
}

export function AssignmentControllerPattern() {
  const sectionRef = useRef<HTMLElement>(null)
  const [owner, setOwner] = useState({ mounted: true, open: false, record: FIXTURE_ASSIGNMENT as Assignment | null })
  const [receipt, setReceipt] = useState('Controlled controller fixture; API requests require browser interception.')

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    // A local driver can change the parent while ModalLayer makes the rest of
    // the page inert. It never calls a publication or persistence callback.
    const driveOwner = (event: Event) => {
      const command: unknown = (event as CustomEvent<unknown>).detail
      setOwner(current => {
        switch (command) {
          case 'close': return { ...current, open: false }
          case 'reopen': return { mounted: true, open: true, record: current.record ?? FIXTURE_ASSIGNMENT }
          case 'refresh': return { ...current, record: current.record ? { ...current.record, title: 'Refreshed observations' } : null }
          case 'replace': return { ...current, record: { ...FIXTURE_ASSIGNMENT, id: 'assignment-controller-B', title: 'Another assignment' } }
          case 'live': return { ...current, record: { ...FIXTURE_ASSIGNMENT, is_draft: false } }
          case 'missing': return { ...current, open: false, record: null }
          case 'unmount': return { ...current, mounted: false, open: false }
          default: return current
        }
      })
    }
    section.addEventListener('assignment-fixture-owner', driveOwner)
    return () => section.removeEventListener('assignment-fixture-owner', driveOwner)
  }, [])

  return (
    <section id="assignment-controller" ref={sectionRef} data-testid="assignment-controller-fixture">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Assignment controller fixture</h3>
        <Button variant="surface" className="mt-3" onClick={() => {
          setOwner({ mounted: true, open: true, record: FIXTURE_ASSIGNMENT })
        }}>Open controlled assignment</Button>
        <p role="status" className="mt-2 text-xs text-text-muted">{receipt}</p>
      </Card>
      {owner.mounted && <AssignmentModal
        isOpen={owner.open}
        classroomId="classroom-controller"
        assignment={owner.record}
        onClose={() => {
          setOwner(current => ({ ...current, open: false }))
          setReceipt('Controller closed.')
        }}
        onSuccess={(record, options) => setReceipt(`Controller acknowledged ${record.id}; closeModal=${options?.closeModal !== false}.`)}
      />}
    </section>
  )
}
