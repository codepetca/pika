import { Suspense } from 'react'
import { LoginClient } from './LoginClient'
import { Spinner } from '@/components/Spinner'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { withAuth } from '@workos-inc/authkit-nextjs'

export default async function LoginPage() {
  const magicAuthEnabled = isWorkOSMagicAuthPilotEnabled()
  const [hasPendingChallenge, hasActiveWorkOSSession] = magicAuthEnabled
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
        magicAuthEnabled={magicAuthEnabled}
        hasPendingMagicAuthChallenge={hasPendingChallenge}
        hasActiveWorkOSSession={hasActiveWorkOSSession}
      />
    </Suspense>
  )
}
