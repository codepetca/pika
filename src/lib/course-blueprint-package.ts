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
  COURSE_BLUEPRINT_CURRENT_PACKAGE_FILE_NAMES,
  COURSE_BLUEPRINT_PACKAGE_CONTRACTS,
  COURSE_BLUEPRINT_PACKAGE_VERSION,
  coursePackageBundleSchema,
  type CoursePackageManifest,
  type CoursePackageManifestV5,
  type CoursePackageRawBundle,
  type CoursePackageRawV2,
  type CoursePackageRawV3,
  type CoursePackageRawV4,
  type CoursePackageRawV5,
} from '@/lib/contracts/course-blueprint-package'
import {
  verifyCourseBlueprintPackageArchive,
  verifyCourseBlueprintPackageBundle,
  verifyCourseBlueprintPackageJson,
  type CoursePackageVerificationResult,
  type VerifiedCoursePackage,
} from '@/lib/course-blueprint-package-verification'
import {
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizePlannedCourseSiteConfig,
} from '@/lib/course-site-publishing'
import type { PortableCoursePackageTestDocument } from '@/lib/contracts/course-blueprint-portable-test-documents'
import {
  containsPikaManagedStorageUrl,
  isPikaManagedStorageUrl,
} from '@/lib/course-blueprint-package-storage-policy'
import {
  createCourseBlueprintArtifactId,
  isCourseBlueprintArtifactId,
} from '@/lib/course-blueprint-artifact-identity'

const textEncoder = new TextEncoder()

export { COURSE_BLUEPRINT_PACKAGE_VERSION } from '@/lib/contracts/course-blueprint-package'

export const COURSE_BLUEPRINT_PACKAGE_FILE_NAMES =
  COURSE_BLUEPRINT_CURRENT_PACKAGE_FILE_NAMES

export type CourseBlueprintPackageFileName =
  (typeof COURSE_BLUEPRINT_PACKAGE_FILE_NAMES)[number]

export type CourseBlueprintPackageBundle = CoursePackageRawBundle

export type PortableCourseBlueprintAssessment = Omit<
  CourseBlueprintAssessmentMarkdownRecord,
  'documents'
