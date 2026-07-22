import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { runAssignmentArtifactStorageCleanup } from '@/lib/server/assignment-artifact-storage-cleanup'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runAssignmentArtifactStorageCleanup({
    supabase: getServiceRoleClient(),
    limit: 100,
    leaseSeconds: 120,
  })
  return NextResponse.json({ ok: result.failed === 0, ...result }, {
    status: result.failed === 0 ? 200 : 503,
  })
}

export const GET = withErrorHandler(
  'GetCronAssignmentArtifactStorageCleanup',
  async (request: NextRequest) => handle(request),
)

export const POST = withErrorHandler(
  'PostCronAssignmentArtifactStorageCleanup',
  async (request: NextRequest) => handle(request),
)
