'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MagicAuthForm } from '@/components/auth/MagicAuthForm'
import { Input, Button, FormField } from '@/ui'
import { buildAuthContinuationPath } from '@/lib/auth-redirect'
import { useAuthFormContinuity } from '@/hooks/useAuthFormContinuity'
import { getSafeInternalPath } from '@/lib/navigation-safety'

export function SignupClient({
  magicAuthEnabled = false,
  hasPendingMagicAuthChallenge = false,
}: {
  magicAuthEnabled?: boolean
  hasPendingMagicAuthChallenge?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const continuity = useAuthFormContinuity(loading)
  const nextPath = getSafeInternalPath(searchParams.get('next'))

  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) setEmail(emailParam)
  }, [searchParams])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const request = continuity.begin(event.currentTarget as HTMLFormElement)
    if (request === null) return
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!continuity.isCurrent(request)) return
      if (!response.ok) throw new Error(data.error || 'Failed to send verification code')

      continuity.release(request)
      setSuccess(true)
      continuity.continueAfter(request, () => {
        router.push(buildAuthContinuationPath('/verify-signup', { email, next: nextPath }))
      }, 1000)
    } catch (caught) {
      if (!continuity.isCurrent(request)) return
      continuity.finish(request)
      setError(caught instanceof Error ? caught.message : 'An error occurred')
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
          {magicAuthEnabled
            ? 'Enter your school email. We’ll send a six-digit code to verify and create your account.'
            : 'Enter your email to create an account. We’ll send you a verification code.'}
        </p>

        {magicAuthEnabled ? (
          <MagicAuthForm
            intent="sign-up"
            initialEmail={email}
            hasPendingChallenge={hasPendingMagicAuthChallenge}
            nextPath={nextPath}
          />
        ) : success ? (
          <div role="status" aria-live="polite" className="bg-success-bg border border-success text-text-default px-4 py-3 rounded-lg">
            Verification code sent! Redirecting...
          </div>
        ) : (
          <form onSubmit={handleSubmit} aria-busy={loading}>
            <FormField label="School Email" error={error} required reserveErrorSpace>
              <Input
                type="email"
                placeholder="email@gapps.yrdsb.ca"
                value={email}
                onChange={event => setEmail(event.target.value)}
                disabled={loading}
              />
            </FormField>

            <Button type="submit" fullWidth className="mt-6" loading={loading} disabled={!email}>
              {loading ? 'Sending...' : 'Send Verification Code'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <p className="text-sm text-text-muted">
            Already have an account?{' '}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                continuity.retire()
                router.push(buildAuthContinuationPath('/login', { next: nextPath }))
              }}
            >
              Login
            </Button>
          </p>
        </div>
      </div>
    </div>
  )
}
