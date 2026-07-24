import { describe, expect, it, vi } from 'vitest'
import { chunkValues, loadChunkedRows } from '@/lib/server/query-chunks'

describe('query chunk helpers', () => {
  it('chunks values into fixed-size slices', () => {
    expect(chunkValues(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ])
  })

  it('loads rows across chunked filters and paginated pages', async () => {
    const inCalls: Array<{ column: string; values: string[] }> = []
    const rangeCalls: Array<{ from: number; to: number }> = []
    const orderCalls: string[] = []
    const rows = [
      { id: '1', test_id: 'test-1', student_id: 'student-1' },
      { id: '2', test_id: 'test-1', student_id: 'student-2' },
      { id: '3', test_id: 'test-2', student_id: 'student-1' },
      { id: '4', test_id: 'test-2', student_id: 'student-2' },
      { id: '5', test_id: 'test-3', student_id: 'student-3' },
    ]

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          let selectedTestIds: string[] = []
          const query: any = {
            in: vi.fn((column: string, values: string[]) => {
              inCalls.push({ column, values })
              if (column === 'test_id') {
                selectedTestIds = values
                return query
              }

              if (column === 'student_id') {
                const filtered = rows.filter(
                  (row) => selectedTestIds.includes(row.test_id) && values.includes(row.student_id),
                )
                const pageQuery: any = {
                  order: vi.fn((orderColumn: string) => {
                    orderCalls.push(orderColumn)
                    return pageQuery
                  }),
                  range: vi.fn((from: number, to: number) => {
                    rangeCalls.push({ from, to })
                    return Promise.resolve({
                      data: filtered.slice(from, to + 1),
                      error: null,
                    })
                  }),
                }
                return pageQuery
              }

              return query
            }),
          }
          return query
        }),
      })),
    }

    const result = await loadChunkedRows<{ id: string; test_id: string; student_id: string }>({
      supabase,
      table: 'test_responses',
      select: 'id, test_id, student_id',
      filters: [
        { column: 'test_id', values: ['test-1', 'test-2', 'test-3'] },
        { column: 'student_id', values: ['student-1', 'student-2', 'student-3'] },
      ],
      chunkSize: 2,
      pageSize: 2,
    })

    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(5)
    const testCalls = inCalls.filter((call) => call.column === 'test_id')
    const studentCalls = inCalls.filter((call) => call.column === 'student_id')

    expect(testCalls.length).toBeGreaterThanOrEqual(4)
    expect(testCalls).toEqual(
      expect.arrayContaining([
        { column: 'test_id', values: ['test-1', 'test-2'] },
        { column: 'test_id', values: ['test-3'] },
      ]),
    )
    expect(studentCalls.length).toBeGreaterThanOrEqual(4)
    expect(studentCalls).toEqual(
      expect.arrayContaining([
        { column: 'student_id', values: ['student-1', 'student-2'] },
        { column: 'student_id', values: ['student-3'] },
      ]),
    )
    expect(orderCalls.every((column) => column === 'id')).toBe(true)
    expect(rangeCalls).toContainEqual({ from: 0, to: 1 })
    expect(rangeCalls).toContainEqual({ from: 2, to: 3 })
  })
})
