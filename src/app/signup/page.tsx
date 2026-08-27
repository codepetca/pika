import { Suspense } from 'react'
import { SignupClient } from './SignupClient'
import {
  isLegacyPasswordAuthEnabled,
  shouldUseWorkOSAuthKit,
} from '@/lib/auth-mode'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'

export default async function SignupPage() {
  const legacyPasswordAuthEnabled = isLegacyPasswordAuthEnabled()
  const hasPendingChallenge = shouldUseWorkOSAuthKit()
    ? await hasActivePendingWorkOSMagicAuth('sign-up')
    : false

  return (
    <Suspense fallback={null}>
      <SignupClient
        legacyPasswordAuthEnabled={legacyPasswordAuthEnabled}
        hasPendingMagicAuthChallenge={hasPendingChallenge}
      />
    </Suspense>
  )
}
