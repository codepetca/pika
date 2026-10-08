import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  authenticateContextualClassroomHome,
  loadContextualClassroomHome,
} from '@/lib/server/contextual-classroom-home'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/classrooms/home - Dormant mixed-relationship home data contract.
export const GET = withErrorHandler('GetContextualClassroomHome', async () => {
  const user = await authenticateContextualClassroomHome()
  const home = await loadContextualClassroomHome(user.id, {
    supabase: getServiceRoleClient(),
  })
  return NextResponse.json(home)
})
