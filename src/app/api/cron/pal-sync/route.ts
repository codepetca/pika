import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { drainPalOutbox } from '@/lib/server/pal-outbox'
import { syncPalWeeklyConfigurations } from '@/lib/server/pal-weekly-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetPalPilotSync', async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let weekly: Awaited<ReturnType<typeof syncPalWeeklyConfigurations>> | {
    status: 'error'
    error: 'weekly_sync_failed'
  }

  try {
    weekly = await syncPalWeeklyConfigurations()
  } catch (error) {
    console.error('Pal weekly configuration sync failed', error)
    weekly = { status: 'error', error: 'weekly_sync_failed' }
  }

  let delivery: Awaited<ReturnType<typeof drainPalOutbox>> | {
    status: 'error'
    error: 'outbox_delivery_failed'
  }

  try {
    delivery = await drainPalOutbox()
  } catch (error) {
    console.error('Pal outbox delivery failed', error)
    delivery = { status: 'error', error: 'outbox_delivery_failed' }
  }

  const status = weekly.status === 'error' || delivery.status === 'error'
    ? 'partial'
    : 'ok'

  return NextResponse.json({ status, weekly, delivery })
})
