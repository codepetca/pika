'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
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

      setSuccess(true)
      // Redirect to reset password page after 2 seconds
      setTimeout(() => {
        router.push(`/reset-password?email=${encodeURIComponent(email)}`)
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
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
          <div className="bg-success-bg border border-success text-text-default px-4 py-3 rounded-lg">
            <p className="font-medium">Check your email!</p>
            <p className="text-sm mt-1">
              If an account exists with this email, you will receive password reset instructions.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <FormField label="School Email" error={error} required>
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
              type="submit"
              className="w-full mt-6"
              disabled={loading || !email}
            >
              {loading ? 'Sending...' : 'Send Reset Code'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push('/login')}
            className="text-sm text-primary hover:underline"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  )
}
