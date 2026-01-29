'use client'

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'

export default function JoinPage() {
  const router = useRouter()
  const joinCodeId = useId()
  const [code, setCode] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return
    router.push(`/join/${encodeURIComponent(trimmed)}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-text-default">Join a classroom</h1>
        <p className="text-text-muted mt-2">
          Enter the join code your teacher gave you.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          <label htmlFor={joinCodeId} className="block text-sm font-medium text-text-muted">
            Join code
          </label>
          <input
            id={joinCodeId}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="mt-2 w-full px-3 py-2 border border-border-strong bg-surface text-text-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />

          <button
            type="submit"
            className="w-full px-4 py-2 rounded-md bg-primary text-text-inverse text-sm hover:bg-primary-hover disabled:opacity-50"
            disabled={!code.trim()}
          >
            Join
          </button>
        </form>
      </div>
    </div>
  )
}

