'use client'

import { useEffect, useRef, useState } from 'react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { Button, Card } from '@/ui'

const INITIAL_OWNER = { mounted: true, open: false, blueprintId: null as string | null }

// Explicit E2E mode only. Verification intercepts every API request before the
// real wizard opens; this fixture supplies no persistence transport.
export function CreateClassroomControllerPattern() {
  const sectionRef = useRef<HTMLElement>(null)
  const [owner, setOwner] = useState(INITIAL_OWNER)
  const [receipt, setReceipt] = useState('Controlled classroom wizard; API requests require browser interception.')

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const driveOwner = (event: Event) => {
      const command: unknown = (event as CustomEvent<unknown>).detail
      setOwner(current => {
        switch (command) {
          case 'close': return { ...current, open: false }
          case 'reopen': return { ...INITIAL_OWNER, open: true }
          case 'replace-A': return { ...current, blueprintId: 'blueprint-controller-A' }
          case 'replace-B': return { ...current, blueprintId: 'blueprint-controller-B' }
          case 'unmount': return { ...current, mounted: false, open: false }
          default: return current
        }
      })
    }
    section.addEventListener('classroom-fixture-owner', driveOwner)
    return () => section.removeEventListener('classroom-fixture-owner', driveOwner)
  }, [])

  return (
    <section id="create-classroom-controller" ref={sectionRef} data-testid="create-classroom-controller-fixture">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Create Classroom controller fixture</h3>
        <Button variant="surface" className="mt-3" onClick={() => setOwner({ ...INITIAL_OWNER, open: true })}>
          Open controlled classroom
        </Button>
        <p role="status" className="mt-2 text-xs text-text-muted">{receipt}</p>
      </Card>
      {owner.mounted && <CreateClassroomModal
        isOpen={owner.open} initialBlueprintId={owner.blueprintId}
        onClose={() => {
          setOwner(current => ({ ...current, open: false }))
          setReceipt('Controller closed.')
        }}
        onSuccess={() => setReceipt('Unexpected creation callback.')}
        onBlueprintCreated={() => setReceipt('Unexpected blueprint callback.')}
      />}
    </section>
  )
}
