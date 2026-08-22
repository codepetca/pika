'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/ui'

export default function LogoutPage() {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.requestSubmit()
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form ref={formRef} action="/api/auth/workos/logout" method="post">
        <p role="status" aria-live="polite" className="mb-4 text-sm text-text-muted">
          Signing you out…
        </p>
        <Button type="submit" size="sm">
          Continue signing out
        </Button>
      </form>
    </main>
  )
}
