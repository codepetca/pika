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
import {
  courseBlueprintMaterialsToMarkdown,
  markdownToCourseBlueprintMaterials,
} from '@/lib/course-blueprint-materials'
import {
  courseBlueprintSurveysToMarkdown,
  markdownToCourseBlueprintSurveys,
  type CourseBlueprintSurveyMarkdownRecord,
} from '@/lib/course-blueprint-surveys'
import type {
  CourseBlueprint,
  CourseBlueprintAssignment,
  CourseBlueprintAssessment,
  CourseBlueprintDetail,
  CourseBlueprintLessonTemplate,
  CourseBlueprintMaterial,
} from '@/types'
import {
  COURSE_BLUEPRINT_PACKAGE_MAX_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES,
  COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT,
  COURSE_BLUEPRINT_PACKAGE_VERSION,
  coursePackageBundleSchema,
  type CoursePackageManifest,
} from '@/lib/contracts/course-blueprint-package'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizePlannedCourseSiteConfig,
} from '@/lib/course-site-publishing'
import {
  isCurrentPikaManagedTestDocumentUrl,
  stripTestDocumentInternalOwnership,
} from '@/lib/test-documents'
import {
  createCourseBlueprintArtifactId,
  isCourseBlueprintArtifactId,
} from '@/lib/course-blueprint-artifact-identity'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export { COURSE_BLUEPRINT_PACKAGE_VERSION } from '@/lib/contracts/course-blueprint-package'

const LEGACY_COURSE_BLUEPRINT_PACKAGE_FILE_NAMES = [
  'course-overview.md',
  'course-outline.md',
  'resources.md',
  'assignments.md',
  'tests.md',
  'lesson-plans.md',
] as const

export const COURSE_BLUEPRINT_PACKAGE_FILE_NAMES = [
  ...LEGACY_COURSE_BLUEPRINT_PACKAGE_FILE_NAMES,
  'classwork-materials.md',
  'surveys.md',
] as const

const COURSE_BLUEPRINT_PACKAGE_ACCEPTED_ARCHIVE_FILE_NAMES = new Set<string>([
  'manifest.json',
  ...COURSE_BLUEPRINT_PACKAGE_FILE_NAMES,
  'quizzes.md',
])

export type CourseBlueprintPackageFileName =
  (typeof COURSE_BLUEPRINT_PACKAGE_FILE_NAMES)[number]

export type CourseBlueprintPackageBundle = {
  manifest: CoursePackageManifest
  files: Record<CourseBlueprintPackageFileName, string>
}

export class CourseBlueprintPackagePortabilityError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] || 'The course package contains non-portable test documents')
    this.name = 'CourseBlueprintPackagePortabilityError'
  }
}

function testDocumentPortabilityErrors(
  assessments: Array<Pick<CourseBlueprintAssessmentMarkdownRecord, 'title' | 'documents'>>,
): string[] {
  return assessments.flatMap((assessment) => assessment.documents.flatMap((document) => {
    if (document.managed_object_id) {
      return [
        `Test "${assessment.title}" includes uploaded document "${document.title}". `
          + 'Replace it with an external link or remove it before exporting.',
      ]
    }
    if (document.url && isCurrentPikaManagedTestDocumentUrl(document.url)) {
      return [
        `Test "${assessment.title}" document "${document.title}" points to Pika-managed storage. `
          + 'Replace it with an external link or remove it before importing.',
      ]
    }
    return []
  }))
}

export function validateCourseBlueprintPackagePortability(
  detail: Pick<CourseBlueprintDetail, 'assessments'>,
): string[] {
  return testDocumentPortabilityErrors(
    detail.assessments.filter((assessment) => assessment.assessment_type === 'test'),
  )
}

export type CourseBlueprintImportResult = {
  manifest: CoursePackageManifest | null
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
    | 'gradebook_use_weights'
    | 'gradebook_assignments_weight'
    | 'gradebook_tests_weight'
    | 'planned_site_slug'
    | 'planned_site_published'
    | 'planned_site_config'
  >
  assignments: Array<{
    artifact_id?: string
    title: string
    instructions_markdown: string
    submission_requirements?: CourseBlueprintAssignment['submission_requirements_json']
    default_due_days: number
    default_due_time: string
    points_possible: number | null
    gradebook_weight: number
    include_in_final: boolean
    is_draft: boolean
    track_authenticity?: boolean
    position: number
  }>
  assessments: CourseBlueprintAssessmentMarkdownRecord[]
  lesson_templates: Array<{
    artifact_id?: string
    title: string
    content_markdown: string
    position: number
  }>
  materials: Array<{
    artifact_id?: string
    title: string
    content_markdown: string
    position: number
  }>
  surveys: CourseBlueprintSurveyMarkdownRecord[]
  errors: string[]
}

