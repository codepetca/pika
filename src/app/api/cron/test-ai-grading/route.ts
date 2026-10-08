import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { logServerError } from '@/lib/server/diagnostics'
import { tickTestAiGradingRun } from '@/lib/server/test-ai-grading-runs'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const wakeSchema = z.object({ run_id: z.uuid() }).strict()

export const POST = withErrorHandler('PostCronTestAiGrading', async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Worker is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { run_id: runId } = wakeSchema.parse(await request.json())
  const { data: run, error } = await getServiceRoleClient()
    .from('test_ai_grading_runs')
    .select('test_id, status')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error('Failed to load test AI grading run')
  if (!run || (run.status !== 'queued' && run.status !== 'running')) {
    return NextResponse.json({ scheduled: false })
  }

  // Respond to pg_net promptly. The platform holds this invocation for the bounded tick;
  // a released-run trigger queues the next tick, and pg_cron rescues missed wakeups.
  after(async () => {
    try {
      await tickTestAiGradingRun({ testId: run.test_id, runId })
    } catch (error) {
      logServerError('grading.test_background_tick', error)
    }
  })
  return NextResponse.json({ scheduled: true }, { status: 202 })
})
