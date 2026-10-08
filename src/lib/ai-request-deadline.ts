/** Bound the complete request, including response-body reads, and cancel its fetch. */
export interface AIRequestDeadlineOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export class AIRequestDeadlineError extends Error {
  constructor() {
    super('AI request deadline exceeded')
    this.name = 'AIRequestDeadlineError'
  }
}

export async function withAIRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: AIRequestDeadlineOptions = {},
  defaultTimeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(options.signal?.reason)
  const timeoutMs = Math.max(0, options.timeoutMs ?? defaultTimeoutMs)
  const timer = setTimeout(() => controller.abort(new AIRequestDeadlineError()), timeoutMs)
  options.signal?.addEventListener('abort', abortFromParent, { once: true })
  if (options.signal?.aborted) abortFromParent()

  let rejectOnAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(controller.signal.reason ?? new AIRequestDeadlineError())
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true })
    if (controller.signal.aborted) rejectOnAbort()
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal)
      }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromParent)
    controller.signal.removeEventListener('abort', rejectOnAbort)
    // Also fence operations whose mocked or third-party transport ignores abort.
    controller.abort(new AIRequestDeadlineError())
  }
}
