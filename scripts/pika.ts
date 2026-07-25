/**
 * pika.ts — CLI for driving Pika's teacher API headlessly.
 *
 * Curriculum-as-code: author tests and whole courses as markdown files, push
 * them into Pika. Rides the shared contracts the browser already uses
 * (src/lib/test-markdown, src/lib/contracts/course-blueprint-package), so a
 * plain script produces exactly what the UI produces.
 *
 *   pnpm pika login [--email <e> --password <p>]
 *   pnpm pika whoami
 *   pnpm pika test pull <testId> [--out <file.md>]
 *   pnpm pika test push <testId> <file.md> [--yes]
 *   pnpm pika blueprint list
 *   pnpm pika blueprint push <dir> [--yes]
 *   pnpm pika blueprint instantiate <blueprintId> --title <name> [--yes]
 *
 * Writes are DRY-RUN by default; pass --yes to apply. Targets local dev
 * (localhost:3000) unless PIKA_BASE_URL / E2E_BASE_URL is set.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { config } from 'dotenv'
import { login, loadSession, pikaFetch, pikaJson, getBaseUrl } from './pika-api'
import { testToMarkdown, markdownToTest } from '../src/lib/test-markdown'
import type { TestMarkdownSerializeInput } from '../src/lib/test-markdown'
import { decodeCourseBlueprintPackageArchive } from '../src/lib/course-blueprint-package'
import { COURSE_BLUEPRINT_PACKAGE_VERSION } from '../src/lib/contracts/course-blueprint-package'

/**
 * The CLI must run with CWD set to the repo root (the `@/` tsconfig aliases in
 * src/lib resolve from there), so the global wrapper cds in before exec'ing.
 * That would make a user's relative path land in the repo, so paths the user
 * typed are resolved against PIKA_ORIGIN_PWD — where they actually ran it.
 */
const REPO_ROOT = resolve(__dirname, '..')
const ORIGIN_CWD = process.env.PIKA_ORIGIN_PWD || process.cwd()

/** Resolve a user-supplied path against the caller's directory. */
function userPath(input: string): string {
  return isAbsolute(input) ? input : resolve(ORIGIN_CWD, input)
}

config({ path: join(REPO_ROOT, '.env.local') })

type Flags = Record<string, string | boolean>

/** The six markdown files a course package may contain (all optional, default ''). */
const COURSE_PACKAGE_FILES = [
  'course-overview.md',
  'course-outline.md',
  'resources.md',
  'assignments.md',
  'tests.md',
  'lesson-plans.md',
] as const

/**
 * Flags that never take a value. Without this, `--yes` would greedily consume
 * the next positional (e.g. `test push --yes <id> file.md` would read the id as
 * the value of --yes), so flag order would silently break commands.
 */
const BOOLEAN_FLAGS = new Set(['yes', 'replace', 'new'])

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1) // --key=value
      continue
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next // --key value
      i++
    } else {
      flags[body] = true // bare --key
    }
  }
  return { positional, flags }
}

interface TestQuestionRow {
  id: string
  question_type?: TestMarkdownSerializeInput['questions'][number]['question_type']
  question_text: string
  options: string[] | null
  correct_option?: number | null
  answer_key?: string | null
  sample_solution?: string | null
  points?: number
  response_max_chars?: number
  response_monospace?: boolean
}

interface TestDetail {
  test: { id: string; title: string; show_results: boolean; documents?: unknown }
  questions: TestQuestionRow[]
}

