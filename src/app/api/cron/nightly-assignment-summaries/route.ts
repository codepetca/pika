import { NextRequest, NextResponse } from 'next/server'
import { nowInToronto } from '@/lib/timezone'

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

function isProdEnv(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

function isWithinNightlyWindowToronto(date: Date): boolean {
  // We schedule two UTC cron triggers (05:00 + 06:00 UTC) to hit 1am Toronto across DST.
  // Allow a small minute window for scheduling jitter.
  return date.getHours() === 1 && date.getMinutes() < 10
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

  const torontoNow = nowInToronto()
  const shouldRun = force ? !isProdEnv() : isWithinNightlyWindowToronto(torontoNow)

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

  // NOTE: Summary generation is implemented in a later phase.
  // This endpoint intentionally no-ops until the assignments AI summary feature is ready.
  return NextResponse.json(
    { status: 'ok', ran: false, message: 'not_implemented' },
    { status: 200 }
  )
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
