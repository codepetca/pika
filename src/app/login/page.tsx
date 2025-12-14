import { Suspense } from 'react'
import { LoginClient } from './LoginClient'
import { Spinner } from '@/components/Spinner'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  )
}
