'use client'

import { useState, useRef, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppMessageFallback, Input, Button, FormField } from '@/ui'
import { useAuthCodeResend } from '@/hooks/useAuthCodeResend'
import { fetchAuthSubmit, readAuthSubmitResponse } from '@/lib/auth-submit-response'
import { useAuthFormContinuity, useUppercaseAuthCode } from '@/hooks/useAuthFormContinuity'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''

  const [step, setStep] = useState<'verify' | 'reset'>('verify')
  const [email, setEmail] = useState(emailFromUrl)
  const resetCode = useUppercaseAuthCode()
  const code = resetCode.code
  const [handoffToken, setHandoffToken] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const continuity = useAuthFormContinuity(loading)

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
    const request = continuity.begin(e.currentTarget as HTMLFormElement)
    if (request === null) return
    verifyingRef.current = true
    resend.clearFeedback()
    setError('')
    setLoading(true)

    try {
      const response = await fetchAuthSubmit('/api/auth/reset-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await readAuthSubmitResponse(response)

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code')
      }

      if (!continuity.isCurrent(request)) return
      setHandoffToken(data.handoffToken)
      continuity.release(request)
      setStep('reset')
      verifyingRef.current = false
      setLoading(false)
    } catch (err: any) {
      if (!continuity.isCurrent(request)) return
      setError(err.message || 'An error occurred')
      verifyingRef.current = false
      setLoading(false)
      continuity.finish(request)
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    const request = continuity.begin(e.currentTarget as HTMLFormElement)
    if (request === null) return
    setError('')
    setLoading(true)

    try {
      const response = await fetchAuthSubmit('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation, handoffToken }),
      })

      const data = await readAuthSubmitResponse(response)

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password')
      }

      if (!continuity.isCurrent(request)) return
      // Redirect based on user role
      router.push(data.redirectUrl)
    } catch (err: any) {
      if (!continuity.isCurrent(request)) return
      setError(err.message || 'An error occurred')
      setLoading(false)
      continuity.finish(request)
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

              <FormField label="Reset Code" error={error || resend.error} reserveErrorSpace required>
                <Input
                  type="text"
                  placeholder="A7Q2F"
                  value={code}
                  ref={resetCode.inputRef}
                  onChange={resetCode.onChange}
                  required
                  disabled={loading || resend.pending}
                  maxLength={5}
                />
              </FormField>

              <Button
                aria-busy={loading || undefined}
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
              <Button
                type="button" variant="ghost" size="sm" fullWidth
                onClick={() => { continuity.retire(); router.push('/login') }}
              >
                Back to login
              </Button>
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

            <FormField label="Confirm Password" error={error} reserveErrorSpace required>
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
              aria-busy={loading || undefined}
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
