type ResultsResponse = { ok: boolean; data: unknown }
type PendingRead = { generation: number; promise: Promise<ResultsResponse> }
type ReadState = { generation: number; pending?: PendingRead }

/** One Tests workspace owns this reader; only unfinished reads are shared. */
export function createTestResultsReader() {
  const states = new Map<string, ReadState>()
  const stateFor = (url: string) => {
    let state = states.get(url)
    if (!state) {
      state = { generation: 0 }
      states.set(url, state)
    }
    return state
  }

  return {
    generation(url: string) {
      return stateFor(url).generation
    },
    invalidate(url: string) {
      stateFor(url).generation += 1
    },
    read(url: string): Promise<ResultsResponse> {
      const state = stateFor(url)
      if (state.pending?.generation === state.generation) return state.pending.promise

      const generation = state.generation
      const fetchResults = async () => {
        const response = await fetch(url, { cache: 'no-store' })
        return { ok: response.ok, data: await response.json() as unknown }
      }
      // A mutation needs a fresh read, but must not overlap the older locked read.
      const request = state.pending
        ? state.pending.promise.then(fetchResults, fetchResults)
        : fetchResults()
      const pending: PendingRead = {
        generation,
        promise: request.finally(() => {
          if (state.pending === pending) state.pending = undefined
        }),
      }
      state.pending = pending
      return pending.promise
    },
  }
}

export type TestResultsReader = ReturnType<typeof createTestResultsReader>
