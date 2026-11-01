import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { requireAuth } from '@/lib/auth'
import { requireSameOriginPost } from '@/lib/server/workos-logout'
import { ensureVerifiedClassroomAdmission } from '@/lib/server/verified-classroom-auto-admission'

export const dynamic = 'force-dynamic'

/** Explicit recovery for an existing signed-in session; request bodies are never used for identity. */
export const POST = withErrorHandler('EnsureClassroomAdmission', async (request: NextRequest) => {
  requireSameOriginPost(request)
  const actor = await requireAuth()
  try {
    const result = await ensureVerifiedClassroomAdmission(actor.id)
    return NextResponse.json({ outcome: result?.outcome ?? 'disabled' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    throw new ApiError(503, 'Classroom admission is temporarily unavailable')
  }
})
