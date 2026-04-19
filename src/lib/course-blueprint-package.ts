import { courseBlueprintAssignmentsToMarkdown, markdownToCourseBlueprintAssignments } from '@/lib/course-blueprint-assignments'
import {
  courseBlueprintAssessmentsToMarkdown,
  markdownToCourseBlueprintAssessments,
  type CourseBlueprintAssessmentMarkdownRecord,
} from '@/lib/course-blueprint-assessments-markdown'
import {
  courseBlueprintLessonTemplatesToMarkdown,
  markdownToCourseBlueprintLessonTemplates,
} from '@/lib/course-blueprint-lesson-templates'
import type {
  CourseBlueprint,
  CourseBlueprintAssignment,
  CourseBlueprintAssessment,
  CourseBlueprintDetail,
  CourseBlueprintLessonTemplate,
  CoursePackageManifest,
} from '@/types'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizePlannedCourseSiteConfig,
} from '@/lib/course-site-publishing'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const COURSE_BLUEPRINT_PACKAGE_FILE_NAMES = [
  'course-overview.md',
  'course-outline.md',
  'resources.md',
  'assignments.md',
  'quizzes.md',
  'tests.md',
  'lesson-plans.md',
] as const

export type CourseBlueprintPackageFileName =
  (typeof COURSE_BLUEPRINT_PACKAGE_FILE_NAMES)[number]

export type CourseBlueprintPackageBundle = {
  manifest: CoursePackageManifest
  files: Record<CourseBlueprintPackageFileName, string>
}

export type CourseBlueprintImportResult = {
  blueprint: Pick<
    CourseBlueprint,
    | 'title'
    | 'subject'
    | 'grade_level'
    | 'course_code'
    | 'term_template'
    | 'overview_markdown'
    | 'outline_markdown'
    | 'resources_markdown'
    | 'planned_site_slug'
    | 'planned_site_published'
    | 'planned_site_config'
  >
  assignments: Array<{
    title: string
    instructions_markdown: string
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    include_in_final: boolean
    is_draft: boolean
    position: number
  }>
  assessments: CourseBlueprintAssessmentMarkdownRecord[]
  lesson_templates: Array<{
    title: string
    content_markdown: string
    position: number
  }>
  errors: string[]
}

export function buildCoursePackageManifest(blueprint: CourseBlueprint): CoursePackageManifest {
  return {
    version: '2',
    exported_at: new Date().toISOString(),
    title: blueprint.title,
    subject: blueprint.subject,
    grade_level: blueprint.grade_level,
    course_code: blueprint.course_code,
    term_template: blueprint.term_template,
    planned_site_slug: blueprint.planned_site_slug,
    planned_site_published: blueprint.planned_site_published,
    planned_site_config: normalizePlannedCourseSiteConfig(blueprint.planned_site_config),
  }
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string) {
  const encoded = textEncoder.encode(value)
  target.set(encoded.slice(0, length), offset)
}

function writeTarOctal(target: Uint8Array, offset: number, length: number, value: number) {
  const octal = Math.max(0, value).toString(8)
  const padded = octal.padStart(length - 1, '0')
  writeTarString(target, offset, length - 1, padded)
  target[offset + length - 1] = 0
}

function buildTarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512)
  writeTarString(header, 0, 100, name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000))

  for (let index = 148; index < 156; index += 1) {
    header[index] = 32
  }

  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) checksum += byte
  const checksumValue = checksum.toString(8).padStart(6, '0')
  writeTarString(header, 148, 6, checksumValue)
  header[154] = 0
  header[155] = 32

  return header
}

function parseTarString(source: Uint8Array, offset: number, length: number): string {
  const raw = source.slice(offset, offset + length)
  const endIndex = raw.findIndex((byte) => byte === 0)
  return textDecoder.decode(endIndex >= 0 ? raw.slice(0, endIndex) : raw).trim()
}

function parseTarOctal(source: Uint8Array, offset: number, length: number): number {
  const value = parseTarString(source, offset, length).replace(/\0/g, '').trim()
  if (!value) return 0
  return Number.parseInt(value, 8) || 0
}

function isZeroTarBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0)
}

export function encodeCourseBlueprintPackageArchive(bundle: CourseBlueprintPackageBundle): Uint8Array {
  const files: Array<{ name: string; content: string }> = [
    { name: 'manifest.json', content: JSON.stringify(bundle.manifest, null, 2) },
    ...COURSE_BLUEPRINT_PACKAGE_FILE_NAMES.map((fileName) => ({
      name: fileName,
      content: bundle.files[fileName] ?? '',
    })),
  ]

  const parts: Uint8Array[] = []

  for (const file of files) {
    const contentBytes = textEncoder.encode(file.content)
    const paddingSize = (512 - (contentBytes.length % 512)) % 512
    parts.push(buildTarHeader(file.name, contentBytes.length))
    parts.push(contentBytes)
    if (paddingSize > 0) parts.push(new Uint8Array(paddingSize))
  }

  parts.push(new Uint8Array(1024))

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const archive = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    archive.set(part, offset)
    offset += part.length
  }

  return archive
}

export function decodeCourseBlueprintPackageArchive(
  input: ArrayBuffer | Uint8Array
): CourseBlueprintPackageBundle | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const extractedFiles = new Map<string, string>()
  let offset = 0

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512)
    if (isZeroTarBlock(header)) break

    const name = parseTarString(header, 0, 100)
    const prefix = parseTarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = parseTarOctal(header, 124, 12)

    offset += 512
    const content = bytes.slice(offset, offset + size)
    extractedFiles.set(fullName, textDecoder.decode(content))
    offset += Math.ceil(size / 512) * 512
  }

  const manifestRaw = extractedFiles.get('manifest.json')
  if (!manifestRaw) return null

  try {
    const manifest = JSON.parse(manifestRaw) as CoursePackageManifest
    const files = Object.fromEntries(
      COURSE_BLUEPRINT_PACKAGE_FILE_NAMES.map((fileName) => [fileName, extractedFiles.get(fileName) ?? ''])
    ) as Record<CourseBlueprintPackageFileName, string>

    return { manifest, files }
  } catch {
    return null
  }
}

export function buildCourseBlueprintExportBundle(detail: CourseBlueprintDetail): CourseBlueprintPackageBundle {
  const assignments = detail.assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    instructions_markdown: assignment.instructions_markdown,
    default_due_days: assignment.default_due_days,
    default_due_time: assignment.default_due_time,
    points_possible: assignment.points_possible,
    include_in_final: assignment.include_in_final,
    is_draft: assignment.is_draft,
    position: assignment.position,
  }))

  const assessments = detail.assessments.map((assessment) => ({
    id: assessment.id,
    assessment_type: assessment.assessment_type,
    title: assessment.title,
    content: assessment.content as any,
    documents: assessment.documents ?? [],
    position: assessment.position,
  }))

  const lessonTemplates = detail.lesson_templates.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    content_markdown: lesson.content_markdown,
    position: lesson.position,
  }))

  return {
    manifest: buildCoursePackageManifest(detail),
    files: {
      'course-overview.md': detail.overview_markdown ?? '',
      'course-outline.md': detail.outline_markdown ?? '',
      'resources.md': detail.resources_markdown ?? '',
      'assignments.md': courseBlueprintAssignmentsToMarkdown(assignments),
      'quizzes.md': courseBlueprintAssessmentsToMarkdown(assessments, 'quiz'),
      'tests.md': courseBlueprintAssessmentsToMarkdown(assessments, 'test'),
      'lesson-plans.md': courseBlueprintLessonTemplatesToMarkdown(lessonTemplates),
    },
  }
}

function normalizeBundle(input: unknown): CourseBlueprintPackageBundle | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>
  if (typeof record.manifest !== 'object' || record.manifest === null) return null
  if (typeof record.files !== 'object' || record.files === null) return null
  return record as CourseBlueprintPackageBundle
}

