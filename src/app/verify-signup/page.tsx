'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

function VerifySignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [email, setEmail] = useState(emailFromUrl)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      alert('New verification code sent!')
    } catch (err) {
      alert('Failed to resend code')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Verify Your Email
        </h1>
        <p className="text-gray-600 mb-6">
          Enter the 5-character code sent to your email
        </p>

        <form onSubmit={handleSubmit}>
          <Input
            label="School Email"
            type="email"
            placeholder="number@gapps.yrdsb.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Verification Code"
            type="text"
            placeholder="A7Q2F"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            disabled={loading}
            maxLength={5}
            error={error}
          />

          <Button
            type="submit"
            className="w-full mt-6"
            disabled={loading || !email || code.length !== 5}
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={handleResendCode}
            className="text-sm text-blue-600 hover:underline"
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
