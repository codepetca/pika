'use client'

import { useEffect, useId, useRef, useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Input, Button, FormField } from '@/ui'
import { navigateTo } from '@/lib/client-navigation'
import { MagicAuthForm } from '@/components/auth/MagicAuthForm'
import { PikaLogo } from '@/components/PikaLogo'
import {
  getSafeInternalPath,
  SESSION_CHANGED_MESSAGE,
  SESSION_CHANGED_REASON,
  SESSION_EXPIRED_MESSAGE,
  SESSION_EXPIRED_REASON,
} from '@/lib/client-auth'

const DEV_CREDENTIALS = {
  teacher: { email: 'teacher@example.com', password: 'test1234' },
  student1: { email: 'student1@example.com', password: 'test1234' },
  student2: { email: 'student2@example.com', password: 'test1234' },
}

export function LoginClient({
  magicAuthEnabled = false,
  hasPendingMagicAuthChallenge = false,
  hasActiveWorkOSSession = false,
}: {
  magicAuthEnabled?: boolean
  hasPendingMagicAuthChallenge?: boolean
  hasActiveWorkOSSession?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [restoringWorkOSSession, setRestoringWorkOSSession] = useState(
    magicAuthEnabled && hasActiveWorkOSSession,
  )
  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const sessionMessageId = useId()
  const isDev = process.env.NODE_ENV === 'development'
  const sessionReason = searchParams.get('reason')
  const sessionMessage = sessionReason === SESSION_EXPIRED_REASON
    ? SESSION_EXPIRED_MESSAGE
    : sessionReason === SESSION_CHANGED_REASON
      ? SESSION_CHANGED_MESSAGE
      : null

  useEffect(() => {
    if (sessionMessage) {
      emailInputRef.current?.focus()
    }
  }, [sessionMessage])

  useEffect(() => {
    if (!restoringWorkOSSession) return

    let cancelled = false
    async function restoreSession() {
      try {
        const next = getSafeInternalPath(searchParams.get('next'))
        const response = await fetch('/api/auth/workos/session/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next ? { next } : {}),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to restore session')
        if (!cancelled) navigateTo(data.redirectUrl)
      } catch {
        if (!cancelled) setRestoringWorkOSSession(false)
      }
    }

    void restoreSession()
    return () => { cancelled = true }
  }, [restoringWorkOSSession, searchParams])

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

      const next = getSafeInternalPath(searchParams.get('next'))
      if (next) {
        navigateTo(next)
        return
      }

      navigateTo(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  if (restoringWorkOSSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-page">
        <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex-shrink-0" aria-hidden="true">
              <PikaLogo className="h-8 w-8" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-text-default">Pika Classroom</h1>
              <p className="mt-1 text-sm text-text-muted">Your school-day sidekick.</p>
            </div>
          </div>
          <p role="status" aria-live="polite" className="text-text-muted">
            Restoring your session...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <div className="mb-6 flex items-start gap-3">
          <span className="flex-shrink-0" aria-hidden="true">
            <PikaLogo className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-text-default">Pika Classroom</h1>
            <p className="mt-1 text-sm text-text-muted">Your school-day sidekick.</p>
          </div>
        </div>

        {sessionMessage ? (
          <div
            id={sessionMessageId}
            role="status"
            aria-live="polite"
            className="mb-6 rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm text-text-default"
          >
            {sessionMessage}
          </div>
        ) : null}

        {!magicAuthEnabled && isDev && (
          <div className="mb-6 p-4 bg-warning-bg border border-warning rounded-lg">
            <p className="text-sm font-medium text-text-default mb-3">
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

        {magicAuthEnabled ? (
          <MagicAuthForm
            intent="sign-in"
            hasPendingChallenge={hasPendingMagicAuthChallenge}
            nextPath={searchParams.get('next')}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <FormField label="Email address" className="mb-4">
              <Input
                ref={emailInputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={sessionMessage ? sessionMessageId : undefined}
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

            <Button
              type="submit"
              className="w-full mt-6"
              disabled={loading || !email || !password}
            >
              {loading ? 'Logging in...' : 'Login'}
            </Button>

            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                className="inline-flex min-h-control items-center justify-center rounded-control px-2 text-sm text-primary outline-none hover:underline focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation focus-visible:ring-offset-surface"
              >
                Forgot password?
              </button>
            </div>
          </form>
        )}

        <div className="mt-2 text-center">
          <p className="text-sm text-text-muted">
            Don&apos;t have an account?{' '}
            <button
              type="button"
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
