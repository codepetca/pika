/** Import-safe, closed metadata for a reported fixture error. No raw error data leaves this module. */
import { types } from 'node:util'

const fields = ['message', 'value', 'stack', 'cause', 'location', 'code', 'signal', 'name'] as const
const kinds = ['null', 'primitive', 'object', 'proxy'] as const
const buckets = ['absent', 'accessor', 'nonstring', 'empty', 'bounded', 'oversized'] as const
const events = ['body', 'test-end', 'global'] as const
const sites = [
  'unknown', 'full-app-spec', 'full-app-config', 'admission', 'binding', 'startup', 'runtime', 'workflow',
  'pw-test-type', 'pw-fixture-runner', 'pw-worker-main', 'pw-lib-fixtures', 'pw-dispatcher',
  'pw-transform', 'pw-esm-loader', 'pw-browser-type', 'pw-chromium', 'node-internal-module',
] as const

export type ErrorShape = { kind: typeof kinds[number] } & Record<typeof fields[number], typeof buckets[number]>
export type CodeSite = typeof sites[number]
export type FixtureErrorObservation = {
  event: typeof events[number]
  rootShape: ErrorShape
  firstCauseShape?: ErrorShape
  sites: CodeSite[]
}

function isRecord(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !types.isProxy(value)
}

function ownData(value: unknown, key: string): { bucket: typeof buckets[number]; value?: unknown } {
  if (!isRecord(value)) return { bucket: 'absent' }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { bucket: 'absent' }
    if (!('value' in descriptor)) return { bucket: 'accessor' }
    if (typeof descriptor.value !== 'string') return { bucket: 'nonstring', value: descriptor.value }
    return { bucket: descriptor.value.length === 0 ? 'empty' : descriptor.value.length <= 65536 ? 'bounded' : 'oversized', value: descriptor.value }
  } catch { return { bucket: 'absent' } }
}

function shape(value: unknown): ErrorShape {
  const kind: ErrorShape['kind'] = value === null ? 'null' : typeof value !== 'object' ? 'primitive' : types.isProxy(value) ? 'proxy' : 'object'
  const result = { kind } as ErrorShape
  for (const field of fields) result[field] = ownData(value, field).bucket
  return result
}

// Only exact known producer-file suffixes are eligible. These are reported hints,
// never a claim about the actual origin of the failure.
const producerFiles: readonly [string, CodeSite][] = [
  ['e2e/contextual-test-lifecycle.spec.ts', 'full-app-spec'],
  ['playwright.contextual-tests.config.ts', 'full-app-config'],
  ['e2e/helpers/contextual-test-admission.ts', 'admission'],
  ['scripts/contextual-test-rehearsal-binding.ts', 'binding'],
  ['e2e/helpers/contextual-test-startup.ts', 'startup'],
  ['e2e/helpers/contextual-test-startup-reporter.ts', 'startup'],
  ['e2e/helpers/contextual-test-runtime.ts', 'runtime'],
  ['e2e/helpers/contextual-test-workflow.ts', 'workflow'],
  ['playwright/lib/common/testType.js', 'pw-test-type'],
  ['playwright/lib/worker/fixtureRunner.js', 'pw-fixture-runner'],
  ['playwright/lib/worker/workerMain.js', 'pw-worker-main'],
  ['playwright/lib/index.js', 'pw-lib-fixtures'],
  ['playwright/lib/runner/dispatcher.js', 'pw-dispatcher'],
  ['playwright/lib/transform/transform.js', 'pw-transform'],
  ['playwright/lib/transform/esmLoader.js', 'pw-esm-loader'],
  ['playwright-core/lib/server/browserType.js', 'pw-browser-type'],
  ['playwright-core/lib/server/chromium/chromium.js', 'pw-chromium'],
]

