'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

function CreatePasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [email] = useState(emailFromUrl)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/create-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create password')
      }

      // Redirect based on user role
      router.push(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Create Your Password
        </h1>
        <p className="text-gray-600 mb-6">
          Choose a secure password for your account
        </p>

        <form onSubmit={handleSubmit}>
          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Confirm Password"
            type="password"
            placeholder="Re-enter your password"
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            required
            disabled={loading}
            error={error}
          />

          <div className="mt-4 text-sm text-gray-600">
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
    <Suspense fallback={<div>Loading...</div>}>
      <CreatePasswordForm />
    </Suspense>
  )
}
