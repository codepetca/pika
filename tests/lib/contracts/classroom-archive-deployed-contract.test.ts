import { describe, expect, it } from 'vitest'
import { CLASSROOM_ARCHIVE_V2_RESOURCES, resolveClassroomArchiveV2Resources } from '@/lib/contracts/classroom-archive-resources'

const tables = CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => resource.table)
describe('deployed archive contracts', () => {
  it('accepts only the full contract and the pre157 contract', () => {
    expect(resolveClassroomArchiveV2Resources(tables)).toHaveLength(tables.length)
    expect(resolveClassroomArchiveV2Resources(tables.filter((table) => table !== 'gradebook_score_overrides'))).toHaveLength(tables.length - 1)
    expect(() => resolveClassroomArchiveV2Resources(tables.filter((table) => table !== 'assignments'))).toThrow()
    expect(() => resolveClassroomArchiveV2Resources([...tables, 'unknown'])).toThrow()
    expect(() => resolveClassroomArchiveV2Resources([...tables, tables[0]])).toThrow()
  })
})

it.each([
  { error: { code: '42P01' }, count: tables.length },
  { error: null, count: tables.length + 1 },
])('rejects failed or truncated deployed contract reads: $error / $count', async ({ error, count }) => {
  const { readDeployedClassroomArchiveResources } = await import('@/lib/server/classroom-archive-deployed-contract')
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: async () => ({ data: tables.map((table_name) => ({ table_name })), error, count }),
  }
  await expect(readDeployedClassroomArchiveResources({ from: () => query } as never)).rejects.toThrow()
})