> & {
  documents: PortableCoursePackageTestDocument[]
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
  assessments: PortableCourseBlueprintAssessment[]
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

declare const verifiedCourseBlueprintPackagePlanBrand: unique symbol

export type VerifiedCourseBlueprintPackagePlan = Omit<
  CourseBlueprintImportResult,
  'manifest' | 'errors'
> & {
  manifest: CoursePackageManifest
  errors: []
  readonly [verifiedCourseBlueprintPackagePlanBrand]: true
}

export type CourseBlueprintPackagePlanResult =
  | { ok: true; plan: VerifiedCourseBlueprintPackagePlan }
  | { ok: false; errors: string[] }

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
): CoursePackageManifestV5 {
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

export function encodeCourseBlueprintPackageArchive(bundle: CourseBlueprintPackageBundle): Uint8Array {
  const parsedBundle = coursePackageBundleSchema.parse(bundle)
  const contract = COURSE_BLUEPRINT_PACKAGE_CONTRACTS[parsedBundle.manifest.version]
  const parsedFiles = parsedBundle.files as Record<string, string>
  const packageFileNames = contract.allowedFiles.filter((fileName) => fileName in parsedFiles)
  const files: Array<{ name: string; content: string }> = [
    { name: 'manifest.json', content: JSON.stringify(parsedBundle.manifest, null, 2) },
    ...packageFileNames.map((fileName) => ({
      name: fileName,
      content: parsedFiles[fileName],
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
  const result = verifyCourseBlueprintPackageArchive(input)
  return result.success ? result.value.bundle : null
}

export function buildCourseBlueprintExportBundle(
  detail: CourseBlueprintDetail,
  source?: Parameters<typeof buildCoursePackageManifest>[1]
): CoursePackageRawV5 {
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
      // Course packages contain exact portable definitions. Runtime storage
      // fields and managed URLs remain owned by Pika and never cross this edge.
      documents: assessment.documents.flatMap((document): PortableCoursePackageTestDocument[] => {
        if (
          document.source === 'link'
          && document.url
          && !isPikaManagedStorageUrl(document.url)
        ) {
          return [{
            id: document.id,
            title: document.title,
            source: 'link',
            url: document.url,
          }]
        }
        if (document.source === 'text' && document.content) {
          return [{
            id: document.id,
            title: document.title,
            source: 'text',
            content: document.content,
          }]
        }
        return []
      }),
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

export type CanonicalPortableCoursePackage = {
  sourceManifest: CoursePackageManifest
  files: Record<CourseBlueprintPackageFileName, string>
  identityAware: boolean
  grading: {
    useWeights: boolean
    assignmentsWeight: number
    testsWeight: number
  }
  plannedSite: {
    slug: string | null
    published: false
    config: CourseBlueprint['planned_site_config']
  }
}

function adaptLegacyFiles(files: Record<string, string>) {
  return {
    'course-overview.md': files['course-overview.md'],
    'course-outline.md': files['course-outline.md'],
    'resources.md': files['resources.md'],
    'assignments.md': files['assignments.md'],
    'tests.md': files['tests.md'],
    'lesson-plans.md': files['lesson-plans.md'],
    'classwork-materials.md': '',
    'surveys.md': '',
  }
}

function adaptLegacyPackage(
  bundle: CoursePackageRawV2 | CoursePackageRawV3 | CoursePackageRawV4,
): CanonicalPortableCoursePackage {
  return {
    sourceManifest: bundle.manifest,
    files: adaptLegacyFiles(bundle.files),
    identityAware: false,
    grading: {
      useWeights: false,
      assignmentsWeight: 70,
      testsWeight: 30,
    },
    plannedSite: {
      slug: bundle.manifest.planned_site_slug ?? null,
      published: false,
      config: bundle.manifest.planned_site_config
        ? normalizePlannedCourseSiteConfig(bundle.manifest.planned_site_config)
        : DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
  }
}

function adaptV5Package(bundle: CoursePackageRawV5): CanonicalPortableCoursePackage {
  return {
    sourceManifest: bundle.manifest,
    files: bundle.files,
    identityAware: true,
    grading: {
      useWeights: bundle.manifest.grading.use_weights,
      assignmentsWeight: bundle.manifest.grading.assignments_weight,
      testsWeight: bundle.manifest.grading.tests_weight,
    },
    plannedSite: {
      slug: bundle.manifest.planned_site_slug ?? null,
      published: false,
      config: bundle.manifest.planned_site_config
        ? normalizePlannedCourseSiteConfig(bundle.manifest.planned_site_config)
        : DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    },
  }
}

export function adaptVerifiedCoursePackage(
  verified: VerifiedCoursePackage,
): CanonicalPortableCoursePackage {
  switch (verified.bundle.manifest.version) {
    case '2':
      return adaptLegacyPackage(verified.bundle as CoursePackageRawV2)
    case '3':
      return adaptLegacyPackage(verified.bundle as CoursePackageRawV3)
    case '4':
      return adaptLegacyPackage(verified.bundle as CoursePackageRawV4)
    case '5':
      return adaptV5Package(verified.bundle as CoursePackageRawV5)
  }
}

function invalidImportResult(
  verification: Extract<CoursePackageVerificationResult, { success: false }>,
): CourseBlueprintImportResult {
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
    errors: verification.issues.map((issue) => issue.message),
  }
}

function parseVerifiedCoursePackage(verified: VerifiedCoursePackage): CourseBlueprintImportResult {
  const portable = adaptVerifiedCoursePackage(verified)
  const manifest = portable.sourceManifest
  const files = portable.files
  const identityAware = portable.identityAware
  const parseOptions = identityAware
    ? { requireArtifactIds: true, requirePositions: true }
    : { generateMissingArtifactIds: true }
  const assignmentResult = markdownToCourseBlueprintAssignments(
    files['assignments.md'],
    [],
    parseOptions
  )
  const testResult = markdownToCourseBlueprintAssessments(
    files['tests.md'],
    [],
    'test',
    { ...parseOptions, portableDocuments: true }
  )
  const lessonResult = markdownToCourseBlueprintLessonTemplates(
    files['lesson-plans.md'],
    [],
    parseOptions
  )
  const materialResult = markdownToCourseBlueprintMaterials(
    files['classwork-materials.md'],
    [],
    parseOptions
  )
  const surveyResult = markdownToCourseBlueprintSurveys(
    files['surveys.md'],
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
        documents: assessment.documents as PortableCoursePackageTestDocument[],
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
  const structuredManagedUrl = parsedContent.assessments.some((assessment) => (
    assessment.documents.some((document) => (
      document.source === 'link'
      && Boolean(document.url)
      && isPikaManagedStorageUrl(document.url!)
    ))
  ))
  const packageStorageErrors = structuredManagedUrl
    || Object.values(files).some((value) => containsPikaManagedStorageUrl(value))
    ? ['Course packages cannot contain Pika-managed storage references']
    : []

  return {
    manifest,
    blueprint: {
      title: manifest.title,
      subject: manifest.subject,
      grade_level: manifest.grade_level,
      course_code: manifest.course_code,
      term_template: manifest.term_template,
      overview_markdown: files['course-overview.md'],
      outline_markdown: files['course-outline.md'],
      resources_markdown: files['resources.md'],
      gradebook_use_weights: portable.grading.useWeights,
      gradebook_assignments_weight: portable.grading.assignmentsWeight,
      gradebook_tests_weight: portable.grading.testsWeight,
      planned_site_slug: portable.plannedSite.slug,
      planned_site_published: portable.plannedSite.published,
      planned_site_config: portable.plannedSite.config,
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
      ...packageStorageErrors,
    ],
  }
}

export function parseCourseBlueprintImportArchive(
  input: ArrayBuffer | Uint8Array,
): CourseBlueprintImportResult {
  const verification = verifyCourseBlueprintPackageArchive(input)
  return verification.success
    ? parseVerifiedCoursePackage(verification.value)
    : invalidImportResult(verification)
}

export function parseCourseBlueprintImportBundle(input: unknown): CourseBlueprintImportResult {
  const verification = verifyCourseBlueprintPackageBundle(input)
  return verification.success
    ? parseVerifiedCoursePackage(verification.value)
    : invalidImportResult(verification)
}

export function parseCourseBlueprintImportJson(
  input: string | ArrayBuffer | Uint8Array,
): CourseBlueprintImportResult {
  const verification = verifyCourseBlueprintPackageJson(input)
  return verification.success
    ? parseVerifiedCoursePackage(verification.value)
    : invalidImportResult(verification)
}

function buildVerifiedCourseBlueprintPackagePlan(
  parsed: CourseBlueprintImportResult,
): CourseBlueprintPackagePlanResult {
  if (parsed.errors.length > 0 || !parsed.manifest) {
    return { ok: false, errors: parsed.errors }
  }
  return {
    ok: true,
    plan: {
      ...parsed,
      manifest: parsed.manifest,
      errors: [],
    } as VerifiedCourseBlueprintPackagePlan,
  }
}

export function planCourseBlueprintPackageBundle(input: unknown): CourseBlueprintPackagePlanResult {
  return buildVerifiedCourseBlueprintPackagePlan(parseCourseBlueprintImportBundle(input))
}

export function planCourseBlueprintPackageJson(
  input: string | ArrayBuffer | Uint8Array,
): CourseBlueprintPackagePlanResult {
  return buildVerifiedCourseBlueprintPackagePlan(parseCourseBlueprintImportJson(input))
}

export function planCourseBlueprintPackageArchive(
  input: ArrayBuffer | Uint8Array,
): CourseBlueprintPackagePlanResult {
  return buildVerifiedCourseBlueprintPackagePlan(parseCourseBlueprintImportArchive(input))
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
