import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { AppNavigation, type AppNavigationItem } from '@/components/AppNavigation'
import { AppShell } from '@/components/AppShell'

const studentNavigationItems: AppNavigationItem[] = [
  { href: '/classrooms', label: 'Classrooms' },
  { href: '/student/history', label: 'History', match: 'prefix' },
]

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  if (user.role !== 'student') {
    redirect('/teacher/dashboard')
  }

  return (
    <AppShell
      user={{ email: user.email, role: user.role }}
      mainClassName="max-w-4xl mx-auto px-4 py-8"
      navigation={
        <AppNavigation
          label="Student tools"
          items={studentNavigationItems}
          width="reading"
        />
      }
    >
      {children}
    </AppShell>
  )
}
