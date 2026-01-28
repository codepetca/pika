'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'

function isSafeNextPath(next: string): boolean {
  if (!next.startsWith('/')) return false
  if (next.startsWith('//')) return false
  return true
}

const DEV_CREDENTIALS = {
  teacher: { email: 'teacher@example.com', password: 'test1234' },
  student1: { email: 'student1@example.com', password: 'test1234' },
  student2: { email: 'student2@example.com', password: 'test1234' },
}

export function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isDev = process.env.NODE_ENV === 'development'

  function fillCredentials(creds: { email: string; password: string }) {
    setEmail(creds.email)
    setPassword(creds.password)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Login failed')
      }

      const next = searchParams.get('next')
      if (next && isSafeNextPath(next)) {
        router.push(next)
        return
      }

      router.push(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-6">
          Login to Pika
        </h1>

        {isDev && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm font-medium text-yellow-800 mb-3">
              Dev Quick Login
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.teacher)}
                className="px-3 py-1.5 text-sm bg-info-bg text-primary rounded hover:bg-surface-hover"
              >
                Teacher
              </button>
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.student1)}
                className="px-3 py-1.5 text-sm bg-success-bg text-success rounded hover:bg-surface-hover"
              >
                Student 1
              </button>
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.student2)}
                className="px-3 py-1.5 text-sm bg-success-bg text-success rounded hover:bg-surface-hover"
              >
                Student 2
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <FormField label="School Email" required className="mb-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </FormField>

          <FormField label="Password" error={error} required>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </FormField>

          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-sm text-primary hover:underline"
            >
              Forgot password?
            </button>
          </div>

          <Button
            type="submit"
            className="w-full mt-6"
            disabled={loading || !email || !password}
          >
            {loading ? 'Logging in...' : 'Login'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-text-muted">
            Don&apos;t have an account?{' '}
            <button
              onClick={() => router.push(`/signup${email ? `?email=${encodeURIComponent(email)}` : ''}`)}
              className="text-primary hover:underline font-medium"
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