function labelForFile(file: string): CodeSite {
  if (file.length === 0 || file.length > 4096) return 'unknown'
  if (/^node:internal\/modules\//.test(file)) return 'node-internal-module'
  for (const [suffix, label] of producerFiles) {
    if (file === suffix || file.endsWith(`/${suffix}`)) return label
  }
  return 'unknown'
}

function frameFile(line: string): string | undefined {
  if (line.length > 4096) return undefined
  // Parse only a V8 frame line; never search the error message for a filename.
  const match = /^\s*at (?:.*? \()?(.+?):\d+:\d+\)?$/.exec(line)
  return match?.[1]
}

function addReportedSites(error: unknown, found: CodeSite[]): void {
  const location = ownData(error, 'location').value
  const locationFile = ownData(location, 'file')
  if (locationFile.bucket === 'bounded') {
    const label = labelForFile(locationFile.value as string)
    if (label !== 'unknown' && !found.includes(label) && found.length < 3) found.push(label)
  }
  const stack = ownData(error, 'stack')
  if (stack.bucket !== 'bounded') return
  let frames = 0
  for (const line of (stack.value as string).split('\n')) {
    const file = frameFile(line)
    if (file === undefined) continue
    if (++frames > 32 || found.length >= 3) break
    const label = labelForFile(file)
    if (label !== 'unknown' && !found.includes(label)) found.push(label)
  }
}

export function observeFixtureError(error: unknown, event: FixtureErrorObservation['event']): FixtureErrorObservation {
  if (!events.includes(event)) throw Error('Invalid observation event')
  const rootShape = shape(error)
  const cause = ownData(error, 'cause').value
  const firstCauseShape = cause !== null && typeof cause === 'object' && cause !== error ? shape(cause) : undefined
  const found: CodeSite[] = []
  addReportedSites(error, found)
  if (firstCauseShape && found.length < 3) addReportedSites(cause, found)
  const result: FixtureErrorObservation = { event, rootShape, sites: found.length ? found : ['unknown'] }
  if (firstCauseShape) result.firstCauseShape = firstCauseShape
  return result
}

function plainData(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw Error('Invalid observation object')
  const keys = Reflect.ownKeys(value)
  if (keys.length < required.length || keys.length > required.length + optional.length || keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key))) throw Error('Invalid observation keys')
  const output: Record<string, unknown> = {}
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) throw Error('Invalid observation field')
    output[key] = descriptor.value
  }
  for (const key of optional) {
    if (!keys.includes(key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) throw Error('Invalid observation field')
    output[key] = descriptor.value
  }
  return output
}

function validateShape(raw: unknown): ErrorShape {
  const data = plainData(raw, ['kind', ...fields])
  if (!kinds.includes(data.kind as ErrorShape['kind'])) throw Error('Invalid observation kind')
  const result = { kind: data.kind } as ErrorShape
  for (const field of fields) {
    if (!buckets.includes(data[field] as ErrorShape[typeof field])) throw Error('Invalid observation bucket')
    result[field] = data[field] as ErrorShape[typeof field]
  }
  return result
}

export function validateFixtureErrorObservation(raw: unknown): FixtureErrorObservation {
  const data = plainData(raw, ['event', 'rootShape', 'sites'], ['firstCauseShape'])
  if (!events.includes(data.event as FixtureErrorObservation['event'])) throw Error('Invalid observation event')
  if (!Array.isArray(data.sites) || types.isProxy(data.sites) || Object.getPrototypeOf(data.sites) !== Array.prototype || data.sites.length < 1 || data.sites.length > 3) throw Error('Invalid observation sites')
  const listed: CodeSite[] = []
  for (let i = 0; i < data.sites.length; i++) {
    const item = Object.getOwnPropertyDescriptor(data.sites, String(i))
    if (!item || !('value' in item) || !sites.includes(item.value) || listed.includes(item.value)) throw Error('Invalid observation site')
    listed.push(item.value)
  }
  if (Reflect.ownKeys(data.sites).length !== data.sites.length + 1 || (listed.includes('unknown') && listed.length !== 1)) throw Error('Invalid observation sites')
  const result: FixtureErrorObservation = { event: data.event as FixtureErrorObservation['event'], rootShape: validateShape(data.rootShape), sites: listed }
  if ('firstCauseShape' in data) result.firstCauseShape = validateShape(data.firstCauseShape)
  return result
}
