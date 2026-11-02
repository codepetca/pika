'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, PageContent, PageLayout, PageState } from '@/ui'

export type ClassroomAdmissionOfferState = 'ready' | 'pending' | 'error'

/** Shared with the deterministic Pattern Lab fixture. */
export function ClassroomAdmissionOfferStateView({ state, onContinue }: {
  state: ClassroomAdmissionOfferState
  onContinue: () => void
}) {
  return (
    <PageState
      compact
      kind={state === 'error' ? 'error' : 'empty'}
      title={state === 'error' ? 'Could not update classroom access' : 'Updated classrooms are available'}
      description={state === 'error' ? 'Try again to continue to your classrooms.' : 'Continue to use your updated classroom experience.'}
      action={<Button type="button" variant="secondary" loading={state === 'pending'} onClick={onContinue}>{state === 'error' ? 'Try again' : 'Continue'}</Button>}
    />
  )
}

export function ClassroomAdmissionOffer({ density }: { density: 'teacher' | 'student' }) {
  const [state, setState] = useState<ClassroomAdmissionOfferState>('ready')
  const running = useRef(false)
  const router = useRouter()

  async function onContinue() {
    if (running.current) return
    running.current = true
    setState('pending')
    try {
      const response = await fetch('/api/classrooms/admission/ensure', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      const data: unknown = await response.json()
      if (!response.ok || !data || typeof data !== 'object' || !('outcome' in data)
        || (data.outcome !== 'admitted' && data.outcome !== 'already_admitted')) throw new Error('Unavailable')
      router.refresh()
      setState('ready')
      running.current = false
    } catch {
      setState('error')
      running.current = false
    }
  }

  return <PageLayout density={density} width="reading"><PageContent><ClassroomAdmissionOfferStateView state={state} onContinue={onContinue} /></PageContent></PageLayout>
}

export function ClassroomAdmissionOfferUnavailable({ density }: { density: 'teacher' | 'student' }) {
  return <PageLayout density={density} width="reading"><PageContent><PageState compact kind="error" title="Updated classrooms are temporarily unavailable" description="Your classroom access has not changed." /></PageContent></PageLayout>
}
