import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { membershipPalReadRequestSchema } from '@/lib/validations/pal-membership'
import { recordPalClassroomVisit } from '@/lib/server/pal-classroom'
import { isClassroomPalEnabled, isPalEnabled } from '@/lib/server/pal-config'
import { attemptMembershipPalActionDelivery } from '@/lib/server/pal-outbox'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostPalClassroomVisit', async request => {
  const user = await requireRole('student')
  const noStore = { 'Cache-Control': 'no-store' }
  if (!isClassroomPalEnabled() || !isPalEnabled()) {
    return NextResponse.json({ error: 'Achievements are unavailable' }, { status: 404, headers: noStore })
  }
  // Browser-only visit signal: navigational prefetches and cross-site requests
  // cannot assert a visit. No account/classroom fan-out is performed.
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore })
  }
  const { classroomId } = membershipPalReadRequestSchema.parse(await request.json())
  await recordPalClassroomVisit({ studentId: user.id, classroomId })
  const delivery = await attemptMembershipPalActionDelivery({ membership: { studentId: user.id, classroomId } })
  return NextResponse.json({ status: 'recorded', pal_delivery: delivery }, { headers: noStore })
})
