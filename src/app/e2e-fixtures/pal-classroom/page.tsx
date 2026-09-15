import { notFound } from 'next/navigation'
import { PalClassroomFixture } from './preview'

export const dynamic = 'force-dynamic'

export default function PalClassroomFixturePage() {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  return <PalClassroomFixture />
}
