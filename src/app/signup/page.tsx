import { Suspense } from 'react'
import { SignupClient } from './SignupClient'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'

export default async function SignupPage() {
  const magicAuthEnabled = isWorkOSMagicAuthPilotEnabled()
  const hasPendingChallenge = magicAuthEnabled
    ? await hasActivePendingWorkOSMagicAuth('sign-up')
    : false

  return (
    <Suspense fallback={null}>
      <SignupClient
        magicAuthEnabled={magicAuthEnabled}
        hasPendingMagicAuthChallenge={hasPendingChallenge}
      />
    </Suspense>
  )
}
