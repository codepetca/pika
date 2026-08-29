import { redirect } from 'next/navigation'
import { ForgotPasswordClient } from './ForgotPasswordClient'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export default function ForgotPasswordPage() {
  // WorkOS owns credentials while the pilot is on, so this legacy password
  // surface has nothing to submit to: its API route refuses the request. Send
  // people to the one sign-in that works instead of rendering a dead form.
  if (isWorkOSMagicAuthPilotEnabled()) {
    redirect('/login')
  }

  return <ForgotPasswordClient />
}
