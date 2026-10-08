'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'
import { usePasswordResetContinuity } from '@/hooks/usePasswordResetContinuity'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const continuity = usePasswordResetContinuity(loading)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const request = continuity.begin(e.currentTarget as HTMLFormElement)
    if (request === null) return
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset code')
      }

      if (!continuity.isCurrent(request)) return
      setSuccess(true)
      // Redirect to reset password page after 2 seconds
      continuity.continueAfter(request, () => {
        router.push(`/reset-password?email=${encodeURIComponent(email)}`)
      }, 2000)
    } catch (err: any) {
      if (!continuity.isCurrent(request)) return
      setError(err.message || 'An error occurred')
      setLoading(false)
      continuity.finish(request)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-2">
          Forgot Password
        </h1>
        <p className="text-text-muted mb-6">
          Enter your email to receive a password reset code
        </p>

        {success ? (
          <div role="status" aria-live="polite" className="bg-success-bg border border-success text-text-default px-4 py-3 rounded-lg">
            <p className="font-medium">Check your email!</p>
            <p className="text-sm mt-1">
              If an account exists with this email, you will receive password reset instructions.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <FormField label="School Email" error={error} reserveErrorSpace required>
              <Input
                type="email"
                placeholder="number@gapps.yrdsb.ca"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </FormField>

            <Button
              aria-busy={loading || undefined}
              type="submit"
              className="w-full mt-6"
              disabled={loading || !email}
            >
              {loading ? 'Sending...' : 'Send Reset Code'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => { continuity.retire(); router.push('/login') }}
          >
            Back to login
          </Button>
        </div>
      </div>
    </div>
  )
}
