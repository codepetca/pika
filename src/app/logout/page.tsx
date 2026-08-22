'use client'

import { useEffect, useRef } from 'react'

export default function LogoutPage() {
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.requestSubmit()
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form ref={formRef} action="/api/auth/workos/logout" method="post">
        <p role="status" aria-live="polite" className="mb-4 text-sm text-gray-700">
          Signing you out…
        </p>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          Continue signing out
        </button>
      </form>
    </main>
  )
}
