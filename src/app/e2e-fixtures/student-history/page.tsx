import { notFound } from 'next/navigation'
import HistoryPage from '@/app/student/history/page'

export const dynamic = 'force-dynamic'

export default function StudentHistoryFixturePage() {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return <main className="min-h-screen bg-page p-4 sm:p-8"><HistoryPage /></main>
}
