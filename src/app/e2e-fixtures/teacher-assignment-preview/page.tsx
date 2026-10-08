import { notFound } from 'next/navigation'
import { TeacherAssignmentPreviewFixture } from './preview'

export default function TeacherAssignmentPreviewPage() {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') {
    notFound()
  }

  return <TeacherAssignmentPreviewFixture />
}
