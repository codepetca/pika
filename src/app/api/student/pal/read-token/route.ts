import { NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { isPalEnabled, isClassroomPalRequested } from '@/lib/server/pal-config'
import { getPalReadTokenForStudent } from '@/lib/server/pal-read-token'
import { classroomPalTokenRequestSchema } from '@/lib/validations/pal-membership'
import { ApiError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStoreHeaders = { 'Cache-Control': 'no-store' }

export const POST = withErrorHandler('PostStudentPalReadToken', async (request) => {
  const user = await requireRole('student')
  if (!isPalEnabled()) {
    return NextResponse.json(
      { error: 'Achievements are unavailable' },
      { status: 404, headers: noStoreHeaders },
    )
  }

  if (!isClassroomPalRequested() && request.body !== null) {
    return NextResponse.json({ error: 'Classroom achievements are unavailable' }, { status: 404, headers: noStoreHeaders })
  }
  const membershipRequest = isClassroomPalRequested()
    ? classroomPalTokenRequestSchema.safeParse(await request.json().catch(() => null))
    : null
  if (membershipRequest && !membershipRequest.success) {
    return NextResponse.json({ error: 'Invalid classroom achievements request' }, { status: 400, headers: noStoreHeaders })
  }
  try {
    const token = membershipRequest
      ? await (await import('@/lib/server/pal-classroom')).getMembershipPalReadToken({
          studentId: user.id, ...membershipRequest.data,
        })
      : await getPalReadTokenForStudent({ studentId: user.id })
    return NextResponse.json(token, {
      headers: noStoreHeaders,
    })
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 503)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: noStoreHeaders })
    }
    if (
      error instanceof Error
      && error.name === 'PalReadTokenRateLimitError'
      && 'retryAfterSeconds' in error
      && typeof error.retryAfterSeconds === 'number'
    ) {
      return NextResponse.json(
        { error: 'Achievements are temporarily unavailable' },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            'Retry-After': String(error.retryAfterSeconds),
          },
        },
      )
    }
    console.error('Failed to mint Pal read token:', error)
    return NextResponse.json(
      { error: 'Achievements are temporarily unavailable' },
      { status: 503, headers: noStoreHeaders },
    )
  }
})
