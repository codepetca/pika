import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { drainRepoLightProvisionOutbox } from '@/lib/server/repolight-provision-runtime'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export const GET = withErrorHandler('RepoLightProvisionRecovery', async request => {
  const secret = process.env.CRON_SECRET
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await drainRepoLightProvisionOutbox({ limit: 10 }))
})