type PortableArtifact = { id?: string; artifact_id?: string }

function normalizeImportedArtifactIds(
  result: Pick<
    CourseBlueprintImportResult,
    'assignments' | 'assessments' | 'lesson_templates' | 'materials' | 'surveys'
  >,
  identityAware: boolean
): string[] {
  const errors: string[] = []
  const used = new Set<string>()
  const artifacts: Array<{
    label: string
    record: PortableArtifact
    key: 'id' | 'artifact_id'
  }> = []

  result.assignments.forEach((assignment, assignmentIndex) => {
    artifacts.push({
      label: `Assignment ${assignmentIndex + 1}`,
      record: assignment,
      key: 'artifact_id',
    })
    assignment.submission_requirements?.forEach((requirement, requirementIndex) => {
      artifacts.push({
        label: `Assignment ${assignmentIndex + 1} submission requirement ${requirementIndex + 1}`,
        record: requirement,
        key: 'id',
      })
    })
  })
  result.assessments.forEach((assessment, assessmentIndex) => {
    artifacts.push({
      label: `Test ${assessmentIndex + 1}`,
      record: assessment,
      key: 'artifact_id',
    })
    assessment.content.questions.forEach((question, questionIndex) => {
      artifacts.push({
        label: `Test ${assessmentIndex + 1} question ${questionIndex + 1}`,
        record: question,
        key: 'id',
      })
    })
    assessment.documents.forEach((document, documentIndex) => {
      artifacts.push({
        label: `Test ${assessmentIndex + 1} document ${documentIndex + 1}`,
        record: document,
        key: 'id',
      })
    })
  })
  result.lesson_templates.forEach((lesson, lessonIndex) => {
    artifacts.push({
      label: `Lesson ${lessonIndex + 1}`,
      record: lesson,
      key: 'artifact_id',
    })
  })
  result.materials.forEach((material, materialIndex) => {
    artifacts.push({
      label: `Material ${materialIndex + 1}`,
      record: material,
      key: 'artifact_id',
    })
  })
  result.surveys.forEach((survey, surveyIndex) => {
    artifacts.push({
      label: `Survey ${surveyIndex + 1}`,
      record: survey,
      key: 'artifact_id',
    })
    survey.questions_json.forEach((question, questionIndex) => {
      artifacts.push({
        label: `Survey ${surveyIndex + 1} question ${questionIndex + 1}`,
        record: question,
        key: 'id',
      })
    })
  })

  artifacts.forEach(({ label, record, key }) => {
    const value = record[key]
    if (!isCourseBlueprintArtifactId(value)) {
      if (identityAware) {
        errors.push(`${label} has invalid or missing Artifact ID`)
        return
      }
      let generated = createCourseBlueprintArtifactId()
      while (used.has(generated)) generated = createCourseBlueprintArtifactId()
      record[key] = generated
      used.add(generated)
      return
    }

    const normalized = value.toLowerCase()
    if (used.has(normalized)) {
      if (identityAware) {
        errors.push(`${label} duplicates Artifact ID "${normalized}"`)
        return
      }
      let generated = createCourseBlueprintArtifactId()
      while (used.has(generated)) generated = createCourseBlueprintArtifactId()
      record[key] = generated
      used.add(generated)
      return
    }

    record[key] = normalized
    used.add(normalized)
  })

  return errors
}

