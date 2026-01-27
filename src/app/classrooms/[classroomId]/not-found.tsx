import Link from 'next/link'
import { AppShell } from '@/components/AppShell'

export default function ClassroomNotFound() {
  return (
    <AppShell showHeader={false}>
      <div className="max-w-md mx-auto mt-12">
        <div className="bg-surface rounded-lg shadow-sm border border-border p-8 text-center">
          <p className="text-danger mb-4">Classroom not found or you don&apos;t have access.</p>
          <Link href="/classrooms" className="text-primary hover:text-primary-hover">
            Back to classrooms
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
