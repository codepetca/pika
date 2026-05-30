type ChunkedFilter = {
  column: string
  values: string[]
}

type LoadChunkedRowsOptions = {
  supabase: any
  table: string
  select: string
  filters: ChunkedFilter[]
  chunkSize?: number
  pageSize?: number
  pageOrderColumn?: string
}

const DEFAULT_FILTER_CHUNK_SIZE = 50

export function chunkValues<T>(values: T[], chunkSize = DEFAULT_FILTER_CHUNK_SIZE): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

async function loadPagedRows<T>(buildQuery: () => any, pageSize?: number, pageOrderColumn = 'id') {
  const rows: T[] = []
  let offset = 0

  while (true) {
    let query = buildQuery()
    const supportsRange = typeof query.range === 'function'

    if (supportsRange && typeof query.order === 'function') {
      query = query.order(pageOrderColumn, { ascending: true })
    }
    if (supportsRange && typeof pageSize === 'number' && pageSize > 0) {
      query = query.range(offset, offset + pageSize - 1)
    }

    const { data, error } = await query
    if (error) {
      return { rows: [] as T[], error }
    }

    const pageRows = (data || []) as T[]
    rows.push(...pageRows)

    if (!supportsRange || typeof pageSize !== 'number' || pageSize <= 0 || pageRows.length < pageSize) {
      break
    }

    offset += pageSize
  }

  return { rows, error: null }
}

type ChunkedRowsResult<T> = { rows: T[]; error: any }

function normalizeFilters(filters: ChunkedFilter[]) {
  return filters.map((filter) => ({
    column: filter.column,
    values: Array.from(new Set(filter.values.filter((value) => typeof value === 'string' && value.length > 0))),
  }))
}

export async function loadChunkedRows<T>(options: LoadChunkedRowsOptions): Promise<ChunkedRowsResult<T>> {
  const {
    supabase,
    table,
    select,
    chunkSize = DEFAULT_FILTER_CHUNK_SIZE,
    pageSize,
    pageOrderColumn,
  } = options

  const filters = normalizeFilters(options.filters)
  if (filters.some((filter) => filter.values.length === 0)) {
    return { rows: [], error: null }
  }

  const chunkedFilters = filters.map((filter) => ({
    column: filter.column,
    chunks: chunkValues(filter.values, chunkSize),
  }))

  const rows: T[] = []

  async function visit(
    depth: number,
    activeChunks: Array<{ column: string; values: string[] }>,
  ): Promise<ChunkedRowsResult<T>> {
    if (depth === chunkedFilters.length) {
      const result = await loadPagedRows<T>(() => {
        let query = supabase.from(table).select(select)
        for (const activeChunk of activeChunks) {
          query = query.in(activeChunk.column, activeChunk.values)
        }
        return query
      }, pageSize, pageOrderColumn)

      if (result.error) {
        return result
      }

      rows.push(...result.rows)
      return { rows, error: null }
    }

    const filter = chunkedFilters[depth]
    for (const values of filter.chunks) {
      const result = await visit(depth + 1, [...activeChunks, { column: filter.column, values }])
      if (result.error) {
        return result
      }
    }

    return { rows, error: null }
  }

  return visit(0, [])
}
