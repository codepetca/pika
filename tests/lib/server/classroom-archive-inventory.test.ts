import {
  assertInventorySourceObjectsPresent,
  auditClassroomOpenApiSchema,
  collectExactReadPages,
  createSupabaseClassroomArchiveInventoryReader,
  inventoryArchivedClassrooms,
  verifySupabaseInventoryTarget,
  verifyRemoteClassroomContracts,
  type ClassroomArchiveInventoryReader,
} from '@/lib/server/classroom-archive-inventory'
import {
  CLASSROOM_RELATIONAL_RESOURCES,
  GRADEX_RESOURCE_TABLES,
  getClassroomResourceOrder,
} from '@/lib/contracts/classroom-data'
import {
  createTargetBoundFetch,
  hostedSupabasePsqlEnvironment,
  localSupabasePsqlEnvironment,
  verifyHostedSupabaseDatabaseUrl,
} from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

const CLASSROOM_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'

function remoteArchiveContract() {
  const resources = new Map(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, resource]),
  )
  return getClassroomResourceOrder('export').map((table, exportPosition) => {
    const resource = resources.get(table)!
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

function openApiDocument() {
  const definitions: Record<string, { properties: Record<string, { description?: string }> }> = {}
  for (const resource of CLASSROOM_RELATIONAL_RESOURCES) {
    const properties: Record<string, { description?: string }> = {}
    for (const column of resource.primary_key) {
      properties[column] = { description: 'Note:\nThis is a Primary Key.<pk/>' }
    }
    if (resource.scope.kind === 'foreign_key') {
      properties[resource.scope.column] = {
        description: `${properties[resource.scope.column]?.description || 'Note:'}\nThis is a Foreign Key.<fk table='${resource.scope.parent}' column='id'/>`,
      }
    }
    for (const column of resource.actor_columns) {
      properties[column] = {
        description: `${properties[column]?.description || 'Note:'}\nThis is a Foreign Key.<fk table='users' column='id'/>`,
      }
    }
    definitions[resource.table] = { properties }
  }
  definitions.users = {
    properties: { id: { description: 'Note:\nThis is a Primary Key.<pk/>' } },
  }
  return { swagger: '2.0', definitions }
}

function reader(overrides: Partial<ClassroomArchiveInventoryReader> = {}): ClassroomArchiveInventoryReader {
  let revisionReads = 0
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
    classrooms: [{ id: CLASSROOM_ID, archived_at: '2026-07-01T00:00:00Z' }],
    assignments: [{
      id: ASSIGNMENT_ID,
      classroom_id: CLASSROOM_ID,
      title: 'Private title must not appear in output',
      description: 'http://inventory.invalid/storage/v1/object/public/submission-images/private/image.png',
    }],
    assignment_docs: [{
      id: '44444444-4444-4444-8444-444444444444',
      assignment_id: ASSIGNMENT_ID,
      student_id: '55555555-5555-4555-8555-555555555555',
    }],
    assignment_submission_artifacts: [{
      id: '33333333-3333-4333-8333-333333333333',
      assignment_doc_id: '44444444-4444-4444-8444-444444444444',
      storage_path: 'private/source.bin',
    }],
  }

  return {
    supabaseUrl: 'http://inventory.invalid',
    readOpenApiSchema: async () => openApiDocument(),
    readArchiveResourceContract: async () => remoteArchiveContract(),
    readGradexResourceContract: async () => GRADEX_RESOURCE_TABLES.map((table) => ({ table_name: table })),
    readArchivedClassrooms: async () => [{ id: CLASSROOM_ID }],
    readRevision: async () => {
      revisionReads += 1
      return revisionReads <= 2 ? 7 : 8
    },
    readResourceRows: async ({ table, values }) => {
      if (values.length === 0) return []
      return rowsByTable[table] || []
    },
    readStorageObjectSize: async () => 17,
    readOperationalCounts: async () => ({
      verified_archives: 0,
      cold_tombstones: 0,
      archive_operations: 0,
      gradex_extracts: 0,
      source_cleanup_rows: 0,
    }),
    ...overrides,
  }
}

describe('classroom archive production inventory', () => {
  it('continues exact-count pagination when the server returns less than requested', async () => {
    const source = ['a', 'b', 'c', 'd', 'e']
    const reads: number[] = []
    const rows = await collectExactReadPages(async (offset) => {
      reads.push(offset)
      return { rows: source.slice(offset, offset + 2), count: source.length }
    })

    expect(rows).toEqual(source)
    expect(reads).toEqual([0, 2, 4])
  })

  it('rejects truncated and count-changing pagination', async () => {
    await expect(collectExactReadPages(async () => ({ rows: [], count: 1 })))
      .rejects.toThrow('ended before')
    let reads = 0
    await expect(collectExactReadPages(async () => {
      reads += 1
      return reads === 1
        ? { rows: ['a'], count: 2 }
        : { rows: ['b'], count: 3 }
    })).rejects.toThrow('count changed')
  })

  it('paginates both deployed resource contracts through exact counts', async () => {
    const archiveRows = remoteArchiveContract()
    const gradexRows = GRADEX_RESOURCE_TABLES.map((table) => ({ table_name: table }))
    const ranges: Array<{ table: string; from: number }> = []
    const rowsByTable: Record<string, unknown[]> = {
      classroom_archive_resource_contract: archiveRows,
      classroom_gradex_resource_contract: gradexRows,
    }
    const supabase = {
      from(table: string) {
        return {
          select(_columns: string, options: { count: string }) {
            expect(options).toEqual({ count: 'exact' })
            return {
              order() {
                return {
                  range(from: number, to: number) {
                    ranges.push({ table, from })
                    const rows = rowsByTable[table]
                    const cappedTo = Math.min(to + 1, from + 5)
                    return Promise.resolve({
                      data: rows.slice(from, cappedTo),
                      error: null,
                      count: rows.length,
                    })
                  },
                }
              },
            }
          },
        }
      },
    } as unknown as Parameters<typeof createSupabaseClassroomArchiveInventoryReader>[0]['supabase']
    const inventoryReader = createSupabaseClassroomArchiveInventoryReader({
      supabase,
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      secretKey: 'secret',
    })

    await expect(inventoryReader.readArchiveResourceContract()).resolves.toEqual(archiveRows)
    await expect(inventoryReader.readGradexResourceContract()).resolves.toEqual(gradexRows)
    expect(ranges.filter(({ table }) => table === 'classroom_archive_resource_contract'))
      .toHaveLength(9)
    expect(ranges.filter(({ table }) => table === 'classroom_gradex_resource_contract'))
      .toHaveLength(3)
  })

  it('requires the expected hosted Supabase project target', () => {
    expect(verifySupabaseInventoryTarget(
      'https://abcdefghijklmnopqrst.supabase.co',
      'abcdefghijklmnopqrst',
    )).toBe('https://abcdefghijklmnopqrst.supabase.co')
    expect(() => verifySupabaseInventoryTarget(
      'https://wrongprojectrefxxxxx.supabase.co',
      'abcdefghijklmnopqrst',
    )).toThrow('does not match')
    for (const invalidUrl of [
      'http://abcdefghijklmnopqrst.supabase.co',
      'https://abcdefghijklmnopqrst.supabase.co:444',
      'https://user:password@abcdefghijklmnopqrst.supabase.co',
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1',
      'https://abcdefghijklmnopqrst.supabase.co?target=other',
      'https://abcdefghijklmnopqrst.supabase.co#other',
    ]) {
      expect(() => verifySupabaseInventoryTarget(
        invalidUrl,
        'abcdefghijklmnopqrst',
      )).toThrow('does not match')
    }
  })

  it('rejects redirects and off-origin requests before service credentials can escape', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: 'https://attacker.invalid/collect' },
    }))
    const targetFetch = createTargetBoundFetch(
      'https://abcdefghijklmnopqrst.supabase.co',
      fetchImpl as unknown as typeof fetch,
    )

    await expect(targetFetch(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
      { headers: { apikey: 'secret' } },
    )).rejects.toThrow('redirect was rejected')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
      expect.objectContaining({ redirect: 'manual' }),
    )

    fetchImpl.mockClear()
    await expect(targetFetch(
      'https://attacker.invalid/collect',
      { headers: { apikey: 'secret' } },
    )).rejects.toThrow('escaped the validated project origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects redirects through the concrete OpenAPI reader path', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.invalid/collect' },
    }))
    const inventoryReader = createSupabaseClassroomArchiveInventoryReader({
      supabase: {} as Parameters<typeof createSupabaseClassroomArchiveInventoryReader>[0]['supabase'],
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      secretKey: 'service-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(inventoryReader.readOpenApiSchema()).rejects.toThrow('redirect was rejected')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({ apikey: 'service-secret' }),
      }),
    )
  })

  it('rejects redirects through a concrete Supabase SDK request', async () => {
    const original = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: process.env.SUPABASE_SECRET_KEY,
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key'
    process.env.SUPABASE_SECRET_KEY = 'service-secret'
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: 'https://attacker.invalid/collect' },
    }))

    try {
      const client = getServiceRoleClient({
        fetch: createTargetBoundFetch(
          'https://abcdefghijklmnopqrst.supabase.co',
          fetchImpl as unknown as typeof fetch,
        ),
      })
      const { error } = await client.from('classrooms').select('id')

      expect(error).not.toBeNull()
      expect(fetchImpl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ redirect: 'manual' }),
      )
    } finally {
      if (original.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = original.url
      if (original.publishableKey === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      } else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = original.publishableKey
      if (original.secretKey === undefined) delete process.env.SUPABASE_SECRET_KEY
      else process.env.SUPABASE_SECRET_KEY = original.secretKey
    }
  })

  it('binds direct catalog audit URLs to the expected hosted project with TLS', () => {
    expect(verifyHostedSupabaseDatabaseUrl(
      'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=verify-full',
      'abcdefghijklmnopqrst',
    )).toBe('abcdefghijklmnopqrst')
    expect(verifyHostedSupabaseDatabaseUrl(
      'postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?sslmode=require',
      'abcdefghijklmnopqrst',
    )).toBe('abcdefghijklmnopqrst')
    for (const invalidUrl of [
      'postgresql://postgres:secret@db.wrongprojectrefxxxxx.supabase.co:5432/postgres?sslmode=require',
      'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
      'postgresql://postgres:secret@localhost:5432/postgres?sslmode=require',
      'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require&hostaddr=127.0.0.1',
      'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require&sslmode=disable',
    ]) {
      expect(() => verifyHostedSupabaseDatabaseUrl(
        invalidUrl,
        'abcdefghijklmnopqrst',
      )).toThrow('does not match')
    }
    expect(hostedSupabasePsqlEnvironment(
      'postgresql://postgres:sentinel-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require',
      'abcdefghijklmnopqrst',
    )).toEqual({
      PGHOST: 'db.abcdefghijklmnopqrst.supabase.co',
      PGPORT: '5432',
      PGUSER: 'postgres',
      PGPASSWORD: 'sentinel-password',
      PGDATABASE: 'postgres',
      PGSSLMODE: 'require',
    })
    expect(localSupabasePsqlEnvironment(
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    )).toMatchObject({ PGHOST: '127.0.0.1', PGPORT: '54322', PGSSLMODE: 'disable' })
    expect(() => localSupabasePsqlEnvironment(
      'postgresql://postgres:postgres@staging.example.com:5432/postgres',
    )).toThrow('loopback')
  })

  it('accepts the exact checked-in archive and Gradex database contracts', () => {
    expect(() => verifyRemoteClassroomContracts(
      remoteArchiveContract(),
      GRADEX_RESOURCE_TABLES.map((table) => ({ table_name: table })),
    )).not.toThrow()
  })

  it('rejects remote contract drift', () => {
    const contract = remoteArchiveContract()
    contract[0] = { ...contract[0], actor_columns: [] }

    expect(() => verifyRemoteClassroomContracts(
      contract,
      GRADEX_RESOURCE_TABLES.map((table) => ({ table_name: table })),
    )).toThrow('archive resource contract does not match')
  })

  it('audits primary keys and foreign keys from the validated PostgREST schema', () => {
    expect(auditClassroomOpenApiSchema(openApiDocument())).toMatchObject({ ok: true })
  })

  it('fails the catalog audit when a classroom descendant is untracked', () => {
    const document = openApiDocument()
    document.definitions.untracked_child = {
      properties: {
        id: { description: 'Note:\nThis is a Primary Key.<pk/>' },
        classroom_id: {
          description: "Note:\nThis is a Foreign Key.<fk table='classrooms' column='id'/>",
        },
      },
    }

    expect(auditClassroomOpenApiSchema(document)).toMatchObject({
      ok: false,
      untracked_tables: ['untracked_child'],
    })
  })

  it('reports stable aggregate inventory without classroom ids or source content', async () => {
    const result = await inventoryArchivedClassrooms(reader())
    const serialized = JSON.stringify(result)

    expect(result.schema).toEqual({
      archive_resource_count: 42,
      gradex_resource_count: 13,
      postgrest_schema_audit_passed: true,
    })
    expect(result.archived_hot).toHaveLength(1)
    expect(result.archived_hot[0]).toMatchObject({
      label: 'archived-hot-1',
      source_revision: 7,
      storage_object_count: 2,
      storage_metadata_bytes: 34,
      source_objects_present: true,
      missing_storage_object_count: 0,
    })
    expect(result.archived_hot[0].relational_row_count).toBeGreaterThanOrEqual(2)
    expect(result.archived_hot[0].serialized_relational_bytes).toBeGreaterThan(0)
    expect(result.archived_hot[0].estimated_uncompressed_archive_bytes).toBe(
      result.archived_hot[0].serialized_relational_bytes + 34,
    )
    expect(serialized).not.toContain(CLASSROOM_ID)
    expect(serialized).not.toContain('Private title')
    expect(serialized).not.toContain('private/source.bin')
  })

  it('retries one complete classroom read when the source revision moves', async () => {
    const revisions = [7, 8, 8, 8]
    const readResourceRows = vi.fn(reader().readResourceRows)
    const result = await inventoryArchivedClassrooms(reader({
      readRevision: async () => revisions.shift()!,
      readResourceRows,
    }))

    expect(result.archived_hot[0].source_revision).toBe(8)
    expect(readResourceRows.mock.calls.filter(([call]) => call.table === 'classrooms')).toHaveLength(2)
  })

  it('fails closed when the source revision changes twice', async () => {
    const revisions = [7, 8, 9, 10]
    await expect(inventoryArchivedClassrooms(reader({
      readRevision: async () => revisions.shift()!,
    }))).rejects.toThrow('did not stabilize')
  })

  it('retries the whole inventory when the archived classroom set changes', async () => {
    const archivedSets = [
      [{ id: CLASSROOM_ID }],
      [],
      [],
      [],
    ]
    const readArchivedClassrooms = vi.fn(async () => archivedSets.shift()!)
    const result = await inventoryArchivedClassrooms(reader({ readArchivedClassrooms }))

    expect(result.archived_hot).toEqual([])
    expect(readArchivedClassrooms).toHaveBeenCalledTimes(4)
  })

  it('fails closed when the archived classroom set changes across both full scans', async () => {
    const archivedSets = [
      [{ id: CLASSROOM_ID }],
      [],
      [{ id: CLASSROOM_ID }],
      [],
    ]
    await expect(inventoryArchivedClassrooms(reader({
      readArchivedClassrooms: async () => archivedSets.shift()!,
    }))).rejects.toThrow('did not stabilize across the full inventory')
  })

  it('retries the whole inventory when the selected classroom root becomes active', async () => {
    const base = reader()
    let classroomReads = 0
    const result = await inventoryArchivedClassrooms({
      ...base,
      readRevision: async () => 7,
      readResourceRows: async (query) => {
        if (query.table !== 'classrooms') return base.readResourceRows(query)
        classroomReads += 1
        if (classroomReads === 1) return [{ id: CLASSROOM_ID, archived_at: null }]
        return base.readResourceRows(query)
      },
    })

    expect(result.archived_hot).toHaveLength(1)
    expect(classroomReads).toBe(2)
  })

  it('fails closed when the selected classroom root is active across both scans', async () => {
    const base = reader()
    await expect(inventoryArchivedClassrooms({
      ...base,
      readResourceRows: async (query) => query.table === 'classrooms'
        ? [{ id: CLASSROOM_ID, archived_at: null }]
        : base.readResourceRows(query),
    })).rejects.toThrow('did not stabilize across the full inventory')
  })

  it('retries the whole inventory when operational counts change during a scan', async () => {
    const counts = [0, 1, 1, 1]
    const readOperationalCounts = vi.fn(async () => ({
      verified_archives: counts.shift()!,
      cold_tombstones: 0,
      archive_operations: 0,
      gradex_extracts: 0,
      source_cleanup_rows: 0,
    }))
    const result = await inventoryArchivedClassrooms(reader({ readOperationalCounts }))

    expect(result.operations.verified_archives).toBe(1)
    expect(readOperationalCounts).toHaveBeenCalledTimes(4)
  })

  it('reports when a managed source object is missing', async () => {
    const result = await inventoryArchivedClassrooms(reader({
      readStorageObjectSize: async () => null,
    }))

    expect(result.archived_hot[0]).toMatchObject({
      source_objects_present: false,
      missing_storage_object_count: 2,
      storage_metadata_bytes: 0,
      estimated_uncompressed_archive_bytes: null,
    })
    expect(result.totals.estimated_uncompressed_archive_bytes).toBeNull()
    expect(() => assertInventorySourceObjectsPresent(result)).toThrow('2 missing source objects')
  })

  it('rejects malformed data returned by the read boundary', async () => {
    await expect(inventoryArchivedClassrooms(reader({
      readArchivedClassrooms: async () => [{ id: 'not-a-uuid' }],
    }))).rejects.toThrow()
  })
})
