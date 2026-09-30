import { createHash } from 'node:crypto'

export const CLI_VERSION = '2.103.0'
// Keep executable CLI configuration owned by trusted tooling. Candidate config
// remains CI evidence, but cannot provision Vault secrets or enable seeding.
export const RUNTIME_CONFIG = `project_id = "pika-migration-rollout"

[db]
major_version = 17

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
`
export const IMPACT_ACK = 'I reviewed the SQL and acknowledge all destructive or irreversible effects.'
const shaPattern = /^[a-f0-9]{40}$/
const filenamePattern = /^(\d+)_[a-zA-Z0-9_-]+\.sql$/
const fail = (message) => { throw new Error(message) }
export const hash = (value) => createHash('sha256').update(value).digest('hex')

export function validateInputs(input) {
  if (!['preview', 'apply'].includes(input.mode)) fail('Choose preview or apply.')
  if (input.target !== 'production' || input.boundTarget !== input.target) fail('Environment target binding mismatch.')
  if (!/^[a-z]{20}$/.test(input.projectRef)) fail('Invalid environment-bound project reference.')
  if (!shaPattern.test(input.sourceSha)) fail('Source must be an exact lowercase 40-character commit SHA.')
  if (!/^[1-9]\d*$/.test(input.ciRunId)) fail('A successful CI run ID is required.')
  if (!/^[1-9]\d*$/.test(input.runAttempt)) fail('Invalid run attempt.')
  if (input.mode === 'apply') {
    if (input.runAttempt !== '1') fail('Application reruns are forbidden; obtain new approval and dispatch a new run.')
    if (!/^[a-f0-9]{64}$/.test(input.approvedDigest)) fail('An exact preview digest is required.')
    if (!input.approvedMigrations || !input.approvedMigrations.split(',').every(v => /^\d+$/.test(v) || filenamePattern.test(v))) fail('Supply comma-separated exact versions or filenames without spaces.')
    if (input.confirmation !== `APPLY ${input.target} ${input.sourceSha}`) fail('Exact source and target confirmation is required.')
    if (input.impact !== IMPACT_ACK) fail('Review the actual SQL and acknowledge its effects.')
  }
  return input
}

export function parseHistory(output) {
  const rows = []
  let header = false
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.includes('|')) continue
    const columns = rawLine.split('|').map(v => v.trim())
    if (columns.length !== 3) fail('Unrecognized migration history format.')
    const [local, remote] = columns
    if (local === 'Local' && remote === 'Remote') { header = true; continue }
    if (/^-+$/.test(local) && /^-+$/.test(remote)) continue
    if (!header || (!local && !remote) || (local && !/^\d+$/.test(local)) || (remote && !/^\d+$/.test(remote))) fail('Invalid migration history row.')
    rows.push({ local, remote })
  }
  if (!header || !rows.length) fail('No recognizable migration history.')
  for (const key of ['local', 'remote']) {
    const versions = rows.map(row => row[key]).filter(Boolean)
    if (new Set(versions).size !== versions.length) fail('Duplicate migration history version.')
  }
  return rows
}

export function parseDryRun(output) {
  if (output.includes('Remote database is up to date.') && !output.includes('Would push these migrations:')) return []
  const marker = 'Would push these migrations:'
  if (output.split(marker).length !== 2) fail('Unrecognized migration preview.')
  const tail = output.slice(output.indexOf(marker) + marker.length).split(/\r?\n/).filter(v => v.trim())
  const names = tail.filter(line => {
    if (line.trim() === 'Finished supabase db push.') return false
    if (/^A new version of Supabase CLI is available: v[0-9.]+ \(currently installed v2\.103\.0\)$/.test(line.trim())) return false
    if (line.trim() === 'We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli') return false
    return true
  }).map(line => {
    const match = /^\s*•\s+((\d+)_[a-zA-Z0-9_-]+\.sql)\s*$/.exec(line)
    if (!match) fail('Unrecognized migration preview entry.')
    return match[1]
  })
  if (!names.length || new Set(names).size !== names.length) fail('Invalid migration preview set.')
  return names
}

export function createPlan(input, files, history, cliPending, schemaTree, runtimeConfigHash = hash(RUNTIME_CONFIG)) {
  if (!shaPattern.test(schemaTree) || !/^[a-f0-9]{64}$/.test(runtimeConfigHash) || !files.length) fail('Invalid source schema tree.')
  const versions = new Set()
  for (const file of files) {
    const match = filenamePattern.exec(file.name)
    if (!match || match[1] !== file.version || !/^[a-f0-9]{64}$/.test(file.hash) || versions.has(file.version)) fail('Invalid or duplicate source migration.')
    versions.add(file.version)
  }
  if (history.length !== files.length) fail('Database history differs from the complete migration inventory.')
  let pendingStarted = false
  const pending = []
  history.forEach((row, index) => {
    if (row.local !== files[index].version || (row.remote && row.remote !== row.local)) fail('Database history drift.')
    if (!row.remote) { pendingStarted = true; pending.push(files[index]) }
    else if (pendingStarted) fail('Database history is not an applied prefix; do not repair automatically.')
  })
  if (JSON.stringify(cliPending) !== JSON.stringify(pending.map(f => f.name))) fail('CLI preview differs from the complete pending set.')
  const binding = { format: 1, cli: CLI_VERSION, target: input.target, project: input.projectRef, sourceSha: input.sourceSha, schemaTree, runtimeConfigHash, files, history, pending }
  return { ...binding, digest: hash(JSON.stringify(binding)) }
}

export function verifyApproval(input, plan) {
  if (input.approvedDigest !== plan.digest) fail('Approved digest no longer matches the preview; obtain new approval.')
  const approved = input.approvedMigrations.split(',')
  if (approved.length !== plan.pending.length || !plan.pending.length || !plan.pending.every((f, i) => approved[i] === f.version || approved[i] === f.name)) fail('Approval must name the exact complete pending migration set in order.')
}

export function checkoutSha(log) {
  const lines = log.split(/\r?\n/).map(line => line.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z /, ''))
  const matches = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\[command\](?:\/[^\s]+\/)?git log -1 --format=%H$/.test(lines[i]) && shaPattern.test(lines[i + 1] ?? '')) matches.push(lines[i + 1])
  }
  if (matches.length !== 1) fail('Historical checkout SHA is missing or ambiguous in CI evidence.')
  return matches[0]
}

export function verifyCi(run, jobs, repository, runId) {
  if (String(run.id) !== runId || run.name !== 'CI' || run.path !== '.github/workflows/ci.yml' || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository || !['pull_request', 'workflow_dispatch'].includes(run.event) || run.status !== 'completed' || run.conclusion !== 'success') fail('CI run is not successful trusted repository CI.')
  const required = {
    'Architecture Database Contracts': ['Start ephemeral Supabase and replay migrations', 'Check generated database types'],
    'Test & Build': ['Run tests with coverage', 'Build production bundle'],
    'PR Gate': [],
  }
  for (const [name, steps] of Object.entries(required)) {
    const matches = jobs.filter(job => job.name === name)
    if (matches.length !== 1 || matches[0].conclusion !== 'success' || !steps.every(step => matches[0].steps?.some(s => s.name === step && s.conclusion === 'success'))) fail('Required CI replay, tests or PR Gate did not run successfully.')
  }
}
