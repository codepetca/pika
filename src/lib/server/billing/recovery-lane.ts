import { logServerError } from '@/lib/server/diagnostics'

export async function runOptionalRecoveryLane<T>(run: () => Promise<T>) {
  try {
    return await run()
  } catch (error) {
    return { failed: 1, diagnosticId: logServerError('api.unexpected', error) }
  }
}
