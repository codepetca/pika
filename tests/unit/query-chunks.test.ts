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
      { id: '1', quiz_id: 'quiz-1', student_id: 'student-1' },
      { id: '2', quiz_id: 'quiz-1', student_id: 'student-2' },
      { id: '3', quiz_id: 'quiz-2', student_id: 'student-1' },
      { id: '4', quiz_id: 'quiz-2', student_id: 'student-2' },
      { id: '5', quiz_id: 'quiz-3', student_id: 'student-3' },
    ]

    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          let selectedQuizIds: string[] = []
          const query: any = {
            in: vi.fn((column: string, values: string[]) => {
              inCalls.push({ column, values })
              if (column === 'quiz_id') {
                selectedQuizIds = values
                return query
              }

              if (column === 'student_id') {
                const filtered = rows.filter(
                  (row) => selectedQuizIds.includes(row.quiz_id) && values.includes(row.student_id),
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

    const result = await loadChunkedRows<{ id: string; quiz_id: string; student_id: string }>({
      supabase,
      table: 'quiz_responses',
      select: 'id, quiz_id, student_id',
      filters: [
        { column: 'quiz_id', values: ['quiz-1', 'quiz-2', 'quiz-3'] },
        { column: 'student_id', values: ['student-1', 'student-2', 'student-3'] },
      ],
      chunkSize: 2,
      pageSize: 2,
    })

    expect(result.error).toBeNull()
    expect(result.rows).toHaveLength(5)
    const quizCalls = inCalls.filter((call) => call.column === 'quiz_id')
    const studentCalls = inCalls.filter((call) => call.column === 'student_id')

    expect(quizCalls.length).toBeGreaterThanOrEqual(4)
    expect(quizCalls).toEqual(
      expect.arrayContaining([
        { column: 'quiz_id', values: ['quiz-1', 'quiz-2'] },
        { column: 'quiz_id', values: ['quiz-3'] },
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
