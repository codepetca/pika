import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { recordDirectDeveloperFeedback } from '@/lib/developer-log-feedback'

interface FeedbackPayload {
  category: unknown
  description: string
  metadata: Record<string, unknown>
}

export const POST = withErrorHandler('PostFeedback', async (request) => {
  const user = await requireAuth()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const body = normalizeFeedbackBody(payload)

  if (body.category !== 'bug' && body.category !== 'suggestion') {
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

function normalizeFeedbackBody(payload: unknown): FeedbackPayload {
  const record = isRecord(payload) ? payload : {}
  const metadata = isRecord(record.metadata) ? record.metadata : {}

  return {
    category: record.category,
    description: typeof record.description === 'string' ? record.description : '',
    metadata,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
