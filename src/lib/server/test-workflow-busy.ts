import { ApiError } from '@/lib/api-error'

// This error is emitted only for an explicit database rollback caused by lock
// contention. Never retry a timeout, network error, or ambiguous acknowledgement.
export class TestWorkflowBusy extends ApiError {
  constructor() { super(503, 'Test is temporarily busy. Please try again.') }
}

export async function retryTestWorkflowBusy<T>(run: () => Promise<T>, within: <U>(fn: () => PromiseLike<U>) => Promise<U>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run() } catch (error) {
      if (!(error instanceof TestWorkflowBusy) || attempt >= 2) throw error
      await within(() => new Promise<void>(resolve => setTimeout(resolve, 50 * (attempt + 1))))
    }
  }
}
