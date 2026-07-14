import { z } from 'zod'
import {
  CLASSROOM_RELATIONAL_RESOURCES,
  GRADEX_RESOURCE_TABLES,
  auditClassroomResourceSchema,
  getClassroomResourceOrder,
  type ClassroomResourceTable,
} from '@/lib/contracts/classroom-data'
import {
  canonicalJsonStringify,
  discoverClassroomStorageReferences,
} from '@/lib/server/classroom-archive-format'
import { getServiceRoleClient } from '@/lib/supabase'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import {
  createTargetBoundFetch,
  verifyHostedSupabaseApiOrigin,
} from '@/lib/server/supabase-target'

const uuidSchema = z.string().uuid()
const jsonRowsSchema = z.array(z.record(z.string(), z.json()))
const archivedClassroomsSchema = z.array(z.object({ id: uuidSchema }).strict())
const revisionSchema = z.number().int().positive()

const archiveContractRowSchema = z.object({
  table_name: z.string().min(1),
  primary_key_columns: z.array(z.string().min(1)).min(1),
  parent_table: z.string().min(1).nullable(),
  parent_column: z.string().min(1).nullable(),
  actor_columns: z.array(z.string().min(1)),
  restore_after: z.array(z.string().min(1)),
  export_position: z.number().int().nonnegative(),
}).strict()
const archiveContractSchema = z.array(archiveContractRowSchema)
const gradexContractSchema = z.array(z.object({ table_name: z.string().min(1) }).strict())

const openApiPropertySchema = z.object({ description: z.string().optional() }).passthrough()
const openApiSchema = z.object({
  swagger: z.literal('2.0'),
  definitions: z.record(z.string(), z.object({
    properties: z.record(z.string(), openApiPropertySchema),
  }).passthrough()),
}).passthrough()

const operationalCountsSchema = z.object({
  verified_archives: z.number().int().nonnegative(),
  cold_tombstones: z.number().int().nonnegative(),
  archive_operations: z.number().int().nonnegative(),
  gradex_extracts: z.number().int().nonnegative(),
  source_cleanup_rows: z.number().int().nonnegative(),
}).strict()

const classroomInventorySchema = z.object({
  label: z.string().regex(/^archived-hot-[1-9][0-9]*$/),
  source_revision: revisionSchema,
  relational_row_count: z.number().int().positive(),
  serialized_relational_bytes: z.number().int().positive(),
  storage_object_count: z.number().int().nonnegative(),
  storage_metadata_bytes: z.number().int().nonnegative(),
  estimated_uncompressed_archive_bytes: z.number().int().positive().nullable(),
  missing_storage_object_count: z.number().int().nonnegative(),
  source_objects_present: z.boolean(),
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
}).strict()

const archiveInventorySchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  schema: z.object({
    archive_resource_count: z.literal(42),
    gradex_resource_count: z.literal(13),
    postgrest_schema_audit_passed: z.literal(true),
  }).strict(),
  archived_hot: z.array(classroomInventorySchema),
  totals: z.object({
    archived_hot_count: z.number().int().nonnegative(),
    relational_row_count: z.number().int().nonnegative(),
    serialized_relational_bytes: z.number().int().nonnegative(),
    storage_object_count: z.number().int().nonnegative(),
    storage_metadata_bytes: z.number().int().nonnegative(),
    estimated_uncompressed_archive_bytes: z.number().int().nonnegative().nullable(),
    missing_storage_object_count: z.number().int().nonnegative(),
  }).strict(),
  operations: operationalCountsSchema,
}).strict()

export type ClassroomArchiveInventory = z.infer<typeof archiveInventorySchema>

export type ResourceRead = {
  table: ClassroomResourceTable
  filterColumn: string
  values: string[]
  primaryKey: string
}

export interface ClassroomArchiveInventoryReader {
  readonly supabaseUrl: string
  readOpenApiSchema(): Promise<unknown>
  readArchiveResourceContract(): Promise<unknown>
  readGradexResourceContract(): Promise<unknown>
  readArchivedClassrooms(): Promise<unknown>
  readRevision(classroomId: string): Promise<unknown>
  readResourceRows(query: ResourceRead): Promise<unknown>
  readStorageObjectSize(bucket: string, path: string): Promise<unknown>
  readOperationalCounts(): Promise<unknown>
}

