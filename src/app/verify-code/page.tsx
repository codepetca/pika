'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

function VerifyCodeForm() {
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
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code')
      }

      // Redirect based on user role
      router.push(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Verify Code
        </h1>
        <p className="text-gray-600 mb-6">
          Enter the code sent to your email
        </p>

        <form onSubmit={handleSubmit}>
          <Input
            label="Email"
            type="email"
            placeholder="you@school.ca"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Code"
            type="text"
            placeholder="Enter 8-character code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            disabled={loading}
            maxLength={8}
            error={error}
          />

          <Button
            type="submit"
            className="w-full mt-6"
            disabled={loading || !email || !code}
          >
            {loading ? 'Verifying...' : 'Verify & Login'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => router.push('/login')}
            className="text-sm text-blue-600 hover:underline"
          >
            Request a new code
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VerifyCodePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyCodeForm />
    </Suspense>
  )
}
