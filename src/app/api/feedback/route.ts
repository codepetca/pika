import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

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

export async function POST(request: Request) {
  const token = process.env.GITHUB_FEEDBACK_TOKEN
  const repo = process.env.GITHUB_FEEDBACK_REPO

  if (!token || !repo) {
    return NextResponse.json(
      { error: 'Feedback not configured' },
      { status: 501 },
    )
  }

  const user = await requireAuth()

  const body: FeedbackBody = await request.json()

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

  const titlePrefix = `[${body.category}]`
  const titleText = body.description.trim().slice(0, 80)
  const title = `${titlePrefix} ${titleText}`

  const meta = body.metadata ?? {}
  const issueBody = [
    `**Role:** ${user.role}`,
    `**Page:** ${meta.url || 'N/A'}`,
    `**User-Agent:** ${meta.userAgent || 'N/A'}`,
    `**Version:** ${meta.version || 'N/A'}`,
    `**Commit:** ${meta.commit || 'N/A'}`,
    `**Environment:** ${meta.env || 'N/A'}`,
    '',
    '---',
    '',
    body.description.trim(),
  ].join('\n')

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body: issueBody }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('GitHub Issues API error:', res.status, text)
    return NextResponse.json(
      { error: 'Failed to create feedback issue' },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true })
}
