import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const POST = withErrorHandler('PostLogout', async () => {
  await destroySession()

  return NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  })
})
