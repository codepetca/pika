import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { drainCodePetPalOutbox } from '@/lib/codepetpal'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostCodePetPalOutboxDrain', async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') || ''
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceRoleClient()
  const result = await drainCodePetPalOutbox(supabase)
  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
})
