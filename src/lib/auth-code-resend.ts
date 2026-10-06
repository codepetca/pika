export type AuthCodeResendKind = 'signup' | 'reset'

/** A generic reset acknowledgement deliberately says nothing about account existence. */
export async function requestAuthCodeResend(kind: AuthCodeResendKind, email: string): Promise<void> {
  const response = await fetch(
    kind === 'signup' ? '/api/auth/signup' : '/api/auth/forgot-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
  )
  if (!response.ok) {
    throw new Error('Failed to resend code. Please try again.')
  }
}
