import { notFound } from 'next/navigation'
import CalendarPage from '@/app/teacher/calendar/page'
import { AppMessageProvider, PageDensityProvider } from '@/ui'

export const dynamic = 'force-dynamic'

/** Production calendar owner; browser verification supplies intercepted read data. */
export default function TeacherCalendarFixturePage() {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  return <main className="min-h-screen bg-page p-4 text-text-default">
    <PageDensityProvider density="teacher"><AppMessageProvider><CalendarPage /></AppMessageProvider></PageDensityProvider>
  </main>
}
