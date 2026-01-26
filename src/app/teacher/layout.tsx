import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import Link from 'next/link'
import Image from 'next/image'

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
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <Image src="/pika_silhouette.png" alt="Pika" width={40} height={40} className="object-contain" />
              <Link
                href="/classrooms"
                className="text-text-muted hover:text-text-default"
              >
                Classrooms
              </Link>
              <Link
                href="/teacher/calendar"
                className="text-text-muted hover:text-text-default"
              >
                Calendar
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-text-muted">{user.email}</span>
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
      <main className="max-w-7xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  )
}
