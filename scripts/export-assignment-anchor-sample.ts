/**
 * Build a de-identified sample file for `pnpm eval:assignment-anchors`.
 *
 * Reads one assignment's submitted work and writes the exact text the grader
 * would see: the same instruction extraction, the same plain-text conversion,
 * and the same roster-aware sanitization. Student IDs never reach the output;
 * submissions are labelled `student-01`, `student-02`, ... in save order.
 *
 * Usage:
 *   pnpm export:anchor-sample <class-code> <assignment-title> [out.json]
 *   pnpm export:anchor-sample <assignment-uuid> [out.json]
 *
 * Assignments have no URL of their own, so the class code and title you already
 * know are the normal way in, for example: `pnpm export:anchor-sample ppz3c A1`.
 * Title matching is case-insensitive and exact.
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type AssignmentRow = {
  id: string
  title: string
  classroom_id: string
  instructions_markdown: string | null
  rich_instructions: unknown
}

const ASSIGNMENT_COLUMNS = 'id, title, classroom_id, instructions_markdown, rich_instructions'

async function resolveAssignment(
  supabase: SupabaseClient,
  args: string[],
): Promise<AssignmentRow | null> {
  if (UUID_PATTERN.test(args[0])) {
    const { data } = await supabase
      .from('assignments').select(ASSIGNMENT_COLUMNS).eq('id', args[0]).single()
    if (!data) console.error(`No assignment with id ${args[0]}.`)
    return (data as AssignmentRow | null) ?? null
  }

  const [classCode, title] = args
  if (!title) {
    console.error('Give a class code and an assignment title, or an assignment UUID.')
    return null
  }

  const { data: classroom } = await supabase
    .from('classrooms').select('id, name, class_code').ilike('class_code', classCode).maybeSingle()
  if (!classroom) {
    console.error(`No classroom with class code ${classCode}.`)
    return null
  }

  const { data: assignments } = await supabase
    .from('assignments').select(ASSIGNMENT_COLUMNS)
    .eq('classroom_id', classroom.id).ilike('title', title)
  const matches = (assignments ?? []) as AssignmentRow[]
  if (matches.length === 0) {
    const { data: available } = await supabase
      .from('assignments').select('title').eq('classroom_id', classroom.id).order('position')
    console.error(`No assignment titled "${title}" in ${classCode}.`)
    if (available?.length) {
      console.error(`Assignments in this classroom: ${available.map((row) => row.title).join(', ')}`)
    }
    return null
  }
  if (matches.length > 1) {
    console.error(`"${title}" is ambiguous in ${classCode}. Re-run with one of these ids:`)
    for (const match of matches) console.error(`  ${match.id}`)
    return null
  }
  return matches[0]
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: pnpm export:anchor-sample <class-code> <assignment-title> [out.json]')
    console.error('   or: pnpm export:anchor-sample <assignment-uuid> [out.json]')
    process.exitCode = 1
    return
  }
  const usedArgs = UUID_PATTERN.test(args[0]) ? 1 : 2
  const outPath = args[usedArgs] ?? 'anchor-sample.json'

  const supabase = getServiceRoleClient()
  const assignment = await resolveAssignment(supabase, args)
  if (!assignment) {
    process.exitCode = 1
    return
  }
  const assignmentId = assignment.id

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
