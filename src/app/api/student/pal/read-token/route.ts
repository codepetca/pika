import { NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { isPalEnabled } from '@/lib/server/pal-config'
import { getPalReadTokenForStudent } from '@/lib/server/pal-read-token'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStoreHeaders = { 'Cache-Control': 'no-store' }

export const POST = withErrorHandler('PostStudentPalReadToken', async () => {
  const user = await requireRole('student')
  if (!isPalEnabled()) {
    return NextResponse.json(
      { error: 'Achievements are unavailable' },
      { status: 404, headers: noStoreHeaders },
    )
  }

  try {
    const token = await getPalReadTokenForStudent({ studentId: user.id })
    return NextResponse.json(token, {
      headers: noStoreHeaders,
    })
  } catch (error) {
    console.error('Failed to mint Pal read token:', error)
    return NextResponse.json(
      { error: 'Achievements are temporarily unavailable' },
      { status: 503, headers: noStoreHeaders },
    )
  }
})
