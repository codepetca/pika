import { notFound } from 'next/navigation'
import { StudentTestAttemptPattern } from '@/app/__ui/StudentTestAttemptPattern'

export default function Page() {
  if (process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  return <main className="min-h-screen bg-page p-4 text-text-default"><StudentTestAttemptPattern interactive /></main>
}
