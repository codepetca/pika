import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { recordDirectDeveloperFeedback } from '@/lib/developer-log-feedback'

interface FeedbackBody {
  category: 'bug' | 'suggestion'
  description: string
  metadata: {
    url: string
    userAgent: string
    version: string
    commit: string
    env: string
  }
}

export const POST = withErrorHandler('PostFeedback', async (request) => {
  const user = await requireAuth()

  let body: FeedbackBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  if (!['bug', 'suggestion'].includes(body.category)) {
    return NextResponse.json(
      { error: 'Invalid category' },
      { status: 400 },
    )
  }

  if (!body.description || body.description.trim().length < 10) {
    return NextResponse.json(
      { error: 'Description must be at least 10 characters' },
      { status: 400 },
    )
  }

  const result = await recordDirectDeveloperFeedback(getServiceRoleClient(), {
    userId: user.id,
    role: user.role,
    category: body.category,
    description: body.description.trim(),
    metadata: body.metadata ?? {},
  })

  return NextResponse.json({ success: true, candidate_id: result.id })
})
