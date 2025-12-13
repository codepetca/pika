'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function JoinPage() {
  const router = useRouter()
  const [code, setCode] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = code.trim()
    if (!trimmed) return
    router.push(`/join/${encodeURIComponent(trimmed)}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">Join a classroom</h1>
        <p className="text-gray-600 mt-2">
          Enter the join code your teacher gave you.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          <label className="block text-sm font-medium text-gray-700">
            Join code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          <button
            type="submit"
            className="w-full px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            disabled={!code.trim()}
          >
            Join
          </button>
        </form>
      </div>
    </div>
  )
}