export function verifySupabaseInventoryTarget(
  supabaseUrl: string,
  expectedProjectRef: string,
): string {
  return verifyHostedSupabaseApiOrigin(supabaseUrl, expectedProjectRef)
}

export function assertInventorySourceObjectsPresent(inventory: ClassroomArchiveInventory): void {
  if (inventory.totals.missing_storage_object_count > 0) {
    throw new Error(
      `Read-only inventory found ${inventory.totals.missing_storage_object_count} missing source objects`,
    )
  }
}

export async function collectExactReadPages<T>(
  readPage: (offset: number, requestedPageSize: number) => Promise<{
    rows: T[]
    count: number
  }>,
  requestedPageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let expectedCount: number | null = null
  while (expectedCount === null || rows.length < expectedCount) {
    const page = await readPage(rows.length, requestedPageSize)
    const count = z.number().int().nonnegative().parse(page.count)
    if (expectedCount === null) expectedCount = count
    if (count !== expectedCount) throw new Error('Exact count changed during paginated read')
    if (page.rows.length === 0) {
      if (rows.length === expectedCount) break
      throw new Error('Paginated read ended before its exact count')
    }
    rows.push(...page.rows)
    if (rows.length > expectedCount) throw new Error('Paginated read exceeded its exact count')
  }
  return rows
}

function expectedArchiveContract() {
  const resources = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, resource]),
  )
  return getClassroomResourceOrder('export').map((table, exportPosition) => {
    const resource = resources.get(table)
    if (!resource) throw new Error('Classroom archive resource order is invalid')
    return {
      table_name: table,
      primary_key_columns: [...resource.primary_key],
      parent_table: resource.scope.kind === 'foreign_key' ? resource.scope.parent : null,
      parent_column: resource.scope.kind === 'foreign_key' ? resource.scope.column : null,
      actor_columns: [...resource.actor_columns],
      restore_after: [...resource.restore_after],
      export_position: exportPosition,
    }
  })
}

export function verifyRemoteClassroomContracts(
  archiveContract: unknown,
  gradexContract: unknown,
): void {
  const actualArchive = archiveContractSchema.parse(archiveContract)
  const actualGradex = gradexContractSchema.parse(gradexContract)
  if (canonicalJsonStringify(actualArchive) !== canonicalJsonStringify(expectedArchiveContract())) {
    throw new Error('Remote archive resource contract does not match the checked-in contract')
  }
  const expectedGradex = GRADEX_RESOURCE_TABLES.map((table) => ({ table_name: table }))
  if (canonicalJsonStringify(actualGradex) !== canonicalJsonStringify(expectedGradex)) {
    throw new Error('Remote Gradex resource contract does not match the checked-in contract')
  }
}

export function auditClassroomOpenApiSchema(document: unknown) {
  const parsed = openApiSchema.parse(document)
  const relationships: Array<{
    child_table: string
    parent_table: string
    child_columns: string[]
  }> = []
  const primaryKeys: Array<{ table_name: string; columns: string[] }> = []

  for (const [table, definition] of Object.entries(parsed.definitions)) {
    const keyColumns: string[] = []
    for (const [column, property] of Object.entries(definition.properties)) {
      const description = property.description || ''
      if (description.includes('<pk/>')) keyColumns.push(column)
      for (const match of description.matchAll(/<fk table='([^']+)' column='([^']+)'\/>/g)) {
        relationships.push({
          child_table: table,
          parent_table: match[1],
          child_columns: [column],
        })
      }
    }
    if (keyColumns.length > 0) primaryKeys.push({ table_name: table, columns: keyColumns })
  }
  return auditClassroomResourceSchema(relationships, primaryKeys)
}

