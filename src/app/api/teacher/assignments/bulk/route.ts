import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { plainTextToTiptapContent, extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface BulkAssignmentInput {
  id?: string
  title: string
  due_at: string
  instructions: string
  is_draft: boolean
  position: number
}

const MAX_ASSIGNMENTS = 50

/**
 * POST /api/teacher/assignments/bulk - Bulk create/update assignments
 *
 * Used by the markdown sidebar to sync assignments from markdown content.
 * - Creates new assignments (entries without ID) as drafts
 * - Updates existing assignments (entries with ID)
 * - Allows draft→released but blocks released→draft
 * - Updates positions based on order in array
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { classroom_id, assignments } = body

    // Validate required fields
    if (!classroom_id) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    if (!assignments || !Array.isArray(assignments)) {
      return NextResponse.json(
        { error: 'assignments array is required' },
        { status: 400 }
      )
    }

    if (assignments.length > MAX_ASSIGNMENTS) {
      return NextResponse.json(
        { error: `Too many assignments. Maximum is ${MAX_ASSIGNMENTS}` },
        { status: 400 }
      )
    }

    // Validate teacher owns classroom and can mutate
    const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const supabase = getServiceRoleClient()

    // Validate all assignments first
    const errors: string[] = []
    const inputAssignments = assignments as BulkAssignmentInput[]

    for (let i = 0; i < inputAssignments.length; i++) {
      const a = inputAssignments[i]
      if (!a.title?.trim()) {
        errors.push(`Assignment at position ${i} has no title`)
      }
      if (!a.due_at) {
        errors.push(`Assignment "${a.title || `at position ${i}`}" has no due date`)
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 })
    }

    // Get IDs of assignments to update
    const idsToUpdate = inputAssignments
      .filter((a) => a.id)
      .map((a) => a.id!)

    // Fetch existing assignments if there are IDs
    let existingAssignments: Array<{
      id: string
      is_draft: boolean
      released_at: string | null
      title: string
    }> = []

    if (idsToUpdate.length > 0) {
      const { data, error } = await supabase
        .from('assignments')
        .select('id, is_draft, released_at, title')
        .eq('classroom_id', classroom_id)
        .in('id', idsToUpdate)

      if (error) {
        console.error('Error fetching existing assignments:', error)
        return NextResponse.json(
          { error: 'Failed to fetch existing assignments' },
          { status: 500 }
        )
      }

      existingAssignments = data || []
    }

    const existingById = new Map(existingAssignments.map((a) => [a.id, a]))

    // Validate ID references and draft status changes
    for (const a of inputAssignments) {
      if (a.id) {
        const existing = existingById.get(a.id)
        if (!existing) {
          errors.push(`Assignment ID not found: ${a.id}`)
          continue
        }

        // Check for un-release attempt (released assignment being set to draft)
        if (!existing.is_draft && a.is_draft) {
          errors.push(`Cannot un-release assignment: ${a.title}`)
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 })
    }

    // Process assignments: separate creates and updates
    const toCreate: BulkAssignmentInput[] = []
    const toUpdate: BulkAssignmentInput[] = []

    for (const a of inputAssignments) {
      if (a.id) {
        toUpdate.push(a)
      } else {
        toCreate.push(a)
      }
    }

    let createdCount = 0
    let updatedCount = 0
    const resultAssignments: any[] = []

    // Create new assignments
    if (toCreate.length > 0) {
      const insertData = toCreate.map((a) => {
        const richInstructions = plainTextToTiptapContent(a.instructions)
        return {
          classroom_id,
          title: a.title.trim(),
          description: a.instructions, // Plain text for backwards compatibility
          rich_instructions: richInstructions,
          due_at: a.due_at,
          position: a.position,
          is_draft: true, // New assignments are always drafts
          created_by: user.id,
        }
      })

      const { data, error } = await supabase
        .from('assignments')
        .insert(insertData)
        .select()

      if (error) {
        console.error('Error creating assignments:', error)
        return NextResponse.json(
          { error: 'Failed to create assignments' },
          { status: 500 }
        )
      }

      createdCount = data?.length || 0
      if (data) resultAssignments.push(...data)
    }

    // Update existing assignments
    for (const a of toUpdate) {
      const existing = existingById.get(a.id!)
      if (!existing) continue

      const richInstructions = plainTextToTiptapContent(a.instructions)

      // Determine if we're releasing (draft→released)
      const isReleasing = existing.is_draft && !a.is_draft

      const updateData: Record<string, any> = {
        title: a.title.trim(),
        description: a.instructions,
        rich_instructions: richInstructions,
        due_at: a.due_at,
        position: a.position,
        is_draft: a.is_draft,
      }

      // Set released_at when releasing
      if (isReleasing) {
        updateData.released_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('assignments')
        .update(updateData)
        .eq('id', a.id!)
        .select()

      if (error) {
        console.error('Error updating assignment:', error)
        return NextResponse.json(
          { error: 'Failed to update assignments' },
          { status: 500 }
        )
      }

      updatedCount++
      if (data) resultAssignments.push(...data)
    }

    return NextResponse.json({
      created: createdCount,
      updated: updatedCount,
      assignments: resultAssignments,
    })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Bulk assignments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
