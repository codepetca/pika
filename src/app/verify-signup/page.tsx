'use client'

import { useState, useRef, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppMessageFallback, Input, Button, FormField } from '@/ui'
import { buildAuthContinuationPath } from '@/lib/auth-redirect'
import { getSafeInternalPath } from '@/lib/navigation-safety'
import { useAuthFormContinuity, useUppercaseAuthCode } from '@/hooks/useAuthFormContinuity'
import { useAuthCodeResend } from '@/hooks/useAuthCodeResend'

const SIGNUP_HANDOFF_TOKEN_STORAGE_KEY = 'pika.signupHandoffToken'

function VerifySignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''
  const nextPath = getSafeInternalPath(searchParams.get('next'))

  const [email, setEmail] = useState(emailFromUrl)
  const { code, inputRef, onChange } = useUppercaseAuthCode()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const verifyingRef = useRef(false)
  const continuity = useAuthFormContinuity(loading)
  const resend = useAuthCodeResend({
    kind: 'signup',
    email,
    isBlocked: () => verifyingRef.current,
    onStart: () => setError(''),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (verifyingRef.current || resend.isPending()) return
    const request = continuity.begin(e.currentTarget as HTMLFormElement)
    if (request === null) return
    verifyingRef.current = true
    resend.clearFeedback()
    setError('')
    setLoading(true)

    try {
      const response = await fetch('/api/auth/verify-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await response.json()
      if (!continuity.isCurrent(request)) return

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code')
      }

      continuity.release(request)
      window.sessionStorage.setItem(
        SIGNUP_HANDOFF_TOKEN_STORAGE_KEY,
        JSON.stringify({ email, token: data.handoffToken }),
      )

      router.push(buildAuthContinuationPath('/create-password', { email, next: nextPath }))
    } catch (err: any) {
      if (!continuity.isCurrent(request)) return
      continuity.finish(request)
      setError(err.message || 'An error occurred')
      verifyingRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-page">
      <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-text-default mb-2">
          Verify Your Email
        </h1>
        <p className="text-text-muted mb-6">
          Enter the 5-character code sent to your email
        </p>

        <form onSubmit={handleSubmit} aria-busy={loading || resend.pending}>
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

          <FormField label="Verification Code" error={error || resend.error} required reserveErrorSpace>
            <Input
              type="text"
              placeholder="A7Q2F"
              ref={inputRef}
              value={code}
              onChange={onChange}
              required
              disabled={loading || resend.pending}
              maxLength={5}
            />
          </FormField>

          <Button
            type="submit"
            aria-busy={loading || undefined}
            className="w-full mt-6"
            disabled={loading || resend.pending || !email || code.length !== 5}
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resend.resend}
            disabled={loading || resend.pending || !email}
            aria-busy={resend.pending || undefined}
          >
            {resend.pending ? 'Sending…' : 'Resend verification code'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function VerifySignupPage() {
  return (
    <Suspense fallback={<AppMessageFallback />}>
      <VerifySignupForm />
    </Suspense>
  )
}
