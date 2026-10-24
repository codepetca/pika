import { notFound } from 'next/navigation'
import { ClassroomHomeFixture } from './preview'

export const dynamic = 'force-dynamic'
export default async function ClassroomHomeFixturePage({ searchParams }: {
  searchParams: Promise<{ role?: string; state?: string; creation?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const params = await searchParams
  return <ClassroomHomeFixture role={params.role === 'student' ? 'student' : 'teacher'}
    state={params.state} canCreate={params.creation !== 'disabled'} />
}
