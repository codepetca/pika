'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'

function VerifySignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [email, setEmail] = useState(emailFromUrl)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendSuccess, setResendSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/verify-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code')
      }

      // Redirect to create password page
      router.push(`/create-password?email=${encodeURIComponent(email)}`)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  async function handleResendCode() {
    try {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setResendSuccess(true)
      // Hide success message after 3 seconds
      setTimeout(() => setResendSuccess(false), 3000)
    } catch (err) {
      setError('Failed to resend code')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-2">
          Verify Your Email
        </h1>
        <p className="text-text-muted mb-6">
          Enter the 5-character code sent to your email
        </p>

        <form onSubmit={handleSubmit}>
          <FormField label="School Email" required className="mb-4">
            <Input
              type="email"
              placeholder="number@gapps.yrdsb.ca"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </FormField>

          <FormField label="Verification Code" error={error} required>
            <Input
              type="text"
              placeholder="A7Q2F"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              disabled={loading}
              maxLength={5}
            />
          </FormField>

          <Button
            type="submit"
            className="w-full mt-6"
            disabled={loading || !email || code.length !== 5}
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </Button>
        </form>

        {resendSuccess && (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
            New verification code sent!
          </div>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={handleResendCode}
            className="text-sm text-primary hover:underline"
          >
            Resend verification code
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VerifySignupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifySignupForm />
    </Suspense>
  )
}
