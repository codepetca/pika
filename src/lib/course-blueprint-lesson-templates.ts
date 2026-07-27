import {
  isCourseBlueprintArtifactId,
  resolveCourseBlueprintArtifactId,
  type CourseBlueprintArtifactParseOptions,
} from '@/lib/course-blueprint-artifact-identity'

export interface CourseBlueprintLessonTemplateMarkdownRecord {
  id?: string
  artifact_id?: string
  title: string
  content_markdown: string
  position: number
}

export interface CourseBlueprintLessonTemplatesParseResult {
  lesson_templates: CourseBlueprintLessonTemplateMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

export function courseBlueprintLessonTemplatesToMarkdown(
  lessonTemplates: CourseBlueprintLessonTemplateMarkdownRecord[]
): string {
  const lines: string[] = []
  lessonTemplates.forEach((lesson) => {
    lines.push(`## ${lesson.title || `Lesson ${lesson.position + 1}`}`)
    if (lesson.artifact_id) lines.push(`Artifact ID: ${lesson.artifact_id}`)
    lines.push('')
    if (lesson.content_markdown.trim()) {
      lines.push(lesson.content_markdown.trim())
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  })
  return lines.join('\n').trim()
}

export function markdownToCourseBlueprintLessonTemplates(
  markdown: string,
  existingLessonTemplates: CourseBlueprintLessonTemplateMarkdownRecord[],
  options: CourseBlueprintArtifactParseOptions = {}
): CourseBlueprintLessonTemplatesParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const lesson_templates: CourseBlueprintLessonTemplateMarkdownRecord[] = []
  const existingByTitle = new Map(existingLessonTemplates.map((lesson) => [lesson.title.toLowerCase(), lesson]))
  const existingByArtifactId = new Map(
    existingLessonTemplates
      .filter((lesson) => isCourseBlueprintArtifactId(lesson.artifact_id))
      .map((lesson) => [lesson.artifact_id!, lesson])
  )
  const seenTitles = new Set<string>()
  const seenArtifactIds = new Set<string>()

  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let currentTitle = ''
  let currentArtifactId: string | undefined
  let contentLines: string[] = []

  function flushLesson() {
    const title = currentTitle.trim()
    if (!title) return
    const artifactId = resolveCourseBlueprintArtifactId(currentArtifactId, options)
    if (currentArtifactId && !artifactId) {
      errors.push(`Lesson "${title}" has invalid Artifact ID`)
      currentTitle = ''
      currentArtifactId = undefined
      contentLines = []
      return
    }
    if (!artifactId && options.requireArtifactIds) {
      errors.push(`Lesson "${title}" is missing Artifact ID`)
      currentTitle = ''
      currentArtifactId = undefined
      contentLines = []
      return
    }
    if (artifactId && seenArtifactIds.has(artifactId)) {
      errors.push(`Duplicate lesson Artifact ID: "${artifactId}"`)
      currentTitle = ''
      currentArtifactId = undefined
      contentLines = []
      return
    }
    const existing = artifactId
      ? existingByArtifactId.get(artifactId)
      : existingByTitle.get(title.toLowerCase())
    lesson_templates.push({
      id: existing?.id,
      artifact_id: artifactId ?? existing?.artifact_id,
      title,
      content_markdown: contentLines.join('\n').trim(),
      position: lesson_templates.length,
    })
    seenTitles.add(title.toLowerCase())
    if (artifactId) seenArtifactIds.add(artifactId)
    currentTitle = ''
    currentArtifactId = undefined
    contentLines = []
  }

  lines.forEach((line) => {
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      flushLesson()
      currentTitle = match[1].trim()
      return
    }
    if (line.trim() === '---') {
      flushLesson()
      return
    }
    const artifactIdMatch = line.match(/^Artifact ID:\s*(.*)$/i)
    if (currentTitle && artifactIdMatch) {
      currentArtifactId = artifactIdMatch[1].trim()
      return
    }
    if (currentTitle) {
      if (contentLines.length > 0 || line.trim()) {
        contentLines.push(line)
      }
    }
  })
  flushLesson()

  existingLessonTemplates.forEach((lesson) => {
    if (!seenTitles.has(lesson.title.toLowerCase())) {
      warnings.push(`Lesson "${lesson.title}" not in markdown - will be preserved`)
    }
  })

  if (lesson_templates.some((lesson) => !lesson.title)) {
    errors.push('Each lesson template requires a title')
  }

  return { lesson_templates, errors, warnings }
}
