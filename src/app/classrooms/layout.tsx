import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getServerLoginRedirectPath } from '@/lib/server/auth-redirect'
import { StudentPalExperience } from '@/integrations/pal'
import { getPalApiUrl } from '@/lib/server/pal-config'

/**
 * Minimal layout for classrooms - just handles auth check.
 * AppShell component (used in child pages) provides the header and layout.
 */
export default async function ClassroomsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect(getServerLoginRedirectPath())
  }

  const palApiUrl = user.role === 'student' ? getPalApiUrl() : null

  if (palApiUrl) {
    return (
      <StudentPalExperience apiBaseUrl={palApiUrl} scopeKey={randomUUID()}>
        {children}
      </StudentPalExperience>
    )
  }

  return <>{children}</>
}