function toSerializeInput(detail: TestDetail): TestMarkdownSerializeInput {
  return {
    title: detail.test.title,
    show_results: detail.test.show_results,
    questions: detail.questions.map((q) => ({
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
    documents: (detail.test.documents as TestMarkdownSerializeInput['documents']) ?? undefined,
  }
}

async function cmdLogin(flags: Flags): Promise<void> {
  const email =
    (flags.email as string) || process.env.PIKA_EMAIL || process.env.E2E_TEACHER_EMAIL || 'teacher@example.com'
  const password =
    (flags.password as string) || process.env.PIKA_PASSWORD || process.env.E2E_PASSWORD || 'test1234'
  const session = await login(email, password)
  console.log(`Logged in as ${session.user?.email} (${session.user?.role}) @ ${session.baseUrl}`)
}

async function cmdWhoami(): Promise<void> {
  const session = loadSession()
  if (!session) {
    console.log(`Not logged in (target: ${getBaseUrl()}). Run: pnpm pika login`)
    return
  }
  const { user } = await pikaJson<{ user: { email: string; role: string } }>('/api/auth/me')
  console.log(`${user.email} (${user.role}) @ ${session.baseUrl}`)
}

async function cmdTestPull(testId: string, flags: Flags): Promise<void> {
  const detail = await pikaJson<TestDetail>(`/api/teacher/tests/${testId}`)
  const markdown = testToMarkdown(toSerializeInput(detail))
  if (typeof flags.out === 'string') {
    const out = userPath(flags.out)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, markdown.endsWith('\n') ? markdown : markdown + '\n')
    console.log(`Wrote ${detail.questions.length} question(s) → ${out}`)
  } else {
    process.stdout.write(markdown + '\n')
  }
}

async function cmdTestPush(testId: string, fileArg: string, flags: Flags): Promise<void> {
  const file = userPath(fileArg)
  const markdown = readFileSync(file, 'utf8')
  const parsed = markdownToTest(markdown)
  if (parsed.errors.length > 0) {
    console.error(`Refusing to push — ${parsed.errors.length} parse error(s) in ${file}:`)
    for (const err of parsed.errors) console.error(`  • ${err}`)
    process.exitCode = 1
    return
  }
  const questionCount = parsed.draftContent?.questions.length ?? 0
  console.log(`Parsed ${file}: "${parsed.draftContent?.title}" — ${questionCount} question(s).`)

  if (!flags.yes) {
    console.log(`DRY RUN. Would replace the draft for test ${testId}. Re-run with --yes to apply.`)
    return
  }

  const { draft } = await pikaJson<{ draft: { version: number } }>(`/api/teacher/tests/${testId}/draft`)
  await pikaJson(`/api/teacher/tests/${testId}/draft`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: draft.version, content: parsed.draftContent }),
  })
  console.log(`Pushed ${questionCount} question(s) to test ${testId} (draft v${draft.version} → v${draft.version + 1}).`)
}

interface ClassroomSummary {
  id: string
  title?: string
  archived_at?: string | null
}

async function cmdClassroomList(flags: Flags): Promise<void> {
  const archived = Boolean(flags.archived)
  const data = await pikaJson<{ classrooms?: ClassroomSummary[] }>(
    `/api/teacher/classrooms${archived ? '?archived=true' : ''}`
  )
  const classrooms = data.classrooms ?? []
  if (classrooms.length === 0) {
    console.log(archived ? 'No archived classrooms.' : 'No classrooms.')
    return
  }
  for (const c of classrooms) console.log(`${c.id}  ${c.title ?? '(untitled)'}`)
}

/**
 * Archiving is a reversible toggle on the classroom row: it hides the classroom
 * from the teacher list and blocks student access. It is not the cold-storage
 * export under /archives, which is a separate, feature-gated operation.
 */
