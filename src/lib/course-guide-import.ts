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
  citationMarkdown: string
}

function normalizeProvenanceText(value: string, fallback: string): string {
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\\[\]()*_`<>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function limitedMarkdownUrl(value: string): string | null {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
    ) return null
    const escaped = url.href.replaceAll('(', '%28').replaceAll(')', '%29')
    return escaped.length <= 2048 ? escaped : null
  } catch {
    return null
  }
}

export function buildCourseGuideImportDraft(args: {
  model: CurriculumImportModelResponse
  sourceUrl: string | null
  sourceFilename: string | null
}): CourseGuideImportDraft {
  const links = args.model.source_links
    .map((link) => ({ ...link, url: limitedMarkdownUrl(link.url) }))
    .filter((link): link is { title: string; url: string } => !!link.url)
    .filter((link, index, all) => all.findIndex((candidate) => candidate.url === link.url) === index)
  const sourceTitle = normalizeProvenanceText(args.model.document_title, 'Curriculum source')
  const sourceFilename = args.sourceFilename
    ? normalizeProvenanceText(args.sourceFilename, 'uploaded PDF')
    : null
  const sourceUrl = args.sourceUrl ? new URL(args.sourceUrl).href : null
  const sourceLabel = sourceUrl
    ? `${sourceTitle} — ${sourceUrl}`
    : `${sourceTitle} — ${sourceFilename || 'uploaded PDF'}`
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
      links.map((link) => `- [${normalizeProvenanceText(link.title, 'Source link')}](${link.url})`).join('\n'),
    )
  }
  return {
    sourceTitle,
    sourceUrl,
    sourceFilename,
    sourceLabel,
    overviewMarkdown: args.model.overview_markdown.trim(),
    expectationsMarkdown: args.model.expectations_markdown.trim(),
    sourceLinks: links,
    draftMarkdown: sections.join('\n\n'),
    citationMarkdown: `Source: ${sourceLabel}`,
  }
}

export function addCourseGuideImportCitation(args: {
  reviewedDraftMarkdown: string
  citationMarkdown: string
}): string {
  return `${args.reviewedDraftMarkdown.trim()}\n\n${args.citationMarkdown}`
}

export function appendCourseGuideImport(
  currentOverviewMarkdown: string,
  reviewedDraftMarkdown: string,
): string {
  const hasCurrent = currentOverviewMarkdown.trim().length > 0
  const draft = reviewedDraftMarkdown.trim()
  return hasCurrent ? `${currentOverviewMarkdown}\n\n---\n\n${draft}` : draft
}
