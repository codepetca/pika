'use client'

import { Button } from '@/ui'

export default function LogoutPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <form action="/api/auth/workos/logout" method="post">
        <p role="status" aria-live="polite" className="mb-4 text-sm text-text-muted">
          Ready to sign you out.
        </p>
        <Button type="submit" size="sm">
          Sign out
        </Button>
      </form>
    </main>
  )
}
