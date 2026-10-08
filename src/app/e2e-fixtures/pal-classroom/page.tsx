import { notFound } from 'next/navigation'
import { PalClassroomFixture } from './preview'

export const dynamic = 'force-dynamic'

export default async function PalClassroomFixturePage({ searchParams }: {
  searchParams?: Promise<{ recovery?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const query = await searchParams
  return <PalClassroomFixture recoveryEnabled={query?.recovery === 'true'} />
}
