import { formatInTimeZone } from 'date-fns-tz'

const ASSESSMENT_TITLE_TIMEZONE = 'America/Toronto'

const GENERATED_ASSESSMENT_TITLE_PATTERN =
  /^Untitled(?:\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?|\s*\(\d{4}-\d{2}-\d{2}[^)]*\))?$/

export function getFallbackAssessmentTitle(now: Date = new Date()) {
  return `Untitled ${formatInTimeZone(now, ASSESSMENT_TITLE_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')}`
}

export function isGeneratedAssessmentTitle(title: string) {
  return GENERATED_ASSESSMENT_TITLE_PATTERN.test(title.trim())
}

export function getDisplayAssessmentTitle(title: string, generatedTitleLabel = 'Untitled') {
  const cleanTitle = title.trim()
  if (!cleanTitle) return generatedTitleLabel
  return isGeneratedAssessmentTitle(cleanTitle) ? generatedTitleLabel : cleanTitle
}
