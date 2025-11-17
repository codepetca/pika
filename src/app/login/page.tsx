'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

export default function LoginPage() {
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
      const response = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send code')
      }

      setSuccess(true)
      // Redirect to verify page after 1 second
      setTimeout(() => {
        router.push(`/verify-code?email=${encodeURIComponent(email)}`)
      }, 1000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Login
        </h1>
        <p className="text-gray-600 mb-6">
          Enter your email to receive a login code
        </p>

        {success ? (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
            Code sent! Redirecting to verification...
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              placeholder="you@school.ca"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              error={error}
            />

            <Button
              type="submit"
              className="w-full mt-6"
              disabled={loading || !email}
            >
              {loading ? 'Sending...' : 'Send Login Code'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
