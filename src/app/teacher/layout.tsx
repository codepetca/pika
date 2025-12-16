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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <Image src="/pika_silhouette.png" alt="Pika" width={40} height={40} className="object-contain" />
              <Link
                href="/classrooms"
                className="text-gray-700 hover:text-gray-900"
              >
                Classrooms
              </Link>
              <Link
                href="/teacher/calendar"
                className="text-gray-700 hover:text-gray-900"
              >
                Calendar
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.email}</span>
              <Link
                href="/logout"
                className="text-sm text-red-600 hover:text-red-700"
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
