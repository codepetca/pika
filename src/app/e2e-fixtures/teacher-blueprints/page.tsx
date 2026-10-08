import { notFound } from 'next/navigation'
import TeacherBlueprintsPage from '@/app/teacher/blueprints/page'
import { AppMessageProvider, PageDensityProvider } from '@/ui'

export const dynamic = 'force-dynamic'

/** Production Blueprint owner; browser verification supplies intercepted read data. */
export default function TeacherBlueprintsFixturePage() {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  return <main className="min-h-screen bg-page p-4 text-text-default">
    <PageDensityProvider density="teacher"><AppMessageProvider><TeacherBlueprintsPage /></AppMessageProvider></PageDensityProvider>
  </main>
}
