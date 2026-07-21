import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { AppNavigation, type AppNavigationItem } from '@/components/AppNavigation'
import { AppShell } from '@/components/AppShell'

const teacherNavigationItems: AppNavigationItem[] = [
  { href: '/classrooms', label: 'Classrooms' },
  { href: '/teacher/blueprints', label: 'Blueprints', match: 'prefix' },
  { href: '/teacher/calendar', label: 'Calendar', match: 'prefix' },
]

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  if (user.role !== 'teacher') {
    redirect('/classrooms')
  }

  return (
    <AppShell
      user={{ email: user.email, role: user.role }}
      mainClassName="min-h-0 w-full"
      navigation={
        <AppNavigation
          label="Teacher tools"
          items={teacherNavigationItems}
        />
      }
    >
      {children}
    </AppShell>
  )
}
