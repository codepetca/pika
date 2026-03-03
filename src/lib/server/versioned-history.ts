import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import type { JsonPatchOperation } from '@/types'

type SupabaseLike = any

type HistoryMetrics = {
  word_count: number
  char_count: number
  paste_word_count?: number | null
  keystroke_count?: number | null
}

type JsonObject = object

type BuildMetrics<TContent extends JsonObject> = (content: TContent) => HistoryMetrics

type BaselineOptions<TContent extends JsonObject> = {
  supabase: SupabaseLike
  table: string
  ownerColumn: string
  ownerId: string
  content: TContent
  selectFields: string
  trigger: string
  buildMetrics: BuildMetrics<TContent>
}

type PersistOptions<TContent extends JsonObject> = {
  supabase: SupabaseLike
  table: string
  ownerColumn: string
  ownerId: string
  previousContent: TContent
  nextContent: TContent
  selectFields: string
  trigger: string
  buildMetrics: BuildMetrics<TContent>
  historyMinIntervalMs: number
}

type LastHistoryRow = {
  id: string
  created_at: string
  paste_word_count?: number | null
  keystroke_count?: number | null
}

function createSnapshotPayload<TContent>(
  ownerColumn: string,
  ownerId: string,
  content: TContent,
  trigger: string,
  metrics: HistoryMetrics
): Record<string, unknown> {
  return {
    [ownerColumn]: ownerId,
    patch: null,
    snapshot: content,
    word_count: metrics.word_count,
    char_count: metrics.char_count,
    paste_word_count: metrics.paste_word_count ?? 0,
    keystroke_count: metrics.keystroke_count ?? 0,
    trigger,
  }
}

function createPatchPayload<TContent>(
  ownerColumn: string,
  ownerId: string,
  patch: JsonPatchOperation[],
  snapshot: TContent | null,
  trigger: string,
  metrics: HistoryMetrics
): Record<string, unknown> {
  return {
    [ownerColumn]: ownerId,
    patch: snapshot ? null : patch,
    snapshot,
    word_count: metrics.word_count,
    char_count: metrics.char_count,
    paste_word_count: metrics.paste_word_count ?? 0,
    keystroke_count: metrics.keystroke_count ?? 0,
    trigger,
  }
}

export async function insertVersionedBaselineHistory<TContent extends JsonObject>(
  opts: BaselineOptions<TContent>
) {
  const metrics = opts.buildMetrics(opts.content)
  const payload = createSnapshotPayload(
    opts.ownerColumn,
    opts.ownerId,
    opts.content,
    opts.trigger,
    metrics
  )

  const { data, error } = await opts.supabase
    .from(opts.table)
    .insert(payload)
    .select(opts.selectFields)
    .single()

  if (error) throw error
  return data
}

export async function persistVersionedHistory<TContent extends JsonObject>(
  opts: PersistOptions<TContent>
) {
  const patch = createJsonPatch(opts.previousContent, opts.nextContent)

  if (patch.length === 0) return null

  const { data: lastHistory, error: lastHistoryError } = await opts.supabase
    .from(opts.table)
    .select('id, created_at, paste_word_count, keystroke_count')
    .eq(opts.ownerColumn, opts.ownerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastHistoryError) {
    throw lastHistoryError
  }

  const metrics = opts.buildMetrics(opts.nextContent)
  const last = lastHistory as LastHistoryRow | null

  if (!last) {
    return insertVersionedBaselineHistory({
      supabase: opts.supabase,
      table: opts.table,
      ownerColumn: opts.ownerColumn,
      ownerId: opts.ownerId,
      content: opts.nextContent,
      trigger: 'baseline',
      selectFields: opts.selectFields,
      buildMetrics: opts.buildMetrics,
    })
  }

  const lastCreatedAt = new Date(last.created_at).getTime()
  const nowMs = Date.now()
  const isRateLimited = nowMs - lastCreatedAt < opts.historyMinIntervalMs

  if (isRateLimited) {
    const { data, error } = await opts.supabase
      .from(opts.table)
      .update({
        patch: null,
        snapshot: opts.nextContent,
        word_count: metrics.word_count,
        char_count: metrics.char_count,
        paste_word_count: (last.paste_word_count ?? 0) + (metrics.paste_word_count ?? 0),
        keystroke_count: (last.keystroke_count ?? 0) + (metrics.keystroke_count ?? 0),
        trigger: opts.trigger,
        created_at: new Date().toISOString(),
      })
      .eq('id', last.id)
      .select(opts.selectFields)
      .single()

    if (error) throw error
    return data
  }

  const storeSnapshot = shouldStoreSnapshot(patch, opts.nextContent)
  const payload = createPatchPayload(
    opts.ownerColumn,
    opts.ownerId,
    patch,
    storeSnapshot ? opts.nextContent : null,
    opts.trigger,
    metrics
  )

  const { data, error } = await opts.supabase
    .from(opts.table)
    .insert(payload)
    .select(opts.selectFields)
    .single()

  if (error) throw error
  return data
}
