import { notFound } from 'next/navigation'
import { TestReferenceImagesFixture } from './preview'

export const dynamic = 'force-dynamic'

export default function TestReferenceImagesFixturePage() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return <TestReferenceImagesFixture />
}
