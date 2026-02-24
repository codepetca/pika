import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/quizzes/[id]/focus-events - focus telemetry is tests-only
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole('student')
    await params

    return NextResponse.json(
      { error: 'Focus telemetry is only available for tests' },
      { status: 400 }
    )
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Quiz focus event POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