function comparePrimaryKey(left: Record<string, unknown>, right: Record<string, unknown>, key: string) {
  const leftValue = String(left[key])
  const rightValue = String(right[key])
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

async function readClassroomResources(
  reader: ClassroomArchiveInventoryReader,
  classroomId: string,
) {
  const resources: Record<string, Array<Record<string, unknown>>> = {}
  const contractByTable = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, resource]),
  )
  for (const table of getClassroomResourceOrder('export')) {
    const resource = contractByTable.get(table)
    if (!resource || resource.primary_key.length !== 1) {
      throw new Error(`Inventory adapter is unavailable for classroom resource ${table}`)
    }
    const primaryKey = resource.primary_key[0]
    let filterColumn = primaryKey
    let values = [classroomId]
    if (resource.scope.kind === 'foreign_key') {
      filterColumn = resource.scope.column
      const parent = contractByTable.get(resource.scope.parent as ClassroomResourceTable)
      if (!parent || parent.primary_key.length !== 1) {
        throw new Error(`Inventory parent adapter is unavailable for classroom resource ${table}`)
      }
      values = (resources[resource.scope.parent] || []).map((row) => {
        const value = row[parent.primary_key[0]]
        if (typeof value !== 'string') {
          throw new Error(`Inventory parent key is invalid for classroom resource ${table}`)
        }
        return value
      })
    }
    const rows = values.length === 0
      ? []
      : jsonRowsSchema.parse(await reader.readResourceRows({
          table,
          filterColumn,
          values,
          primaryKey,
        }))
    const uniqueKeys = new Set(rows.map((row) => String(row[primaryKey])))
    if (uniqueKeys.size !== rows.length || rows.some((row) => typeof row[primaryKey] !== 'string')) {
      throw new Error(`Inventory returned invalid primary keys for classroom resource ${table}`)
    }
    resources[table] = rows.sort((left, right) => comparePrimaryKey(left, right, primaryKey))
  }
  return resources
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return results
}

class ArchiveSetDriftError extends Error {}

async function readStableClassroomInventory(
  reader: ClassroomArchiveInventoryReader,
  classroomId: string,
  label: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const revisionBefore = revisionSchema.parse(await reader.readRevision(classroomId))
    const resources = await readClassroomResources(reader, classroomId)
    const classroomRows = resources.classrooms || []
    if (
      classroomRows.length !== 1 ||
      typeof classroomRows[0].archived_at !== 'string' ||
      classroomRows[0].archived_at.length === 0
    ) {
      throw new ArchiveSetDriftError('Archived classroom root changed during inventory')
    }
    const references = discoverClassroomStorageReferences(
      resources,
      reader.supabaseUrl,
    )
    const sizes = await mapWithConcurrency(references, 4, async (reference) => {
      const value = await reader.readStorageObjectSize(reference.bucket, reference.path)
      return value === null ? null : z.number().int().nonnegative().parse(value)
    })
    const revisionAfter = revisionSchema.parse(await reader.readRevision(classroomId))
    if (revisionBefore !== revisionAfter) continue

    const resourceCounts: Record<string, number> = {}
    let relationalRowCount = 0
    let serializedRelationalBytes = 0
    for (const resource of CLASSROOM_RELATIONAL_RESOURCES) {
      const rows = resources[resource.table] || []
      resourceCounts[resource.table] = rows.length
      relationalRowCount += rows.length
      for (const row of rows) {
        serializedRelationalBytes += Buffer.byteLength(`${canonicalJsonStringify(row)}\n`, 'utf8')
      }
    }
    const missingStorageObjectCount = sizes.filter((size) => size === null).length
    let storageMetadataBytes = 0
    for (const size of sizes) storageMetadataBytes += size || 0
    return classroomInventorySchema.parse({
      label,
      source_revision: revisionAfter,
      relational_row_count: relationalRowCount,
      serialized_relational_bytes: serializedRelationalBytes,
      storage_object_count: references.length,
      storage_metadata_bytes: storageMetadataBytes,
      estimated_uncompressed_archive_bytes: missingStorageObjectCount === 0
        ? serializedRelationalBytes + storageMetadataBytes
        : null,
      missing_storage_object_count: missingStorageObjectCount,
      source_objects_present: missingStorageObjectCount === 0,
      resource_counts: resourceCounts,
    })
  }
  throw new Error(`Archived classroom ${label} did not stabilize during read-only inventory`)
}

