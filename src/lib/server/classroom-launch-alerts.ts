import { after } from 'next/server'
import type { ClassroomLaunchAlert } from '@/lib/contracts/classroom-launch-alerts'
import { logServerError } from '@/lib/server/diagnostics'

const diagnosticEvents = {
  'signup-email': 'classroom.launch.signup_email',
  admission: 'classroom.launch.admission',
} as const

export function scheduleClassroomLaunchAlert(kind: ClassroomLaunchAlert): void {
  // Alerts must not change the outcome of the auth or admission request.
  try {
    logServerError(diagnosticEvents[kind])
    const endpoint = URL.parse(process.env.PIKA_LAUNCH_ALERT_ORIGIN ?? '')
    const token = process.env.PIKA_LAUNCH_ALERT_TOKEN ?? ''
    if (process.env.VERCEL_ENV !== 'production' || !endpoint || endpoint.protocol !== 'https:'
      || endpoint.href !== endpoint.origin + '/' || !/^[a-f0-9]{64}$/.test(token)) return

    after(async () => {
      try {
        const response = await fetch(new URL('/v1/launch-alerts/' + kind, endpoint), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          redirect: 'error',
          signal: AbortSignal.timeout(2_000),
        })
        if (response.status !== 202) logServerError('classroom.launch.alert_delivery')
      } catch {
        logServerError('classroom.launch.alert_delivery')
      }
    })
  } catch {
    // A missing request context or a diagnostic failure cannot interrupt signup.
  }
}
