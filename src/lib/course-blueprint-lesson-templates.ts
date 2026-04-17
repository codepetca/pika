export interface CourseBlueprintLessonTemplateMarkdownRecord {
  id?: string
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
  existingLessonTemplates: CourseBlueprintLessonTemplateMarkdownRecord[]
): CourseBlueprintLessonTemplatesParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const lesson_templates: CourseBlueprintLessonTemplateMarkdownRecord[] = []
  const existingByTitle = new Map(existingLessonTemplates.map((lesson) => [lesson.title.toLowerCase(), lesson]))
  const seenTitles = new Set<string>()

  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let currentTitle = ''
  let contentLines: string[] = []

  function flushLesson() {
    const title = currentTitle.trim()
    if (!title) return
    const existing = existingByTitle.get(title.toLowerCase())
    lesson_templates.push({
      id: existing?.id,
      title,
      content_markdown: contentLines.join('\n').trim(),
      position: lesson_templates.length,
    })
    seenTitles.add(title.toLowerCase())
    currentTitle = ''
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
