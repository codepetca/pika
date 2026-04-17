import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import Link from 'next/link'
import { PikaLogo } from '@/components/PikaLogo'

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
    <div className="min-h-screen bg-page">
      <nav className="bg-surface shadow-sm border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href="/classrooms" className="flex items-center">
                <PikaLogo className="h-10 w-10" />
              </Link>
              <Link
                href="/classrooms"
                className="text-text-muted hover:text-text-default"
              >
                Classrooms
              </Link>
              <Link
                href="/teacher/blueprints"
                className="text-text-muted hover:text-text-default"
              >
                Blueprints
              </Link>
              <Link
                href="/teacher/calendar"
                className="text-text-muted hover:text-text-default"
              >
                Calendar
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
              <span className="hidden text-sm text-text-muted sm:inline">{user.email}</span>
              <Link
                href="/logout"
                className="text-sm text-danger hover:text-danger-hover"
              >
                Logout
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 pt-0 pb-8">
        {children}
      </main>
    </div>
  )
}
