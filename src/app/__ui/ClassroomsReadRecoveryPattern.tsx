'use client'

import { useRef, useState } from 'react'
import { ClassroomsReadRecoveryState } from '@/app/classrooms/ClassroomsReadError'
import { Button, PageContent, PageLayout, PageState } from '@/ui'

/** Controlled production error composition; no network requests or classroom mutations. */
export function ClassroomsReadRecoveryPattern({ role }: { role: 'teacher' | 'student' }) {
  const [state, setState] = useState<'error' | 'pending' | 'recovered'>('error')
  const [retainedList, setRetainedList] = useState(false)
  const region = useRef<HTMLDivElement>(null)

  return (
    <section id="classrooms-read-recovery" data-testid="pattern-section-classrooms-read-recovery" className="scroll-mt-28">
      <h2 className="text-lg font-semibold">Classroom first-read recovery</h2>
      <p className="mt-2 text-sm text-text-muted">
        Existing pattern reuse. Controlled {role} fixture of the production error composition,
        outside the historical snapshot contract. Server retry and retained index state are verified separately in unit tests.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => {
          setRetainedList(false)
          setState('error')
        }}>Show read failure</Button>
        <Button variant="secondary" aria-pressed={retainedList} onClick={() => {
          setRetainedList(!retainedList)
          setState('error')
        }}>Show retained-list recovery</Button>
        <Button variant="secondary" disabled={state !== 'pending'} onClick={() => {
          setState('recovered')
          region.current?.focus()
        }}>Complete controlled recovery</Button>
      </div>
      <PageLayout density={role} width="reading">
        <div ref={region} role="region" aria-label="Classroom recovery example" tabIndex={-1}>
          <PageContent>
            {state === 'recovered' ? (
              <PageState kind="empty" title="Classrooms loaded" description="Controlled successful zero-result fixture." />
            ) : (
              <ClassroomsReadRecoveryState compact={retainedList} pending={state === 'pending'} onRetry={() => setState('pending')} />
            )}
            {retainedList && state !== 'recovered' ? (
              <ul aria-label="Controlled retained classroom list" className="mt-3 text-sm text-text-default">
                <li>Retained classroom — controlled fixture</li>
              </ul>
            ) : null}
          </PageContent>
        </div>
      </PageLayout>
    </section>
  )
}
