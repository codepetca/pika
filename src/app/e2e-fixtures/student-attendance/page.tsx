import { notFound } from 'next/navigation'

import { StudentAttendanceStatus } from '@/components/StudentAttendanceStatus'

export const dynamic = 'force-dynamic'

const classroomId = '30000000-0000-4000-8000-000000000001'

export default function StudentAttendanceFixturePage() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return (
    <main className="min-h-screen bg-canvas p-4 sm:p-8">
      <div className="mx-auto max-w-xl space-y-6">
        <section className="space-y-2">
          <h1 className="text-lg font-semibold text-text-default">Open attendance</h1>
          <StudentAttendanceStatus
            state={{
              classroomId,
              state: 'open',
              opensAt: '2026-08-28T12:50:00.000Z',
              closesAt: '2026-08-28T13:50:00.000Z',
            }}
            now={new Date('2026-08-28T13:20:00.000Z')}
            variant="banner"
          />
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-text-default">Accepted check-in</h2>
          <StudentAttendanceStatus
            state={{
              classroomId,
              state: 'confirmed',
              opensAt: '2026-08-28T12:50:00.000Z',
              closesAt: '2026-08-28T13:50:00.000Z',
              attendanceStatus: 'late',
              confirmedAt: '2026-08-28T13:07:00.000Z',
              validUntil: '2026-08-29T04:00:00.000Z',
            }}
            now={new Date('2026-08-28T13:20:00.000Z')}
            variant="banner"
          />
        </section>
      </div>
    </main>
  )
}
