import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/auth/me - Get current user info
export const GET = withErrorHandler('GetCurrentUser', async () => {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  })
})
