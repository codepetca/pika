import { Suspense } from 'react'
import { AppMessageFallback } from '@/ui'
import { SignupClient } from './SignupClient'
import { isWorkOSMagicAuthPilotEnabled, safePikaPath } from '@/lib/server/workos-pilot'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'

interface SignupPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const magicAuthEnabled = isWorkOSMagicAuthPilotEnabled()
  const requestedNext = (await searchParams).next
  const nextPath = safePikaPath(typeof requestedNext === 'string' ? requestedNext : undefined)
  const hasPendingChallenge = magicAuthEnabled
    ? await hasActivePendingWorkOSMagicAuth('sign-up', Date.now(), nextPath)
    : false

  return (
    <Suspense fallback={<AppMessageFallback />}>
      <SignupClient
        magicAuthEnabled={magicAuthEnabled}
        hasPendingMagicAuthChallenge={hasPendingChallenge}
      />
    </Suspense>
  )
}
