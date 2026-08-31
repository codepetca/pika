import { redirect } from 'next/navigation'
import { CreatePasswordClient } from './CreatePasswordClient'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export default function CreatePasswordPage() {
  // WorkOS owns credentials while the pilot is on, so this legacy password
  // screen is not the intended sign-in path. Redirect to the one that works
  // instead of rendering a form here. (Whether the underlying API route also
  // refuses the request is a separate, independently-landed guard -- this
  // redirect does not depend on it and is not itself that enforcement.)
  if (isWorkOSMagicAuthPilotEnabled()) {
    redirect('/login')
  }

  return <CreatePasswordClient />
}
