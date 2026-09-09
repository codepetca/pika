import { Suspense } from 'react'
import { LoginClient } from './LoginClient'
import { Spinner } from '@/components/Spinner'
import { isWorkOSMagicAuthPilotEnabled, safePikaPath } from '@/lib/server/workos-pilot'
import { hasActivePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { withAuth } from '@workos-inc/authkit-nextjs'

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const magicAuthEnabled = isWorkOSMagicAuthPilotEnabled()
  const requestedNext = (await searchParams).next
  const nextPath = safePikaPath(typeof requestedNext === 'string' ? requestedNext : undefined)
  const [hasPendingChallenge, hasActiveWorkOSSession] = magicAuthEnabled
    ? await Promise.all([
        hasActivePendingWorkOSMagicAuth('sign-in', Date.now(), nextPath),
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
