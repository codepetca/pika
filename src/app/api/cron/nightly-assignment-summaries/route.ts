import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateDailyLogSummary, hashDailyLogText } from '@/lib/daily-log-summaries'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const DEFAULT_MAX_ENTRIES = 200

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

function isProdEnv(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

function isWithinNightlyWindowToronto(date: Date): boolean {
  // Cron is scheduled at 06:00 UTC (configured in the Vercel dashboard).
  // That’s 1:00am Toronto in winter (EST) and 2:00am in summer (EDT).
  // Allow a small minute window for scheduling jitter.
  const hour = Number(formatInTimeZone(date, TIMEZONE, 'H'))
  const minute = Number(formatInTimeZone(date, TIMEZONE, 'm'))
  return (hour === 1 || hour === 2) && minute < 10
}

function getYesterdayTorontoDateString(now: Date): string {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return formatInTimeZone(yesterday, TIMEZONE, 'yyyy-MM-dd')
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const current = nextIndex
      nextIndex++
      if (current >= items.length) return
      results[current] = await fn(items[current])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authHeader = getCronAuthHeader(request)
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  const shouldRun = force
    ? !isProdEnv()
    : isWithinNightlyWindowToronto(new Date())

  if (!shouldRun) {
    return NextResponse.json(
      {
        status: 'skipped',
        reason: force
          ? 'force_not_allowed_in_production'
          : 'outside_1am_toronto_window',
      },
      { status: 200 }
    )
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { status: 'ok', ran: false, message: 'OPENAI_API_KEY_not_configured' },
      { status: 200 }
    )
  }

  const supabase = getServiceRoleClient()
  const targetDate = getYesterdayTorontoDateString(new Date())

  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('id, text')
    .eq('date', targetDate)
    .limit(DEFAULT_MAX_ENTRIES)

  if (entriesError) {
    console.error('Error fetching entries for summaries:', entriesError)
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 })
  }

  const entryIds = (entries || []).map((e: any) => e.id)
  if (entryIds.length === 0) {
    return NextResponse.json(
      { status: 'ok', ran: true, date: targetDate, processed: 0, created: 0 },
      { status: 200 }
    )
  }

  const { data: existing, error: existingError } = await supabase
    .from('entry_summaries')
    .select('entry_id')
    .in('entry_id', entryIds)

  if (existingError) {
    console.error('Error fetching existing entry summaries:', existingError)
    return NextResponse.json({ error: 'Failed to fetch existing summaries' }, { status: 500 })
  }

  const existingIds = new Set((existing || []).map((r: any) => r.entry_id))
  const missing = (entries || []).filter((e: any) => !existingIds.has(e.id))

  if (missing.length === 0) {
    return NextResponse.json(
      { status: 'ok', ran: true, date: targetDate, processed: entryIds.length, created: 0 },
      { status: 200 }
    )
  }

  const generated = await mapWithConcurrency(
    missing,
    5,
    async (entry: any) => {
      const { summary, model } = await generateDailyLogSummary(entry.text)
      return {
        entry_id: entry.id,
        model,
        text_hash: hashDailyLogText(entry.text),
        summary,
      }
    }
  )

  const { error: insertError } = await supabase
    .from('entry_summaries')
    .upsert(generated, { onConflict: 'entry_id' })

  if (insertError) {
    // We intentionally never regenerate; if another run already inserted, treat as success.
    const message = String((insertError as any)?.message ?? '')
    if (!message.toLowerCase().includes('duplicate')) {
      console.error('Error inserting entry summaries:', insertError)
      return NextResponse.json({ error: 'Failed to store summaries' }, { status: 500 })
    }
  }

  return NextResponse.json(
    {
      status: 'ok',
      ran: true,
      date: targetDate,
      processed: entryIds.length,
      created: generated.length,
    },
    { status: 200 }
  )
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
