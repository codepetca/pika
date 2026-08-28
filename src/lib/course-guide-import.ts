import type { CurriculumImportModelResponse } from '@/lib/validations/course-guide-import'

export type CourseGuideImportLink = {
  title: string
  url: string
}

export type CourseGuideImportDraft = {
  sourceTitle: string
  sourceUrl: string | null
  sourceFilename: string | null
  sourceLabel: string
  overviewMarkdown: string
  expectationsMarkdown: string
  sourceLinks: CourseGuideImportLink[]
  draftMarkdown: string
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll('[', '').replaceAll(']', '').trim()
}

function isSafeLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function buildCourseGuideImportDraft(args: {
  model: CurriculumImportModelResponse
  sourceUrl: string | null
  sourceFilename: string | null
}): CourseGuideImportDraft {
  const links = args.model.source_links
    .filter((link) => isSafeLink(link.url))
    .filter((link, index, all) => all.findIndex((candidate) => candidate.url === link.url) === index)
  const sourceTitle = args.model.document_title.trim()
  const sourceLabel = args.sourceUrl
    ? `[${escapeMarkdownLabel(sourceTitle)}](${args.sourceUrl})`
    : `${escapeMarkdownLabel(sourceTitle)} (${args.sourceFilename || 'uploaded PDF'})`
  const sections = [
    '## Curriculum overview',
    args.model.overview_markdown.trim(),
  ]

  if (args.model.expectations_markdown.trim()) {
    sections.push('## Expectations', args.model.expectations_markdown.trim())
  }
  if (links.length > 0) {
    sections.push(
      '## Source links',
      links.map((link) => `- [${escapeMarkdownLabel(link.title)}](${link.url})`).join('\n'),
    )
  }
  return {
    sourceTitle,
    sourceUrl: args.sourceUrl,
    sourceFilename: args.sourceFilename,
    sourceLabel,
    overviewMarkdown: args.model.overview_markdown.trim(),
    expectationsMarkdown: args.model.expectations_markdown.trim(),
    sourceLinks: links,
    draftMarkdown: sections.join('\n\n'),
  }
}

export function addCourseGuideImportCitation(args: {
  reviewedDraftMarkdown: string
  sourceTitle: string
  sourceUrl: string | null
  sourceFilename: string | null
}): string {
  const title = escapeMarkdownLabel(args.sourceTitle)
  const source = args.sourceUrl
    ? `[${title}](<${args.sourceUrl}>)`
    : `${title} (${escapeMarkdownLabel(args.sourceFilename || 'uploaded PDF')})`
  return `${args.reviewedDraftMarkdown.trim()}\n\nSource: ${source}`
}

export function appendCourseGuideImport(
  currentOverviewMarkdown: string,
  reviewedDraftMarkdown: string,
): string {
  const current = currentOverviewMarkdown.trim()
  const draft = reviewedDraftMarkdown.trim()
  return current ? `${current}\n\n---\n\n${draft}` : draft
}