export async function inventoryArchivedClassrooms(
  reader: ClassroomArchiveInventoryReader,
): Promise<ClassroomArchiveInventory> {
  const [openApi, archiveContract, gradexContract] = await Promise.all([
    reader.readOpenApiSchema(),
    reader.readArchiveResourceContract(),
    reader.readGradexResourceContract(),
  ])
  verifyRemoteClassroomContracts(archiveContract, gradexContract)
  const catalogAudit = auditClassroomOpenApiSchema(openApi)
  if (!catalogAudit.ok) throw new Error('Remote classroom catalog does not match the checked-in contract')

  let archivedHot: Array<z.infer<typeof classroomInventorySchema>> | null = null
  let operationalCounts: z.infer<typeof operationalCountsSchema> | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const operationsBefore = operationalCountsSchema.parse(await reader.readOperationalCounts())
    const archivedBefore = archivedClassroomsSchema.parse(await reader.readArchivedClassrooms())
    const snapshot: Array<z.infer<typeof classroomInventorySchema>> = []
    try {
      for (const [index, classroom] of archivedBefore.entries()) {
        snapshot.push(await readStableClassroomInventory(
          reader,
          classroom.id,
          `archived-hot-${index + 1}`,
        ))
      }
    } catch (error) {
      if (error instanceof ArchiveSetDriftError) continue
      throw error
    }
    const archivedAfter = archivedClassroomsSchema.parse(await reader.readArchivedClassrooms())
    const operationsAfter = operationalCountsSchema.parse(await reader.readOperationalCounts())
    if (
      canonicalJsonStringify(archivedBefore) !== canonicalJsonStringify(archivedAfter) ||
      canonicalJsonStringify(operationsBefore) !== canonicalJsonStringify(operationsAfter)
    ) continue
    archivedHot = snapshot
    operationalCounts = operationsAfter
    break
  }
  if (!archivedHot || !operationalCounts) {
    throw new Error('Archived classroom set did not stabilize across the full inventory')
  }
  return archiveInventorySchema.parse({
    generated_at: new Date().toISOString(),
    schema: {
      archive_resource_count: CLASSROOM_RELATIONAL_RESOURCES.length,
      gradex_resource_count: GRADEX_RESOURCE_TABLES.length,
      postgrest_schema_audit_passed: true,
    },
    archived_hot: archivedHot,
    totals: {
      archived_hot_count: archivedHot.length,
      relational_row_count: archivedHot.reduce((total, item) => total + item.relational_row_count, 0),
      serialized_relational_bytes: archivedHot.reduce(
        (total, item) => total + item.serialized_relational_bytes,
        0,
      ),
      storage_object_count: archivedHot.reduce((total, item) => total + item.storage_object_count, 0),
      storage_metadata_bytes: archivedHot.reduce(
        (total, item) => total + item.storage_metadata_bytes,
        0,
      ),
      estimated_uncompressed_archive_bytes: archivedHot.every(
        (item) => item.estimated_uncompressed_archive_bytes !== null,
      )
        ? archivedHot.reduce(
            (total, item) => total + (item.estimated_uncompressed_archive_bytes || 0),
            0,
          )
        : null,
      missing_storage_object_count: archivedHot.reduce(
        (total, item) => total + item.missing_storage_object_count,
        0,
      ),
    },
    operations: operationalCounts,
  })
}

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

function throwReadError(resource: string, error: unknown) {
  if (!error) return
  const code = typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown'
  throw new Error(`Read-only inventory failed for ${resource} (${code})`)
}

