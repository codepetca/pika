import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getPetWithUnlocks, selectPetImage } from '@/lib/server/pet'
import { PET_IMAGES } from '@/lib/pet-config'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/classrooms/[id]/pet - Get pet state for student
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

    const result = await getPetWithUnlocks(user.id, classroomId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ pet: result.data, images: PET_IMAGES })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get pet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/student/classrooms/[id]/pet - Select pet image
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
    const imageIndex = body.image_index

    if (typeof imageIndex !== 'number' || imageIndex < 0 || imageIndex > 10) {
      return NextResponse.json(
        { error: 'Invalid image_index. Must be a number between 0 and 10.' },
        { status: 400 }
      )
    }

    const result = await selectPetImage(user.id, classroomId, imageIndex)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ pet: result.data })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Select pet image error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
