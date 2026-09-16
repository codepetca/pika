/**
 * Build a de-identified sample file for `pnpm eval:assignment-anchors`.
 *
 * Reads one assignment's submitted work and writes the exact text the grader
 * would see: the same instruction extraction, the same plain-text conversion,
 * and the same roster-aware sanitization. Student IDs never reach the output;
 * submissions are labelled `student-01`, `student-02`, ... in save order.
 *
 * Usage:
 *   pnpm export:anchor-sample <assignment-id> [out.json]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY, which `.env.local` already supplies. Read-only.
 */
import { writeFileSync } from 'node:fs'
import { getServiceRoleClient } from '@/lib/supabase'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { sanitizeAiText } from '@/lib/ai-sanitization'
import { extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

function parseContent(raw: unknown): TiptapContent {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TiptapContent
    } catch {
      return { type: 'doc', content: [] } as TiptapContent
    }
  }
  return (raw ?? { type: 'doc', content: [] }) as TiptapContent
}

async function main(): Promise<void> {
  const assignmentId = process.argv[2]
  const outPath = process.argv[3] ?? 'anchor-sample.json'
  if (!assignmentId) {
    console.error('Usage: pnpm export:anchor-sample <assignment-id> [out.json]')
    process.exitCode = 1
    return
  }

  const supabase = getServiceRoleClient()

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, title, classroom_id, instructions_markdown, rich_instructions')
    .eq('id', assignmentId)
    .single()
  if (assignmentError || !assignment) {
    console.error(`Assignment not found: ${assignmentId}`)
    process.exitCode = 1
    return
  }

  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select('id, content, is_submitted, updated_at')
    .eq('assignment_id', assignmentId)
    .order('updated_at', { ascending: true })
  if (docsError) {
    console.error('Failed to load assignment documents')
    process.exitCode = 1
    return
  }

  const sanitizationContext = await loadClassroomAiSanitizationContext(
    supabase,
    assignment.classroom_id,
  )

  const instructions = sanitizeAiText(
    limitedMarkdownToPlainText(getAssignmentInstructionsMarkdown(assignment).markdown),
    sanitizationContext ?? undefined,
  )

  const submissions = (docs ?? [])
    .map((doc) => extractPlainText(parseContent(doc.content)).trim())
    .filter((text) => text.length > 0)
    .map((text, index) => ({
      label: `student-${String(index + 1).padStart(2, '0')}`,
      text: sanitizeAiText(text, sanitizationContext ?? undefined),
    }))

  if (submissions.length < 2) {
    console.error(`Need at least 2 non-empty submissions, found ${submissions.length}.`)
    process.exitCode = 1
    return
  }

  writeFileSync(outPath, `${JSON.stringify({
    assignmentTitle: sanitizeAiText(assignment.title, sanitizationContext ?? undefined),
    instructions,
    submissions,
  }, null, 2)}\n`)

  console.log(`Wrote ${outPath}`)
  console.log(`  assignment:  ${assignment.title}`)
  console.log(`  submissions: ${submissions.length}`)
  console.log(`  instructions: ${instructions.length} chars`)
  if (instructions.length < 200) {
    console.log('  WARNING: short instructions; anchors will be largely guesswork.')
  }
  console.log('\nReview the file before grading it, then run:')
  console.log(`  ASSIGNMENT_GRADING_ANCHORS_ENABLED=true pnpm eval:assignment-anchors ${outPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Export failed')
  process.exitCode = 1
})