async function setClassroomArchived(id: string, archived: boolean, flags: Flags): Promise<void> {
  const verb = archived ? 'Archive' : 'Restore'
  const { classroom } = await pikaJson<{ classroom: ClassroomSummary }>(`/api/teacher/classrooms/${id}`)
  const title = classroom?.title ?? '(untitled)'
  const alreadyArchived = Boolean(classroom?.archived_at)

  if (archived === alreadyArchived) {
    console.log(`"${title}" is already ${archived ? 'archived' : 'active'}. Nothing to do.`)
    return
  }

  if (!flags.yes) {
    console.log(`DRY RUN. Would ${verb.toLowerCase()} "${title}" (${id}) @ ${getBaseUrl()}.`)
    console.log('Re-run with --yes to apply.')
    return
  }

  await pikaJson(`/api/teacher/classrooms/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archived }),
  })

  if (archived) {
    console.log(`Archived "${title}". Students can no longer access it, and it is hidden from your list.`)
    console.log(`Undo with: pika classroom restore ${id} --yes`)
  } else {
    console.log(`Restored "${title}".`)
  }
}

interface BlueprintSummary {
  id: string
  title: string
  course_code?: string | null
}

async function listBlueprints(): Promise<BlueprintSummary[]> {
  const data = await pikaJson<{ blueprints?: BlueprintSummary[] }>('/api/teacher/course-blueprints')
  return data.blueprints ?? []
}

async function cmdBlueprintList(): Promise<void> {
  const blueprints = await listBlueprints()
  if (blueprints.length === 0) {
    console.log('No course blueprints.')
    return
  }
  for (const bp of blueprints) console.log(`${bp.id}  ${bp.title}`)
}

/**
 * Blueprints are authoring templates, so deletion is permanent — there is no
 * archive for them, unlike classrooms. Classrooms instantiated from a blueprint
 * are independent copies; the foreign key is ON DELETE SET NULL, so they keep
 * all their data and only lose the link back to the template.
 */
async function cmdBlueprintDelete(blueprintId: string, flags: Flags): Promise<void> {
  const blueprint = (await listBlueprints()).find((bp) => bp.id === blueprintId)
  if (!blueprint) {
    console.error(`No blueprint ${blueprintId}. List them with: pika blueprint list`)
    process.exitCode = 1
    return
  }

  console.log(`Blueprint "${blueprint.title}" (${blueprintId}) @ ${getBaseUrl()}`)
  console.log('  Deleting removes the template and its assignments, tests and lesson templates.')
  console.log('  Classrooms already created from it keep their data and are not deleted.')
  console.log('  This cannot be undone — re-push the directory to recreate it.')

  if (!flags.yes) {
    console.log('DRY RUN. Re-run with --yes to delete.')
    return
  }

  await pikaJson(`/api/teacher/course-blueprints/${blueprintId}`, { method: 'DELETE' })
  console.log(`Deleted blueprint ${blueprintId}.`)
}

async function cmdBlueprintPull(blueprintId: string, dirArg: string): Promise<void> {
  const dir = userPath(dirArg)
  const res = await pikaFetch(`/api/teacher/course-blueprints/${blueprintId}/export`)
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(`Export failed (${res.status}): ${err.error ?? res.statusText}`)
  }
  const bundle = decodeCourseBlueprintPackageArchive(new Uint8Array(await res.arrayBuffer()))
  if (!bundle) {
    throw new Error('Could not decode the exported course package.')
  }

  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2) + '\n')
  const written: string[] = []
  for (const [name, content] of Object.entries(bundle.files)) {
    writeFileSync(join(dir, name), content.length && !content.endsWith('\n') ? content + '\n' : content)
    if (content.trim().length > 0) written.push(name)
  }
  console.log(`Pulled "${bundle.manifest.title}" → ${dir}`)
  console.log(`  manifest.json + files with content: ${written.length ? written.join(', ') : '(metadata only)'}`)
}

/** Build a course-package bundle from a directory of markdown + manifest.json. */
function readCourseBundle(dirArg: string): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const dir = userPath(dirArg)
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. A course directory needs manifest.json + markdown files.`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  if (!manifest.exported_at) manifest.exported_at = new Date().toISOString()
  if (!manifest.version) manifest.version = COURSE_BLUEPRINT_PACKAGE_VERSION

  const files: Record<string, string> = {}
  for (const name of COURSE_PACKAGE_FILES) {
    const path = join(dir, name)
    files[name] = existsSync(path) ? readFileSync(path, 'utf8') : ''
  }
  return { manifest, files }
}

async function cmdBlueprintPush(dir: string, flags: Flags): Promise<void> {
  const bundle = readCourseBundle(dir)
  const title = String(bundle.manifest.title ?? '')
  const courseCode = String(bundle.manifest.course_code ?? '')
  const present = COURSE_PACKAGE_FILES.filter((f) => bundle.files[f].trim().length > 0)
  console.log(`Course "${title}" from ${dir}`)
  console.log(`  files with content: ${present.length ? present.join(', ') : '(none — metadata only)'}`)

  // Import always CREATES a blueprint. Detect an existing one (by course code,
  // else title) so repeated pushes don't silently accumulate duplicates.
  const existing = (await listBlueprints()).find(
    (bp) => (courseCode && bp.course_code === courseCode) || bp.title === title
  )

  if (existing && !flags.replace && !flags.new) {
    console.error(`A blueprint "${existing.title}" already exists (${existing.id}).`)
    console.error('  --replace  delete it and recreate from this directory')
    console.error('  --new      create a duplicate anyway')
    process.exitCode = 1
    return
  }

  const willReplace = Boolean(existing && flags.replace)
  if (!flags.yes) {
    const action = willReplace ? `replace blueprint ${existing!.id}` : 'import a new blueprint'
    console.log(`DRY RUN. Would ${action}. Re-run with --yes to apply.`)
    return
  }

  if (willReplace) {
    await pikaJson(`/api/teacher/course-blueprints/${existing!.id}`, { method: 'DELETE' })
    console.log(`Deleted existing blueprint ${existing!.id}.`)
  }

  const result = await pikaJson<{ blueprint: { id: string; title: string } }>(
    '/api/teacher/course-blueprints/import',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    }
  )
  console.log(`Imported blueprint ${result.blueprint.id} — "${result.blueprint.title}"`)
  console.log(`Next: pnpm pika blueprint instantiate ${result.blueprint.id} --title "<classroom name>" --semester semester1 --year 2026 --yes`)
}

