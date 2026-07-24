/**
 * pika-cli-smoke.ts — end-to-end smoke test for the `pika` CLI.
 *
 * Run against a local dev server with seeded data:
 *   pnpm dev            # in another terminal (local Supabase must be up)
 *   pnpm smoke:pika-cli
 *
 * Catches the failure mode that matters: an API or schema change silently
 * breaking the CLI. The markdown round-trip (pull → push → pull) is the
 * drift detector — if a route or contract changes shape, it stops matching.
 *
 * Phases 1-3 are idempotent (no data created). Phase 4 creates a blueprint +
 * classroom and is opt-in via --full.
 */
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from 'dotenv'
import { login, pikaJson } from './pika-api'
import { testToMarkdown, markdownToTest } from '../src/lib/test-markdown'

config({ path: '.env.local' })

const FULL = process.argv.includes('--full')
let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'pika-cli-smoke-'))
  console.log(`pika CLI smoke test${FULL ? ' (--full)' : ''}\n`)

  // ---- Phase 1: auth -------------------------------------------------
  const email = process.env.PIKA_EMAIL || process.env.E2E_TEACHER_EMAIL || 'teacher@example.com'
  const password = process.env.PIKA_PASSWORD || process.env.E2E_PASSWORD || 'test1234'
  const session = await login(email, password)
  check('login', Boolean(session.cookie), session.user?.email)

  const me = await pikaJson<{ user: { email: string; role: string } }>('/api/auth/me')
  check('session cookie roundtrips', me.user.role === 'teacher', `${me.user.email} (${me.user.role})`)

  // ---- Phase 2: discover seeded data ---------------------------------
  const { classrooms = [] } = await pikaJson<{ classrooms: Array<{ id: string; title?: string }> }>(
    '/api/teacher/classrooms'
  )
  check('classrooms readable', classrooms.length > 0, `${classrooms.length} found`)
  if (classrooms.length === 0) {
    console.error('\nNo seeded classrooms. Run `pnpm seed` first.')
    process.exit(1)
  }

  let testId = ''
  for (const classroom of classrooms) {
    const { tests = [] } = await pikaJson<{ tests: Array<{ id: string }> }>(
      `/api/teacher/tests?classroom_id=${classroom.id}`
    )
    if (tests.length > 0) {
      testId = tests[0].id
      break
    }
  }
  check('found a seeded test', Boolean(testId), testId)
  if (!testId) {
    console.error('\nNo seeded tests. Run `pnpm seed` first.')
    process.exit(1)
  }

  // ---- Phase 3: markdown round-trip (the drift detector) -------------
  interface TestDetail {
    test: { title: string; show_results: boolean; documents?: unknown }
    questions: Array<Record<string, unknown>>
  }
  const serialize = (detail: TestDetail): string =>
    testToMarkdown({
      title: detail.test.title,
      show_results: detail.test.show_results,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      questions: detail.questions.map((q: any) => ({
        id: q.id,
        question_type: q.question_type,
        question_text: q.question_text,
        options: q.options ?? [],
        correct_option: q.correct_option,
        answer_key: q.answer_key,
        sample_solution: q.sample_solution,
        points: q.points,
        response_max_chars: q.response_max_chars,
        response_monospace: q.response_monospace,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      documents: (detail.test.documents as any) ?? undefined,
    })

  const before = await pikaJson<TestDetail>(`/api/teacher/tests/${testId}`)
  const pulled = serialize(before)
  const pulledPath = join(workDir, 'pulled.md')
  writeFileSync(pulledPath, pulled)
  check('test pull produced markdown', pulled.includes('## Questions'), `${before.questions.length} question(s)`)

  const parsed = markdownToTest(readFileSync(pulledPath, 'utf8'))
  check('pulled markdown re-parses cleanly', parsed.errors.length === 0, parsed.errors.join('; '))

  const { draft } = await pikaJson<{ draft: { version: number } }>(`/api/teacher/tests/${testId}/draft`)
  await pikaJson(`/api/teacher/tests/${testId}/draft`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: draft.version, content: parsed.draftContent }),
  })
  const after = await pikaJson<TestDetail>(`/api/teacher/tests/${testId}`)
  check('pull → push → pull is stable', serialize(after) === pulled, 'byte-identical')

  // ---- Phase 4 (--full): course creation -----------------------------
  if (FULL) {
    const dir = 'scripts/fixtures/dummy-course'
    const files: Record<string, string> = {}
    for (const name of ['course-overview.md', 'course-outline.md', 'resources.md', 'assignments.md']) {
      files[name] = readFileSync(join(dir, name), 'utf8')
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
    manifest.exported_at = new Date().toISOString()

    const imported = await pikaJson<{ blueprint: { id: string } }>('/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest, files }),
    })
    check('course import', Boolean(imported.blueprint?.id), imported.blueprint?.id)

    const created = await pikaJson<{ classroom: { id: string } }>(
      `/api/teacher/course-blueprints/${imported.blueprint.id}/instantiate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `CLI Smoke ${Date.now()}`, semester: 'semester1', year: 2026 }),
      }
    )
    check('course instantiate', Boolean(created.classroom?.id), created.classroom?.id)

    const { assignments = [] } = await pikaJson<{ assignments: unknown[] }>(
      `/api/teacher/assignments?classroom_id=${created.classroom.id}`
    )
    check('assignments materialized', assignments.length === 3, `${assignments.length}/3`)
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(`\n❌ ${(err as Error).message}`)
  process.exit(1)
})
