'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'

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
  const [reseeding, setReseeding] = useState(false)
  const isDev = process.env.NODE_ENV === 'development'

  function fillCredentials(creds: { email: string; password: string }) {
    setEmail(creds.email)
    setPassword(creds.password)
  }

  async function handleReseed() {
    if (!confirm('This will wipe and reseed the database. Continue?')) return
    setReseeding(true)
    try {
      const response = await fetch('/api/dev/reseed', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Reseed failed')
      alert('Database reseeded successfully!')
    } catch (err: any) {
      alert(`Reseed failed: ${err.message}`)
    } finally {
      setReseeding(false)
    }
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Login to Pika
        </h1>

        {isDev && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-3">
              Dev Quick Login
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.teacher)}
                className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900"
              >
                Teacher
              </button>
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.student1)}
                className="px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900"
              >
                Student 1
              </button>
              <button
                type="button"
                onClick={() => fillCredentials(DEV_CREDENTIALS.student2)}
                className="px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-900"
              >
                Student 2
              </button>
              <button
                type="button"
                onClick={handleReseed}
                disabled={reseeding}
                className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50"
              >
                {reseeding ? 'Reseeding...' : 'Reseed DB'}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Input
            label="School Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="mb-4"
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            error={error}
          />

          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => router.push('/forgot-password')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Don&apos;t have an account?{' '}
            <button
              onClick={() => router.push(`/signup${email ? `?email=${encodeURIComponent(email)}` : ''}`)}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