export function buildCoursePackageManifest(
  blueprint: CourseBlueprint,
  source?: {
    blueprintVersionId?: string | null
    blueprintVersionNumber?: number | null
    editingSessionId?: string
  }
): CoursePackageManifest {
  return {
    version: COURSE_BLUEPRINT_PACKAGE_VERSION,
    exported_at: new Date().toISOString(),
    title: blueprint.title,
    subject: blueprint.subject,
    grade_level: blueprint.grade_level,
    course_code: blueprint.course_code,
    term_template: blueprint.term_template,
    blueprint_id: blueprint.id,
    source_draft_revision: blueprint.content_revision,
    blueprint_version_id: source?.blueprintVersionId ?? null,
    blueprint_version_number: source?.blueprintVersionNumber ?? null,
    ...(source?.editingSessionId
      ? { editing_session_id: source.editingSessionId }
      : {}),
    grading: {
      use_weights: blueprint.gradebook_use_weights ?? false,
      assignments_weight: blueprint.gradebook_assignments_weight ?? 70,
      tests_weight: blueprint.gradebook_tests_weight ?? 30,
    },
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
  const parseInput = bundle.manifest.version === '5'
    ? bundle
    : {
        manifest: bundle.manifest,
        files: Object.fromEntries(
          LEGACY_COURSE_BLUEPRINT_PACKAGE_FILE_NAMES.map((fileName) => [
            fileName,
            bundle.files[fileName],
          ])
        ),
      }
  const parsedBundle = coursePackageBundleSchema.parse(parseInput)
  const packageFileNames =
    parsedBundle.manifest.version === '5'
      ? COURSE_BLUEPRINT_PACKAGE_FILE_NAMES
      : LEGACY_COURSE_BLUEPRINT_PACKAGE_FILE_NAMES
  const parsedFiles = parsedBundle.files as Record<string, string>
  const files: Array<{ name: string; content: string }> = [
    { name: 'manifest.json', content: JSON.stringify(parsedBundle.manifest, null, 2) },
    ...packageFileNames.map((fileName) => ({
      name: fileName,
      content: parsedFiles[fileName],
    })),
  ]
  if (
    parsedBundle.manifest.version === '2' &&
    'quizzes.md' in parsedBundle.files
  ) {
    files.push({ name: 'quizzes.md', content: parsedBundle.files['quizzes.md'] })
  }

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
  if (bytes.byteLength > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) return null

  const extractedFiles = new Map<string, string>()
  let offset = 0
  let fileCount = 0

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512)
    if (isZeroTarBlock(header)) break

    const name = parseTarString(header, 0, 100)
    const prefix = parseTarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = parseTarOctal(header, 124, 12)

    fileCount += 1
    if (
      fileCount > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_COUNT ||
      !COURSE_BLUEPRINT_PACKAGE_ACCEPTED_ARCHIVE_FILE_NAMES.has(fullName) ||
      extractedFiles.has(fullName) ||
      size > COURSE_BLUEPRINT_PACKAGE_MAX_FILE_BYTES
    ) {
      return null
    }

    offset += 512
    if (offset + size > bytes.length) return null
    const content = bytes.slice(offset, offset + size)
    extractedFiles.set(fullName, textDecoder.decode(content))
    offset += Math.ceil(size / 512) * 512
  }

  const manifestRaw = extractedFiles.get('manifest.json')
  if (!manifestRaw) return null

  try {
    return normalizeBundle({
      manifest: JSON.parse(manifestRaw),
      files: Object.fromEntries(
        [...extractedFiles.entries()].filter(([fileName]) => fileName !== 'manifest.json')
      ),
    })
  } catch {
    return null
  }
}