export function parseCourseBlueprintImportArchive(
  input: ArrayBuffer | Uint8Array
): CourseBlueprintImportResult {
  const bundle = decodeCourseBlueprintPackageArchive(input)
  if (!bundle) {
    return {
      blueprint: {
        title: '',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
        overview_markdown: '',
        outline_markdown: '',
        resources_markdown: '',
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      },
      assignments: [],
      assessments: [],
      lesson_templates: [],
      errors: ['Invalid course package archive'],
    }
  }

  return parseCourseBlueprintImportBundle(bundle)
}

export function parseCourseBlueprintImportBundle(input: unknown): CourseBlueprintImportResult {
  const bundle = normalizeBundle(input)
  if (!bundle) {
    return {
      blueprint: {
        title: '',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
        overview_markdown: '',
        outline_markdown: '',
        resources_markdown: '',
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      },
      assignments: [],
      assessments: [],
      lesson_templates: [],
      errors: ['Invalid course package bundle'],
    }
  }

  const manifest = bundle.manifest
  const files = bundle.files
  const assignmentResult = markdownToCourseBlueprintAssignments(files['assignments.md'] ?? '', [])
  const quizResult = markdownToCourseBlueprintAssessments(files['quizzes.md'] ?? '', [], 'quiz')
  const testResult = markdownToCourseBlueprintAssessments(files['tests.md'] ?? '', [], 'test')
  const lessonResult = markdownToCourseBlueprintLessonTemplates(files['lesson-plans.md'] ?? '', [])

  return {
    blueprint: {
      title: manifest.title ?? '',
      subject: manifest.subject ?? '',
      grade_level: manifest.grade_level ?? '',
      course_code: manifest.course_code ?? '',
      term_template: manifest.term_template ?? '',
      overview_markdown: files['course-overview.md'] ?? '',
      outline_markdown: files['course-outline.md'] ?? '',
      resources_markdown: files['resources.md'] ?? '',
      planned_site_slug: manifest.planned_site_slug ?? null,
      planned_site_published: !!manifest.planned_site_published,
      planned_site_config: manifest.planned_site_config
        ? normalizePlannedCourseSiteConfig(manifest.planned_site_config)
        : DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
    assignments: assignmentResult.assignments,
    assessments: [...quizResult.assessments, ...testResult.assessments].sort((left, right) => left.position - right.position),
    lesson_templates: lessonResult.lesson_templates,
    errors: [
      ...assignmentResult.errors,
      ...quizResult.errors,
      ...testResult.errors,
      ...lessonResult.errors,
    ],
  }
}

export function analyzeCourseBlueprintCompleteness(detail: CourseBlueprintDetail) {
  const missing: string[] = []
  const suggestions: string[] = []

  if (!detail.overview_markdown.trim()) missing.push('course overview')
  if (!detail.outline_markdown.trim()) missing.push('course outline')
  if (!detail.resources_markdown.trim()) missing.push('resources')
  if (detail.assignments.length === 0) missing.push('assignments')
  if (detail.assessments.filter((assessment) => assessment.assessment_type === 'quiz').length === 0) {
    missing.push('quizzes')
  }
  if (detail.assessments.filter((assessment) => assessment.assessment_type === 'test').length === 0) {
    missing.push('tests')
  }
  if (detail.lesson_templates.length === 0) missing.push('lesson templates')

  if (!detail.overview_markdown.trim()) {
    suggestions.push('Draft a short course overview that explains the audience, pacing, and core outcomes.')
  }
  if (!detail.outline_markdown.trim()) {
    suggestions.push('Add a flat course outline with the major topics or sequence for the semester.')
  }
  if (detail.assignments.length < 3) {
    suggestions.push('Add more assignments so each major stretch of the course has at least one reusable task.')
  }
  if (detail.lesson_templates.length < 5) {
    suggestions.push('Add more lesson templates so new classrooms can start with a usable teaching sequence.')
  }

  return {
    missing,
    suggestions,
    counts: {
      assignments: detail.assignments.length,
      quizzes: detail.assessments.filter((assessment) => assessment.assessment_type === 'quiz').length,
      tests: detail.assessments.filter((assessment) => assessment.assessment_type === 'test').length,
      lesson_templates: detail.lesson_templates.length,
    },
  }
}