export function createSupabaseClassroomArchiveInventoryReader(args: {
  supabase: SupabaseClient
  supabaseUrl: string
  secretKey: string
  fetchImpl?: typeof fetch
}): ClassroomArchiveInventoryReader {
  const expectedOrigin = new URL(args.supabaseUrl).origin
  const fetchImpl = createTargetBoundFetch(expectedOrigin, args.fetchImpl || fetch)
  return {
    supabaseUrl: expectedOrigin,
    async readOpenApiSchema() {
      const response = await fetchImpl(`${expectedOrigin}/rest/v1/`, {
        headers: {
          apikey: args.secretKey,
          Authorization: `Bearer ${args.secretKey}`,
          Accept: 'application/openapi+json',
        },
      })
      if (!response.ok) throw new Error(`Read-only inventory failed for PostgREST schema (${response.status})`)
      return response.json()
    },
    async readArchiveResourceContract() {
      return collectExactReadPages(async (offset, requestedPageSize) => {
        const { data, error, count } = await args.supabase
          .from('classroom_archive_resource_contract')
          .select(
            'table_name,primary_key_columns,parent_table,parent_column,actor_columns,restore_after,export_position',
            { count: 'exact' },
          )
          .order('export_position', { ascending: true })
          .range(offset, offset + requestedPageSize - 1)
        throwReadError('archive resource contract', error)
        return {
          rows: archiveContractSchema.parse(data),
          count: z.number().int().nonnegative().parse(count),
        }
      })
    },
    async readGradexResourceContract() {
      return collectExactReadPages(async (offset, requestedPageSize) => {
        const { data, error, count } = await args.supabase
          .from('classroom_gradex_resource_contract')
          .select('table_name', { count: 'exact' })
          .order('table_name', { ascending: true })
          .range(offset, offset + requestedPageSize - 1)
        throwReadError('Gradex resource contract', error)
        return {
          rows: gradexContractSchema.parse(data),
          count: z.number().int().nonnegative().parse(count),
        }
      })
    },
    async readArchivedClassrooms() {
      const readSnapshot = async () => {
        return collectExactReadPages(async (offset, requestedPageSize) => {
          const { data, error, count } = await args.supabase
            .from('classrooms')
            .select('id', { count: 'exact' })
            .not('archived_at', 'is', null)
            .order('id', { ascending: true })
            .range(offset, offset + requestedPageSize - 1)
          throwReadError('archived classrooms', error)
          return {
            rows: archivedClassroomsSchema.parse(data),
            count: z.number().int().nonnegative().parse(count),
          }
        })
      }
      const first = await readSnapshot()
      const second = await readSnapshot()
      if (canonicalJsonStringify(first) === canonicalJsonStringify(second)) return second
      const third = await readSnapshot()
      if (canonicalJsonStringify(second) === canonicalJsonStringify(third)) return third
      throw new Error('Archived classroom list did not stabilize during read-only inventory')
    },
    async readRevision(classroomId) {
      const { data, error } = await args.supabase
        .from('classroom_archive_revisions')
        .select('revision')
        .eq('classroom_id', classroomId)
        .single()
      throwReadError('classroom archive revision', error)
      return data?.revision
    },
    async readResourceRows({ table, filterColumn, values, primaryKey }) {
      const rows: unknown[] = []
      const valueChunkSize = 100
      for (let valueOffset = 0; valueOffset < values.length; valueOffset += valueChunkSize) {
        const chunk = values.slice(valueOffset, valueOffset + valueChunkSize)
        const chunkRows = await collectExactReadPages(async (offset, requestedPageSize) => {
          const query = args.supabase.from(table).select('*', { count: 'exact' }) as unknown as {
            in(column: string, filterValues: string[]): {
              order(column: string, options: { ascending: boolean }): {
                range(from: number, to: number): PromiseLike<{
                  data: unknown
                  error: { code?: string } | null
                  count: number | null
                }>
              }
            }
          }
          const { data, error, count } = await query
            .in(filterColumn, chunk)
            .order(primaryKey, { ascending: true })
            .range(offset, offset + requestedPageSize - 1)
          throwReadError(table, error)
          return {
            rows: jsonRowsSchema.parse(data),
            count: z.number().int().nonnegative().parse(count),
          }
        })
        rows.push(...chunkRows)
      }
      return rows
    },
    async readStorageObjectSize(bucket, path) {
      const { data, error } = await args.supabase.storage
        .from(bucket)
        .info(path)
      if (error && missingStorageObjectEvidence(error)) return null
      throwReadError('managed storage metadata', error)
      return z.number().int().nonnegative().parse(data?.size)
    },
    async readOperationalCounts() {
      type OperationalTable =
        | 'classroom_archives'
        | 'classroom_cold_tombstones'
        | 'classroom_archive_operations'
        | 'classroom_gradex_extracts'
        | 'classroom_archive_source_object_cleanup'
      const count = async (table: OperationalTable) => {
        const { count: value, error } = await args.supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
        throwReadError(table, error)
        return z.number().int().nonnegative().parse(value)
      }
      const [verifiedArchives, coldTombstones, archiveOperations, gradexExtracts, pendingCleanup] =
        await Promise.all([
          count('classroom_archives'),
          count('classroom_cold_tombstones'),
          count('classroom_archive_operations'),
          count('classroom_gradex_extracts'),
          count('classroom_archive_source_object_cleanup'),
        ])
      return {
        verified_archives: verifiedArchives,
        cold_tombstones: coldTombstones,
        archive_operations: archiveOperations,
        gradex_extracts: gradexExtracts,
        source_cleanup_rows: pendingCleanup,
      }
    },
  }
}
