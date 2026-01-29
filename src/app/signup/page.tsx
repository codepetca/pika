'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Pre-fill email from URL parameter if provided
  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setEmail(emailParam)
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code')
      }

      setSuccess(true)
      // Redirect to verify page after 1 second
      setTimeout(() => {
        router.push(`/verify-signup?email=${encodeURIComponent(email)}`)
      }, 1000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-2">
          Sign Up for Pika
        </h1>
        <p className="text-text-muted mb-6">
          Enter your email to create an account. We&apos;ll send you a verification code.
        </p>

        {success ? (
          <div className="bg-success-bg border border-success text-text-default px-4 py-3 rounded-lg">
            Verification code sent! Redirecting...
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <FormField label="School Email" error={error} required>
              <Input
                type="email"
                placeholder="email@gapps.yrdsb.ca"
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
              {loading ? 'Sending...' : 'Send Verification Code'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-text-muted">
            Already have an account?{' '}
            <button
              onClick={() => router.push('/login')}
              className="text-primary hover:underline font-medium"
            >
              Login
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
