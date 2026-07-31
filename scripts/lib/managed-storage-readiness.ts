import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  hostedSupabasePsqlEnvironment,
  localSupabasePsqlEnvironment,
  verifyHostedSupabaseApiOrigin,
} from '@/lib/server/supabase-target'

const projectRefSchema = z.string().regex(/^[a-z0-9]{20}$/)
const commandSchema = z.enum(['report', 'execute', 'resume'])

export type ManagedStorageReadinessCommand = z.infer<typeof commandSchema>
export type StorageIdentity = { bucket: string; path: string }
export type ManagedStorageReadinessArguments = {
  command: ManagedStorageReadinessCommand
  expectedProjectRef?: string
  acknowledgement?: string
  json: boolean
}

function readOption(args: string[], name: string): string | undefined {
  const matches = args.reduce<number[]>((indexes, value, index) => {
    if (value === name) indexes.push(index)
    return indexes
  }, [])
  if (matches.length > 1) throw new Error(`${name} may be provided only once`)
  if (matches.length === 0) return undefined
  const value = args[matches[0] + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parseManagedStorageReadinessArguments(
  args: string[],
): ManagedStorageReadinessArguments {
  const positional = args.filter((value, index) => {
    if (index > 0 && ['--expected-project-ref', '--acknowledgement'].includes(args[index - 1])) {
      return false
    }
    return !value.startsWith('--')
  })
  if (args.includes('--dry-run') && positional.some((value) => value !== 'report')) {
    throw new Error('--dry-run cannot be combined with execute or resume')
  }
  const command = commandSchema.parse(positional[0] || 'report')
  if (positional.length > 1) throw new Error('Unexpected positional argument')
  const knownFlags = new Set([
    '--dry-run', '--json', '--expected-project-ref', '--acknowledgement',
  ])
  for (const value of args) {
    if (value.startsWith('--') && !knownFlags.has(value)) {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  return {
    command,
    expectedProjectRef: readOption(args, '--expected-project-ref'),
    acknowledgement: readOption(args, '--acknowledgement'),
    json: args.includes('--json'),
  }
}

export function managedStorageProductionAcknowledgement(
  projectRef: string,
  commit: string,
): string {
  return `BACKFILL MANAGED STORAGE ${projectRefSchema.parse(projectRef)} AT ${z.string()
    .regex(/^[a-f0-9]{40}$/).parse(commit)}`
}

export function resolveManagedStorageReadinessTarget(input: {
  args: ManagedStorageReadinessArguments
  supabaseUrl: string
  databaseUrl: string
  environment: NodeJS.ProcessEnv
  commit: string
  checkoutClean: boolean
}) {
  const api = new URL(input.supabaseUrl)
  const local = ['127.0.0.1', 'localhost'].includes(api.hostname) && api.port === '54321'
  if (local) {
    const psqlEnvironment = localSupabasePsqlEnvironment(input.databaseUrl)
    if (
      input.args.command !== 'report'
      && input.environment.PIKA_ALLOW_LOCAL_MANAGED_STORAGE_BACKFILL !== '1'
    ) {
      throw new Error(
        'Local execution requires PIKA_ALLOW_LOCAL_MANAGED_STORAGE_BACKFILL=1',
      )
    }
    return { local: true as const, supabaseOrigin: api.origin, psqlEnvironment }
  }

  const expectedProjectRef = input.args.expectedProjectRef
    || input.environment.MANAGED_STORAGE_BACKFILL_EXPECTED_PROJECT_REF
  if (!expectedProjectRef) {
    throw new Error('--expected-project-ref is required for a hosted target')
  }
  const supabaseOrigin = verifyHostedSupabaseApiOrigin(input.supabaseUrl, expectedProjectRef)
  const psqlEnvironment = hostedSupabasePsqlEnvironment(
    input.databaseUrl,
    expectedProjectRef,
  )
  if (input.args.command !== 'report') {
    if (input.environment.MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION !== '1') {
      throw new Error('Production execution requires MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION=1')
    }
    if (!input.checkoutClean) {
      throw new Error('Production execution requires a clean checkout')
    }
    const acknowledgement = input.args.acknowledgement
      || input.environment.MANAGED_STORAGE_BACKFILL_ACKNOWLEDGEMENT
    const expected = managedStorageProductionAcknowledgement(expectedProjectRef, input.commit)
    if (acknowledgement !== expected) {
      throw new Error(`Production acknowledgement must equal: ${expected}`)
    }
  }
  return {
    local: false as const,
    projectRef: expectedProjectRef,
    supabaseOrigin,
    psqlEnvironment,
  }
}

function identityKey(value: StorageIdentity): string {
  return `${value.bucket}\0${value.path}`
}

export function analyzeGlobalManagedStorage(input: {
  physical: StorageIdentity[]
  registered: Array<StorageIdentity & { classroomId?: string | null; blueprintId?: string | null }>
  discovered: Array<StorageIdentity & { classroomId: string }>
}) {
  const physical = new Map(input.physical.map((value) => [identityKey(value), value]))
  const registered = new Map(input.registered.map((value) => [identityKey(value), value]))
  const discoveredOwners = new Map<string, Set<string>>()
  for (const value of input.discovered) {
    const key = identityKey(value)
    const owners = discoveredOwners.get(key) || new Set<string>()
    owners.add(value.classroomId)
    discoveredOwners.set(key, owners)
  }
  const shared = [...discoveredOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([key, owners]) => ({
      ...(physical.get(key) || input.discovered.find((value) => identityKey(value) === key)!),
      classroomIds: [...owners].sort(),
    }))
  const missing = [...discoveredOwners.keys()]
    .filter((key) => !physical.has(key))
    .map((key) => input.discovered.find((value) => identityKey(value) === key)!)
  const orphans = [...physical.entries()]
    .filter(([key]) => !registered.has(key) && !discoveredOwners.has(key))
    .map(([, value]) => value)
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
  const registeredMissing = [...registered.entries()]
    .filter(([key]) => !physical.has(key))
    .map(([, value]) => value)
  return { shared, missing, orphans, registeredMissing }
}

function pathFingerprint(value: StorageIdentity) {
  return {
    bucket: value.bucket,
    storage_path_sha256: createHash('sha256').update(value.path, 'utf8').digest('hex'),
  }
}

export function redactManagedStorageFindings(input: ReturnType<
  typeof analyzeGlobalManagedStorage
>) {
  return {
    shared: input.shared.map((value) => ({
      ...pathFingerprint(value),
      classroom_ids: value.classroomIds,
    })),
    missing: input.missing.map((value) => ({
      ...pathFingerprint(value),
      classroom_id: value.classroomId,
    })),
    orphans: input.orphans.map(pathFingerprint),
    registeredMissing: input.registeredMissing.map(pathFingerprint),
  }
}

export function readManagedStorageCatalog(
  psqlEnvironment: Record<string, string>,
): {
  physical: StorageIdentity[]
  registered: Array<StorageIdentity & { classroomId: string | null; blueprintId: string | null }>
} {
  const sql = `
    select jsonb_build_object(
      'physical', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name)
          order by bucket_id, name)
        from storage.objects
        where bucket_id in ('assignment-artifacts', 'submission-images', 'test-documents')
      ), '[]'::jsonb),
      'registered', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket', storage_bucket, 'path', storage_path,
          'classroomId', classroom_id, 'blueprintId', course_blueprint_id
        ) order by storage_bucket, storage_path)
        from public.managed_storage_objects
      ), '[]'::jsonb)
    );
  `
  const output = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...psqlEnvironment },
  }).trim()
  return z.object({
    physical: z.array(z.object({ bucket: z.string(), path: z.string() })),
    registered: z.array(z.object({
      bucket: z.string(), path: z.string(),
      classroomId: z.string().uuid().nullable(), blueprintId: z.string().uuid().nullable(),
    })),
  }).parse(JSON.parse(output))
}
