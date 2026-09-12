import { after } from 'next/server'
import { logServerError } from '@/lib/server/diagnostics'
import { sendPasswordResetCode, sendSignupCode } from '@/lib/email'

export const DUMMY_AUTH_BCRYPT_HASH = '$2a$10$lpkNmMXcHq.HXd/ovw0RxehO6zovy.9SfT9kFmgSxAU9Ufk7G6f.K'
const AUTH_RESPONSE_FLOOR_MS = 350

export async function completeAuthResponseFloor(startedAtMs: number): Promise<void> {
  const remainingMs = AUTH_RESPONSE_FLOOR_MS - (Date.now() - startedAtMs)
  if (remainingMs > 0) {
    await new Promise(resolve => setTimeout(resolve, remainingMs))
  }
}

function scheduleDelivery(delivery: () => Promise<void>): void {
  after(async () => {
    try {
      await delivery()
    } catch (error) {
      logServerError('auth.email', error)
    }
  })
}

export function scheduleSignupCode(email: string, code: string): void {
  scheduleDelivery(() => sendSignupCode(email, code))
}

export function schedulePasswordResetCode(email: string, code: string): void {
  scheduleDelivery(() => sendPasswordResetCode(email, code))
}
