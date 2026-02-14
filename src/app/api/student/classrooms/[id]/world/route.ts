import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getWorldSnapshot, claimDailyCareEvent, setOverlayEnabled } from '@/lib/server/world-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: classroomId } = params

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const snapshot = await getWorldSnapshot(user.id, classroomId)
    if (!snapshot.ok) {
      return NextResponse.json({ error: snapshot.error }, { status: snapshot.status })
    }
    return NextResponse.json(snapshot.data)
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get world error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: classroomId } = params

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const body = await request.json()
    const action = body?.action as string | undefined

    if (action === 'claim_daily') {
      const result = await claimDailyCareEvent(user.id, classroomId)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json(result.data)
    }

    if (action === 'set_overlay') {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 })
      }
      const result = await setOverlayEnabled(user.id, classroomId, body.enabled)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json(result.data)
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('World action error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

