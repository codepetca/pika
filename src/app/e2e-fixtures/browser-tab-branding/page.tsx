import { notFound } from 'next/navigation'
import { BrowserTabBrandingFixture } from './preview'

export const dynamic = 'force-dynamic'

export default async function BrowserTabBrandingFixturePage({ searchParams }: {
  searchParams: Promise<{ userRole?: string }>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const { userRole } = await searchParams
  return <BrowserTabBrandingFixture userRole={userRole === 'student' ? 'student' : 'teacher'} />
}
