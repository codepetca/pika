import { notFound } from 'next/navigation'
import { TestEditingPolicyFixture } from './preview'
export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  return <TestEditingPolicyFixture />
}
