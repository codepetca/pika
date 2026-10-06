'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FormField, Input } from '@/ui'

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-text-default">Join a classroom</h1>
        <p className="text-text-muted mt-2">
          Enter the join code your teacher gave you.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          <FormField label="Join code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </FormField>

          <Button
            type="submit"
            fullWidth
            disabled={!code.trim()}
          >
            Join
          </Button>
        </form>
      </div>
    </div>
  )
}