async function cmdBlueprintInstantiate(blueprintId: string, flags: Flags): Promise<void> {
  const title = (flags.title as string) || ''
  if (!title) {
    console.error('--title <classroom name> is required.')
    process.exitCode = 1
    return
  }
  // The API requires either (semester + year) or (start_date + end_date).
  const body: Record<string, unknown> = { title }
  if (flags.semester) body.semester = flags.semester
  if (flags.year) body.year = Number(flags.year)
  if (flags['start-date']) body.start_date = flags['start-date']
  if (flags['end-date']) body.end_date = flags['end-date']
  if (!body.semester && !body.start_date) {
    console.error('Provide --semester <semester1|semester2> --year <YYYY>, or --start-date/--end-date (YYYY-MM-DD).')
    process.exitCode = 1
    return
  }

  if (!flags.yes) {
    console.log(`DRY RUN. Would create classroom "${title}" from blueprint ${blueprintId}. Re-run with --yes.`)
    return
  }
  const result = await pikaJson<{ classroom: { id: string; name?: string; title?: string } }>(
    `/api/teacher/course-blueprints/${blueprintId}/instantiate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  console.log(`Created classroom ${result.classroom.id} — "${result.classroom.name ?? result.classroom.title ?? title}"`)
}

function printHelp(): void {
  console.log(
    [
      'pika — CLI for Pika teacher operations',
      '',
      'Usage:',
      '  pnpm pika login [--email <e>] [--password <p>]',
      '  pnpm pika whoami',
      '  pnpm pika test pull <testId> [--out <file.md>]',
      '  pnpm pika test push <testId> <file.md> [--yes]',
      '  pnpm pika classroom list [--archived]',
      '  pnpm pika classroom archive <classroomId> [--yes]',
      '  pnpm pika classroom restore <classroomId> [--yes]',
      '  pnpm pika blueprint list',
      '  pnpm pika blueprint pull <blueprintId> <dir>',
      '  pnpm pika blueprint push <dir> [--replace | --new] [--yes]',
      '  pnpm pika blueprint delete <blueprintId> [--yes]',
      '  pnpm pika blueprint instantiate <blueprintId> --title <name>',
      '      (--semester <semester1|semester2> --year <YYYY>) | (--start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>) [--yes]',
      '',
      'Writes are dry-run unless --yes is passed.',
      `Target: ${getBaseUrl()} (set PIKA_BASE_URL to override)`,
    ].join('\n')
  )
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [command, sub, ...rest] = positional

  try {
    switch (command) {
      case 'login':
        await cmdLogin(flags)
        break
      case 'whoami':
        await cmdWhoami()
        break
      case 'test':
        if (sub === 'pull' && rest[0]) await cmdTestPull(rest[0], flags)
        else if (sub === 'push' && rest[0] && rest[1]) await cmdTestPush(rest[0], rest[1], flags)
        else {
          console.error('Usage: pnpm pika test pull <testId> | test push <testId> <file.md>')
          process.exitCode = 1
        }
        break
      case 'classroom':
        if (sub === 'list') await cmdClassroomList(flags)
        else if (sub === 'archive' && rest[0]) await setClassroomArchived(rest[0], true, flags)
        else if (sub === 'restore' && rest[0]) await setClassroomArchived(rest[0], false, flags)
        else {
          console.error(
            'Usage: pnpm pika classroom list [--archived] | classroom archive <id> | classroom restore <id>'
          )
          process.exitCode = 1
        }
        break
      case 'blueprint':
        if (sub === 'list') await cmdBlueprintList()
        else if (sub === 'pull' && rest[0] && rest[1]) await cmdBlueprintPull(rest[0], rest[1])
        else if (sub === 'push' && rest[0]) await cmdBlueprintPush(rest[0], flags)
        else if (sub === 'delete' && rest[0]) await cmdBlueprintDelete(rest[0], flags)
        else if (sub === 'instantiate' && rest[0]) await cmdBlueprintInstantiate(rest[0], flags)
        else {
          console.error(
            'Usage: pnpm pika blueprint list | course pull <id> <dir> | course push <dir> | course instantiate <id> --title <name>'
          )
          process.exitCode = 1
        }
        break
      case undefined:
      case 'help':
      case '--help':
        printHelp()
        break
      default:
        console.error(`Unknown command: ${command}`)
        printHelp()
        process.exitCode = 1
    }
  } catch (err) {
    console.error((err as Error).message)
    process.exitCode = 1
  }
}

void main()
