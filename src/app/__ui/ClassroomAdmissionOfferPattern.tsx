'use client'

import { useState } from 'react'
import { ClassroomAdmissionOfferStateView, type ClassroomAdmissionOfferState } from '@/app/classrooms/ClassroomAdmissionOffer'
import { Button, PageContent, PageLayout } from '@/ui'

/** Deterministic fixture: it never invokes the production admission endpoint. */
export function ClassroomAdmissionOfferPattern({ role }: { role: 'teacher' | 'student' }) {
  const [state, setState] = useState<ClassroomAdmissionOfferState>('ready')
  return <section id="classroom-admission-offer" data-testid="pattern-section-classroom-admission-offer" className="scroll-mt-28">
    <h2 className="text-lg font-semibold">Classroom access recovery</h2>
    <div className="mt-3 flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setState('ready')}>Show ready</Button>
      <Button variant="secondary" onClick={() => setState('pending')}>Show pending</Button>
      <Button variant="secondary" onClick={() => setState('error')}>Show error</Button>
    </div>
    <PageLayout density={role} width="reading"><PageContent>
      <ClassroomAdmissionOfferStateView state={state} onContinue={() => setState('pending')} />
    </PageContent></PageLayout>
  </section>
}
