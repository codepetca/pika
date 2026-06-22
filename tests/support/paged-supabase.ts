import { vi } from 'vitest'

export type PagedQueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

export function createPagedQueryLog(): PagedQueryLog {
  return { inCalls: [], orderCalls: [], rangeCalls: [] }
}

export function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: PagedQueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values })
          }
          return query
        }),
        order: vi.fn((column: string) => {
          if (options.table) {
            options.log?.orderCalls.push({ table: options.table, column })
          }
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }

          const filteredRows = rows.filter((row) =>
            filters.every((filter) => {
              if (!(filter.column in row)) return true
              return filter.values.includes(String(row[filter.column]))
            })
          )

          return Promise.resolve({
            data: filteredRows.slice(from, to + 1),
            error: null,
          })
        }),
      }
      return query
    }),
  }
}
