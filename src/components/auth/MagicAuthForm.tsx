'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { navigateTo } from '@/lib/client-navigation'
import { Button, FormField, Input } from '@/ui'

type MagicAuthIntent = 'sign-in' | 'sign-up'

interface MagicAuthFormProps {
  intent: MagicAuthIntent
  initialEmail?: string
  hasPendingChallenge?: boolean
  nextPath?: string | null
}

type Phase = 'email' | 'code'

export function MagicAuthForm({
  intent,
  initialEmail = '',
  hasPendingChallenge = false,
  nextPath,
}: MagicAuthFormProps) {
  const [phase, setPhase] = useState<Phase>(hasPendingChallenge ? 'code' : 'email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(
    hasPendingChallenge ? 'We sent a six-digit code to your email.' : '',
  )

  useEffect(() => {
    if (phase === 'email') setEmail(initialEmail)
  }, [initialEmail, phase])

  async function sendCode(): Promise<void> {
    const response = await fetch('/api/auth/workos/magic/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        intent,
        ...(nextPath ? { next: nextPath } : {}),
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to send a sign-in code')
    setPhase('code')
    setStatus(`We sent a six-digit code to ${email.trim().toLowerCase()}.`)
  }

  async function handleEmailSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    setStatus('')
    setLoading(true)
    try {
      await sendCode()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send a sign-in code')
    } finally {
      setLoading(false)
    }
  }

  async function handleCodeSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/workos/magic/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Invalid or expired code')
      navigateTo(data.redirectUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid or expired code')
      setLoading(false)
    }
  }

  async function handleResend(): Promise<void> {
    setError('')
    setStatus('')
    setLoading(true)
    try {
      await sendCode()
      setCode('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resend the code')
    } finally {
      setLoading(false)
    }
  }

  async function changeEmail(): Promise<void> {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/workos/magic/pending', { method: 'DELETE' })
      if (!response.ok) throw new Error('Unable to change email. Please try again.')
      setPhase('email')
      setCode('')
      setStatus('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (phase === 'email') {
    return (
      <form onSubmit={handleEmailSubmit}>
        <FormField label="School Email" error={error}>
          <Input
            type="email"
            autoComplete="email"
            placeholder="email@gapps.yrdsb.ca"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
            disabled={loading}
          />
        </FormField>
        <Button type="submit" fullWidth className="mt-6" loading={loading} disabled={!email.trim()}>
          {loading ? 'Sending code...' : 'Email me a sign-in code'}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleCodeSubmit}>
      {status && (
        <p className="mb-4 rounded-control border border-border bg-surface-2 px-4 py-3 text-sm text-text-default" role="status">
          {status}
        </p>
      )}
      <FormField
        label="Six-digit code"
        error={error}
        hint="The code expires in 10 minutes."
        required
      >
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className="text-center text-xl tracking-[0.3em]"
          disabled={loading}
        />
      </FormField>
      <Button type="submit" fullWidth className="mt-6" loading={loading} disabled={code.length !== 6}>
        {loading ? 'Verifying...' : intent === 'sign-up' ? 'Verify and create account' : 'Verify and login'}
      </Button>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={handleResend} disabled={loading}>
          Resend code
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={changeEmail} disabled={loading}>
          Use a different email
        </Button>
      </div>
    </form>
  )
}
