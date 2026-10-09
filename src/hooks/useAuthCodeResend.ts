'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppMessage } from '@/ui'
import { requestAuthCodeResend, type AuthCodeResendKind } from '@/lib/auth-code-resend'

export function useAuthCodeResend({
  kind,
  email,
  isBlocked,
  onStart,
}: {
  kind: AuthCodeResendKind
  email: string
  isBlocked: () => boolean
  onStart: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [completion, setCompletion] = useState(0)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)
  const messageIdRef = useRef<string | null>(null)
  const focusOwnerRef = useRef<{
    opener: HTMLButtonElement
    eligible: boolean
    stopTracking: () => void
  } | null>(null)
  const { showMessage, clearMessage } = useAppMessage()

  useEffect(() => {
    setPending(false)
    setError('')
    return () => {
      generationRef.current += 1
      pendingRef.current = false
      focusOwnerRef.current?.stopTracking()
      focusOwnerRef.current = null
      if (messageIdRef.current) {
        clearMessage(messageIdRef.current)
        messageIdRef.current = null
      }
    }
  }, [kind, email, clearMessage])

  useEffect(() => {
    if (pending) return
    const owner = focusOwnerRef.current
    if (!owner) return
    owner.stopTracking()
    focusOwnerRef.current = null
    // The commit has re-enabled the native button. Restore only an untouched
    // activation whose focus fell to body when that button became disabled.
    if (owner.eligible && owner.opener.isConnected && document.activeElement === document.body) {
      owner.opener.focus({ preventScroll: true })
    }
  }, [pending, completion])

  function clearFeedback() {
    setError('')
    if (messageIdRef.current) {
      clearMessage(messageIdRef.current)
      messageIdRef.current = null
    }
  }

  async function resend(event?: { currentTarget: EventTarget | null }) {
    if (pendingRef.current || isBlocked() || !email) return
    pendingRef.current = true
    const generation = generationRef.current
    const opener = event?.currentTarget
    if (opener instanceof HTMLButtonElement && document.activeElement === opener) {
      const owner = { opener, eligible: true, stopTracking: () => {} }
      const moved = () => { owner.eligible = false }
      const focused = (event: FocusEvent) => {
        if (event.target !== opener && event.target !== document.body) moved()
      }
      document.addEventListener('pointerdown', moved, true)
      document.addEventListener('keydown', moved, true)
      document.addEventListener('focusin', focused, true)
      owner.stopTracking = () => {
        document.removeEventListener('pointerdown', moved, true)
        document.removeEventListener('keydown', moved, true)
        document.removeEventListener('focusin', focused, true)
      }
      focusOwnerRef.current = owner
    }
    clearFeedback()
    setPending(true)
    onStart()

    try {
      await requestAuthCodeResend(kind, email)
      if (generation !== generationRef.current) return
      messageIdRef.current = showMessage({
        text: kind === 'reset' ? 'Reset code requested' : 'Verification code requested',
        tone: 'success',
      })
    } catch {
      if (generation !== generationRef.current) return
      setError('Failed to resend code. Please try again.')
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false
        setPending(false)
        setCompletion((current) => current + 1)
      }
    }
  }

  return { pending, error, resend, clearFeedback, isPending: () => pendingRef.current }
}
