'use client'

import { useState, useRef, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppMessageFallback, Input, Button, FormField } from '@/ui'
import { useAuthCodeResend } from '@/hooks/useAuthCodeResend'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [step, setStep] = useState<'verify' | 'reset'>('verify')
  const [email, setEmail] = useState(emailFromUrl)
  const [code, setCode] = useState('')
  const [handoffToken, setHandoffToken] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const verifyingRef = useRef(false)
  const resend = useAuthCodeResend({
    kind: 'reset',
    email,
    isBlocked: () => verifyingRef.current,
    onStart: () => {
      setError('')
      setHandoffToken('')
    },
  })

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault()
    if (verifyingRef.current || resend.isPending()) return
    verifyingRef.current = true
    resend.clearFeedback()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/reset-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code')
      }

      setHandoffToken(data.handoffToken)
      setStep('reset')
      verifyingRef.current = false
      setLoading(false)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      verifyingRef.current = false
      setLoading(false)
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation, handoffToken }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password')
      }

      // Redirect based on user role
      router.push(data.redirectUrl)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setLoading(false)
    }
  }

  if (step === 'verify') {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center p-4 bg-page">
          <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
            <h1 className="text-2xl font-bold text-text-default mb-2">
              Reset Password
            </h1>
            <p className="text-text-muted mb-6">
              Enter the 5-character code sent to your email
            </p>

            <form onSubmit={handleVerifyCode}>
              <FormField label="School Email" required className="mb-4">
                <Input
                  type="email"
                  placeholder="number@gapps.yrdsb.ca"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading || resend.pending}
                />
              </FormField>

              <FormField label="Reset Code" error={error || resend.error} required>
                <Input
                  type="text"
                  placeholder="A7Q2F"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  disabled={loading || resend.pending}
                  maxLength={5}
                />
              </FormField>

              <Button
                type="submit"
                className="w-full mt-6"
                disabled={loading || resend.pending || !email || code.length !== 5}
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </Button>
            </form>

            <div className="mt-4 text-center space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth
                onClick={resend.resend}
                disabled={loading || resend.pending || !email}
                aria-busy={resend.pending || undefined}
              >
                {resend.pending ? 'Sending…' : 'Resend reset code'}
              </Button>
              <button
                onClick={() => router.push('/login')}
                className="text-sm text-text-muted hover:underline block w-full"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>

      </>
    )
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center p-4 bg-page">
        <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-text-default mb-2">
            Set New Password
          </h1>
          <p className="text-text-muted mb-6">
            Choose a new secure password for your account
          </p>

          <form onSubmit={handleResetPassword}>
            <FormField label="New Password" required className="mb-4">
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </FormField>

            <FormField label="Confirm Password" error={error} required>
              <Input
                type="password"
                placeholder="Re-enter your password"
                value={passwordConfirmation}
                onChange={(e) => setPasswordConfirmation(e.target.value)}
                required
                disabled={loading}
              />
            </FormField>

            <div className="mt-4 text-sm text-text-muted">
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
              {loading ? 'Resetting Password...' : 'Reset Password'}
            </Button>
          </form>
        </div>
      </div>

    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AppMessageFallback />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