export function buildCourseBlueprintExportBundle(
  detail: CourseBlueprintDetail,
  source?: Parameters<typeof buildCoursePackageManifest>[1]
): CourseBlueprintPackageBundle {
  const portabilityErrors = validateCourseBlueprintPackagePortability(detail)
  if (portabilityErrors.length > 0) {
    throw new CourseBlueprintPackagePortabilityError(portabilityErrors)
  }

  const assignments = detail.assignments.map((assignment) => ({
    id: assignment.id,
    artifact_id: assignment.artifact_id,
    title: assignment.title,
    instructions_markdown: assignment.instructions_markdown,
    submission_requirements: assignment.submission_requirements_json || [],
    default_due_days: assignment.default_due_days,
    default_due_time: assignment.default_due_time,
    points_possible: assignment.points_possible,
    gradebook_weight: assignment.gradebook_weight,
    include_in_final: assignment.include_in_final,
    is_draft: assignment.is_draft,
    track_authenticity: assignment.track_authenticity ?? false,
    position: assignment.position,
  }))

  const assessments = detail.assessments
    .filter((assessment) => assessment.assessment_type === 'test')
    .map((assessment) => ({
      id: assessment.id,
      artifact_id: assessment.artifact_id,
      assessment_type: 'test' as const,
      title: assessment.title,
      content: assessment.content as any,
      documents: stripTestDocumentInternalOwnership(assessment.documents),
      points_possible: assessment.points_possible,
      gradebook_weight: assessment.gradebook_weight,
      include_in_final: assessment.include_in_final,
      position: assessment.position,
    }))

  const lessonTemplates = detail.lesson_templates.map((lesson) => ({
    id: lesson.id,
    artifact_id: lesson.artifact_id,
    title: lesson.title,
    content_markdown: lesson.content_markdown,
    position: lesson.position,
  }))
  const materials: CourseBlueprintMaterial[] = detail.materials || []
  const surveys = detail.surveys || []

  return {
    manifest: buildCoursePackageManifest(detail, source),
    files: {
      'course-overview.md': detail.overview_markdown ?? '',
      'course-outline.md': detail.outline_markdown ?? '',
      'resources.md': detail.resources_markdown ?? '',
      'assignments.md': courseBlueprintAssignmentsToMarkdown(assignments),
      'tests.md': courseBlueprintAssessmentsToMarkdown(assessments, 'test'),
      'lesson-plans.md': courseBlueprintLessonTemplatesToMarkdown(lessonTemplates),
      'classwork-materials.md': courseBlueprintMaterialsToMarkdown(materials),
      'surveys.md': courseBlueprintSurveysToMarkdown(surveys),
    },
  }
}

function normalizeBundle(input: unknown): CourseBlueprintPackageBundle | null {
  const inputRecord = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : null
  const manifestRecord =
    inputRecord?.manifest && typeof inputRecord.manifest === 'object'
      ? inputRecord.manifest as Record<string, unknown>
      : null
  const filesRecord =
    inputRecord?.files && typeof inputRecord.files === 'object'
      ? inputRecord.files as Record<string, unknown>
      : {}
  const version = manifestRecord?.version
  const normalizedInput = version === '4' || version === '5'
    ? input
    : {
        manifest: inputRecord?.manifest,
        files: {
          ...Object.fromEntries(
            LEGACY_COURSE_BLUEPRINT_PACKAGE_FILE_NAMES
              .filter((fileName) => fileName in filesRecord)
              .map((fileName) => [fileName, filesRecord[fileName]])
          ),
          ...(version === '2' && 'quizzes.md' in filesRecord
            ? { 'quizzes.md': filesRecord['quizzes.md'] }
            : {}),
        },
      }
  const parsed = coursePackageBundleSchema.safeParse(normalizedInput)
  if (!parsed.success) return null

  return {
    manifest: parsed.data.manifest,
    files: Object.fromEntries(
      COURSE_BLUEPRINT_PACKAGE_FILE_NAMES.map((fileName) => [
        fileName,
        (parsed.data.files as Record<string, string>)[fileName],
      ])
        .map(([fileName, content]) => [fileName, content ?? ''])
    ) as Record<CourseBlueprintPackageFileName, string>,
  }
}

export function parseCourseBlueprintImportArchive(
  input: ArrayBuffer | Uint8Array
): CourseBlueprintImportResult {
  const bundle = decodeCourseBlueprintPackageArchive(input)
  if (!bundle) {
    return {
      manifest: null,
      blueprint: {
        title: '',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
        overview_markdown: '',
        outline_markdown: '',
        resources_markdown: '',
        gradebook_use_weights: false,
        gradebook_assignments_weight: 70,
        gradebook_tests_weight: 30,
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      },
      assignments: [],
      assessments: [],
      lesson_templates: [],
      materials: [],
      surveys: [],
      errors: ['Invalid course package archive'],
    }
  }

  return parseCourseBlueprintImportBundle(bundle)
}

