import { notFound } from 'next/navigation'
import { ClosingFixture } from './ClosingFixture'

export const dynamic = 'force-dynamic'

export default async function ClosingFixturePage({ searchParams }: {
  searchParams?: Promise<{ role?: string }>
}) {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const params = await searchParams
  return <ClosingFixture role={params?.role === 'student' ? 'student' : 'teacher'} />
}
