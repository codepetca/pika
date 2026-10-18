/** Proof diagnostics only. Closed INFO SQLSTATE vocabulary; no raw stderr survives. */
export const SURVEY_PROGRESS_CAPS = Object.freeze({ events: 224, lineBytes: 128, maximumBytes: 28672 })
const events: string[] = ['functional:start', 'functional:end']
const stages = ['start', 'rpc-start', 'rpc-end', 'restored'] as const
function cases(names: readonly string[], suffixes: readonly string[]) {
  for (const name of names) for (const suffix of suffixes) for (const stage of stages) events.push(`${name}:${suffix}:${stage}`)
}
for (const name of ['owner-patch','question-create','question-update','expected-question','expected-questions','detail-owner','detail-member'])
  cases([name], name.startsWith('detail-') ? ['exact','plus-one'] : ['exact','plus-one','shape'])
cases(['list-owner','list-member','results-owner','results-member'], ['exact','plus-one'])
events.push('vector-fixture:start','vector-fixture:ready')
cases(['response-vector'], ['exact','plus-one','shape'])
events.push('vector-fixture:restored','questions-fixture:start','questions-fixture:ready')
cases(['count-results-owner','count-results-member'], ['exact','plus-one'])
events.push('questions-answers:start','questions-answers:ready')
cases(['count-detail-questions-owner','count-detail-questions-member','count-detail-responses-member-joint','count-response-questions'], ['exact','plus-one'])
events.push('questions-fixture:restored','lists-fixture:start','lists-fixture:ready','lists-answers:ready')
cases(['count-list-owner','count-list-member'], ['exact','plus-one'])
events.push('lists-fixture:restored')
cases(['count-response-empty','count-response-keys-short','count-response-keys-extra'], ['denied'])
events.push('matrix:complete')
export const SURVEY_PROGRESS_EVENTS: readonly string[] = Object.freeze(events)
export type SurveyProgressSnapshot = Readonly<{ enabled: boolean; valid: boolean; sequence: number; checkpoint: string; elapsedMs: number | null }>
export function captureSurveyProgress(enabled: boolean, clock: () => number = () => performance.now()) {
  const started = enabled ? clock() : 0
  let line = '', invalid = false, sequence = 0, elapsedMs: number | null = null, frozen: SurveyProgressSnapshot | undefined
  const snapshot = (): SurveyProgressSnapshot => frozen ?? Object.freeze({ enabled, valid: !invalid, sequence,
    checkpoint: sequence ? SURVEY_PROGRESS_EVENTS[sequence - 1] : 'none', elapsedMs })
  const fail = () => { invalid = true; line = '' }
  const consume = () => {
    // INFO is reserved for this exact source-owned frame. Other severity lines
    // remain the existing SQLSTATE reader's responsibility, without retention.
    if (line.includes('INFO:') || line.includes('PS')) {
      const match = line.match(/^(?:psql:<stdin>:[1-9]\d{0,6}: )?INFO:[ \t]+PS(\d{3})[ \t]*\r?$/)
      const next = Number(match?.[1]), now = clock() - started
      if (!match || next !== sequence + 1 || next > SURVEY_PROGRESS_EVENTS.length || next > SURVEY_PROGRESS_CAPS.events
        || !Number.isFinite(now) || now < 0 || (elapsedMs !== null && now < elapsedMs)) fail()
      else { sequence = next; elapsedMs = Math.floor(now) }
    }
    line = ''
  }
  return Object.freeze({
    push(chunk: Buffer | string) {
      if (!enabled || invalid || frozen) return
      for (const character of chunk.toString()) {
        if (invalid) break
        if (character === '\n') consume()
        else if (character.charCodeAt(0) > 127 || line.length >= SURVEY_PROGRESS_CAPS.lineBytes - 1) fail()
        else line += character
      }
    },
    finish() { if (enabled && !frozen && (line.length || sequence !== SURVEY_PROGRESS_EVENTS.length)) fail(); return snapshot() },
    snapshot,
    freeze() { frozen ??= snapshot(); line = ''; return frozen },
  })
}
