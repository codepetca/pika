import { Suspense } from 'react'
import { LoginClient } from './LoginClient'
import { Spinner } from '@/components/Spinner'
import {
  isLegacyPasswordAuthEnabled,
  shouldUseWorkOSAuthKit,
} from '@/lib/auth-mode'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { withAuth } from '@workos-inc/authkit-nextjs'

export default async function LoginPage() {
  const legacyPasswordAuthEnabled = isLegacyPasswordAuthEnabled()
  const workOSAuthKitConfigured = shouldUseWorkOSAuthKit()
  const [hasPendingChallenge, hasActiveWorkOSSession] = workOSAuthKitConfigured
    ? await Promise.all([
        hasActivePendingWorkOSMagicAuth('sign-in'),
        withAuth().then(({ user }) => Boolean(user?.emailVerified)),
      ])
    : [false, false]

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginClient
        legacyPasswordAuthEnabled={legacyPasswordAuthEnabled}
        hasPendingMagicAuthChallenge={hasPendingChallenge}
        hasActiveWorkOSSession={hasActiveWorkOSSession}
      />
    </Suspense>
  )
}
