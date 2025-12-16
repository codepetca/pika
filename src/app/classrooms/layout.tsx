import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

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
    redirect('/login')
  }

  return <>{children}</>
}