export function parseCourseBlueprintImportBundle(input: unknown): CourseBlueprintImportResult {
  const bundle = normalizeBundle(input)
  if (!bundle) {
    return {
      manifest: null,
      blueprint: {
        title: '',
        subject: '',
        grade_level: '',
        course_code: '',
        term_template: '',
        overview_markdown: '',
        outline_markdown: '',
        resources_markdown: '',
        gradebook_use_weights: false,
        gradebook_assignments_weight: 70,
        gradebook_tests_weight: 30,
        planned_site_slug: null,
        planned_site_published: false,
        planned_site_config: DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      },
      assignments: [],
      assessments: [],
      lesson_templates: [],
      materials: [],
      surveys: [],
      errors: ['Invalid course package bundle'],
    }
  }

  const manifest = bundle.manifest
  const files = bundle.files
  const identityAware = manifest.version === '5'
  const parseOptions = identityAware
    ? { requireArtifactIds: true, requirePositions: true }
    : { generateMissingArtifactIds: true }
  const assignmentResult = markdownToCourseBlueprintAssignments(
    files['assignments.md'] ?? '',
    [],
    parseOptions
  )
  const testResult = markdownToCourseBlueprintAssessments(
    files['tests.md'] ?? '',
    [],
    'test',
    parseOptions
  )
  const lessonResult = markdownToCourseBlueprintLessonTemplates(
    files['lesson-plans.md'] ?? '',
    [],
    parseOptions
  )
  const materialResult = markdownToCourseBlueprintMaterials(
    files['classwork-materials.md'] ?? '',
    [],
    parseOptions
  )
  const surveyResult = markdownToCourseBlueprintSurveys(
    files['surveys.md'] ?? '',
    [],
    parseOptions
  )
  const parsedContent = {
    assignments: assignmentResult.assignments.map((assignment) => ({
      ...assignment,
      gradebook_weight: assignment.gradebook_weight ?? 10,
    })),
    assessments: testResult.assessments
      .map((assessment) => ({
        ...assessment,
        points_possible: assessment.points_possible ?? null,
        gradebook_weight: assessment.gradebook_weight ?? 10,
        include_in_final: assessment.include_in_final ?? true,
      }))
      .sort((left, right) => left.position - right.position),
    lesson_templates: lessonResult.lesson_templates,
    materials: materialResult.materials,
    surveys: surveyResult.surveys,
  }
  const identityErrors = normalizeImportedArtifactIds(parsedContent, identityAware)
  const classworkPositions = [
    ...parsedContent.assignments.map((item) => ({
      label: `Assignment "${item.title}"`,
      position: item.position,
    })),
    ...parsedContent.materials.map((item) => ({
      label: `Material "${item.title}"`,
      position: item.position,
    })),
    ...parsedContent.surveys.map((item) => ({
      label: `Survey "${item.title}"`,
      position: item.position,
    })),
  ]
  const seenClassworkPositions = new Set<number>()
  const positionErrors = identityAware
    ? classworkPositions.flatMap(({ label, position }) => {
        if (seenClassworkPositions.has(position)) {
          return [`${label} duplicates Classwork Position ${position}`]
        }
        seenClassworkPositions.add(position)
        return []
      })
    : []
  const portabilityErrors = testDocumentPortabilityErrors(parsedContent.assessments)

  return {
    manifest,
    blueprint: {
      title: manifest.title ?? '',
      subject: manifest.subject ?? '',
      grade_level: manifest.grade_level ?? '',
      course_code: manifest.course_code ?? '',
      term_template: manifest.term_template ?? '',
      overview_markdown: files['course-overview.md'] ?? '',
      outline_markdown: files['course-outline.md'] ?? '',
      resources_markdown: files['resources.md'] ?? '',
      gradebook_use_weights:
        manifest.version === '5' ? manifest.grading.use_weights : false,
      gradebook_assignments_weight:
        manifest.version === '5' ? manifest.grading.assignments_weight : 70,
      gradebook_tests_weight:
        manifest.version === '5' ? manifest.grading.tests_weight : 30,
      planned_site_slug: manifest.planned_site_slug ?? null,
      // Package and repository input may describe a previously published site,
      // but importing content is never itself a publish action.
      planned_site_published: false,
      planned_site_config: manifest.planned_site_config
        ? normalizePlannedCourseSiteConfig(manifest.planned_site_config)
        : DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
    assignments: parsedContent.assignments,
    assessments: parsedContent.assessments,
    lesson_templates: parsedContent.lesson_templates,
    materials: parsedContent.materials,
    surveys: parsedContent.surveys,
    errors: [
      ...assignmentResult.errors,
      ...testResult.errors,
      ...lessonResult.errors,
      ...materialResult.errors,
      ...surveyResult.errors,
      ...identityErrors,
      ...positionErrors,
      ...portabilityErrors,
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
      tests: detail.assessments.filter((assessment) => assessment.assessment_type === 'test').length,
      lesson_templates: detail.lesson_templates.length,
      materials: detail.materials.length,
      surveys: detail.surveys.length,
    },
  }
}
