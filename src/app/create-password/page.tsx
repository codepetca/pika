'use client'

import { useEffect, useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppMessageFallback, Input, Button, FormField } from '@/ui'

const SIGNUP_HANDOFF_TOKEN_STORAGE_KEY = 'pika.signupHandoffToken'

function CreatePasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [email] = useState(emailFromUrl)
  const [handoffToken, setHandoffToken] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(SIGNUP_HANDOFF_TOKEN_STORAGE_KEY)
      if (!stored) return

      const parsed = JSON.parse(stored) as { email?: string; token?: string }
      if (parsed.email === email && parsed.token) {
        setHandoffToken(parsed.token)
      }
    } catch {
      window.sessionStorage.removeItem(SIGNUP_HANDOFF_TOKEN_STORAGE_KEY)
    }
  }, [email])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/create-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation, handoffToken }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create password')
      }

      window.sessionStorage.removeItem(SIGNUP_HANDOFF_TOKEN_STORAGE_KEY)
      router.push(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-2">
          Create Your Password
        </h1>
        <p className="text-text-muted mb-6">
          Choose a secure password for your account
        </p>

        <form onSubmit={handleSubmit}>
          <FormField label="Password" required className="mb-4">
            <Input
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </FormField>

          <FormField label="Confirm Password" error={error} required>
            <Input
              type="password"
              placeholder="Re-enter your password"
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
              required
              disabled={loading}
            />
          </FormField>

          <div className="mt-4 text-sm text-text-muted">
            <p>Password must be:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>At least 8 characters long</li>
            </ul>
          </div>

          <Button
            type="submit"
            className="w-full mt-6"
            disabled={loading || !password || !passwordConfirmation}
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default function CreatePasswordPage() {
  return (
    <Suspense fallback={<AppMessageFallback />}>
      <CreatePasswordForm />
    </Suspense>
  )
}
