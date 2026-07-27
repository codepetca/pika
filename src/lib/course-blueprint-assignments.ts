import {
  DEFAULT_REQUIREMENT_LABELS,
  isAssignmentSubmissionRequirementType,
  normalizeAssignmentSubmissionRequirementDrafts,
  type AssignmentSubmissionRequirementDraft,
} from '@/lib/assignment-submission-requirements'
import {
  isCourseBlueprintArtifactId,
  resolveCourseBlueprintArtifactId,
  type CourseBlueprintArtifactParseOptions,
} from '@/lib/course-blueprint-artifact-identity'

export interface CourseBlueprintAssignmentMarkdownRecord {
  id?: string
  artifact_id?: string
  title: string
  instructions_markdown: string
  submission_requirements?: AssignmentSubmissionRequirementDraft[]
  submission_requirements_json?: AssignmentSubmissionRequirementDraft[]
  default_due_days: number
  default_due_time: string
  points_possible: number | null
  gradebook_weight?: number | null
  include_in_final: boolean
  is_draft: boolean
  track_authenticity?: boolean
  position: number
}

export interface CourseBlueprintAssignmentsParseResult {
  assignments: CourseBlueprintAssignmentMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

export function courseBlueprintAssignmentsToMarkdown(
  assignments: CourseBlueprintAssignmentMarkdownRecord[]
): string {
  const lines: string[] = []

  assignments.forEach((assignment) => {
    lines.push(`## ${assignment.title}${assignment.is_draft ? ' [DRAFT]' : ''}`)
    if (assignment.artifact_id) lines.push(`Artifact ID: ${assignment.artifact_id}`)
    lines.push(`Classwork Position: ${assignment.position}`)
    lines.push(`Due Days: ${assignment.default_due_days}`)
    lines.push(`Due Time: ${assignment.default_due_time}`)
    if (assignment.points_possible !== null && assignment.points_possible !== undefined) {
      lines.push(`Points: ${assignment.points_possible}`)
    }
    lines.push(`Gradebook Weight: ${assignment.gradebook_weight ?? 10}`)
    lines.push(`Include In Final: ${assignment.include_in_final ? 'true' : 'false'}`)
    lines.push(`Track Authenticity: ${assignment.track_authenticity ? 'true' : 'false'}`)
    lines.push('')
    if (assignment.instructions_markdown.trim()) {
      lines.push(assignment.instructions_markdown.trim())
      lines.push('')
    }
    const submissionRequirements = normalizeAssignmentSubmissionRequirementDrafts(
      assignment.submission_requirements || assignment.submission_requirements_json || []
    )
    if (submissionRequirements.length > 0) {
      lines.push('### Submission Requirements')
      submissionRequirements.forEach((requirement) => {
        const requiredLabel = requirement.required === false ? 'optional' : 'required'
        const instructions = requirement.instructions?.trim()
        lines.push([
          `- ${requirement.id ? `${requirement.id} | ` : ''}${requirement.type}`,
          requirement.label?.trim() || DEFAULT_REQUIREMENT_LABELS[requirement.type],
          requiredLabel,
          ...(instructions ? [instructions] : []),
        ].join(' | '))
      })
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  })

  return lines.join('\n').trim()
}

function normalizeLineEndings(markdown: string): string[] {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function markdownToCourseBlueprintAssignments(
  markdown: string,
  existingAssignments: CourseBlueprintAssignmentMarkdownRecord[],
  options: CourseBlueprintArtifactParseOptions = {}
): CourseBlueprintAssignmentsParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const assignments: CourseBlueprintAssignmentMarkdownRecord[] = []
  const existingByTitle = new Map(existingAssignments.map((assignment) => [assignment.title.toLowerCase(), assignment]))
  const existingByArtifactId = new Map(
    existingAssignments
      .filter((assignment) => isCourseBlueprintArtifactId(assignment.artifact_id))
      .map((assignment) => [assignment.artifact_id!, assignment])
  )
  const seenArtifactIds = new Set<string>()
  const seenPositions = new Set<number>()
  const seenTitles = new Set<string>()
  const lines = normalizeLineEndings(markdown)

  let current: Partial<CourseBlueprintAssignmentMarkdownRecord> | null = null
  let instructionLines: string[] = []
  let section: 'instructions' | 'requirements' = 'instructions'
  let lineNumber = 0
  let startLine = 0

  function flushAssignment() {
    if (!current) return

    const title = current.title?.trim()
    if (!title) {
      errors.push(`Assignment at line ${startLine} has no title`)
      current = null
      instructionLines = []
      return
    }

    const titleKey = title.toLowerCase()
    if (seenTitles.has(titleKey)) {
      errors.push(`Duplicate assignment title: "${title}"`)
      current = null
      instructionLines = []
      return
    }

    const defaultDueDays = Number.isInteger(current.default_due_days)
      ? Number(current.default_due_days)
      : NaN
    if (!Number.isFinite(defaultDueDays)) {
      errors.push(`Assignment "${title}" has invalid Due Days`)
      current = null
      instructionLines = []
      return
    }

    const defaultDueTime = String(current.default_due_time ?? '').trim()
    if (!/^\d{2}:\d{2}$/.test(defaultDueTime)) {
      errors.push(`Assignment "${title}" has invalid Due Time`)
      current = null
      instructionLines = []
      return
    }

    const artifactId = resolveCourseBlueprintArtifactId(current.artifact_id, options)
    if (current.artifact_id && !artifactId) {
      errors.push(`Assignment "${title}" has invalid Artifact ID`)
      current = null
      instructionLines = []
      return
    }
    if (!artifactId && options.requireArtifactIds) {
      errors.push(`Assignment "${title}" is missing Artifact ID`)
      current = null
      instructionLines = []
      return
    }
    if (artifactId && seenArtifactIds.has(artifactId)) {
      errors.push(`Duplicate assignment Artifact ID: "${artifactId}"`)
      current = null
      instructionLines = []
      return
    }
    const existing = artifactId
      ? existingByArtifactId.get(artifactId)
      : existingByTitle.get(titleKey)
    const position = Number.isInteger(current.position)
      ? Number(current.position)
      : assignments.length
    if (options.requirePositions && !Number.isInteger(current.position)) {
      errors.push(`Assignment "${title}" is missing Classwork Position`)
      current = null
      instructionLines = []
      return
    }
    if (position < 0 || seenPositions.has(position)) {
      errors.push(`Assignment "${title}" has invalid or duplicate Classwork Position`)
      current = null
      instructionLines = []
      return
    }
    if (
      current.gradebook_weight != null &&
      (!Number.isInteger(current.gradebook_weight) || current.gradebook_weight < 1 || current.gradebook_weight > 999)
    ) {
      errors.push(`Assignment "${title}" has invalid Gradebook Weight`)
      current = null
      instructionLines = []
      return
    }
    seenTitles.add(titleKey)
    if (artifactId) seenArtifactIds.add(artifactId)
    seenPositions.add(position)

    assignments.push({
      id: existing?.id,
      artifact_id: artifactId ?? existing?.artifact_id,
      title,
      instructions_markdown: instructionLines.join('\n').trim(),
      submission_requirements: normalizeAssignmentSubmissionRequirementDrafts(current.submission_requirements || []),
      default_due_days: defaultDueDays,
      default_due_time: defaultDueTime,
      points_possible:
        typeof current.points_possible === 'number' && Number.isFinite(current.points_possible)
          ? current.points_possible
          : null,
      gradebook_weight:
        typeof current.gradebook_weight === 'number' && Number.isInteger(current.gradebook_weight)
          ? current.gradebook_weight
          : existing?.gradebook_weight ?? 10,
      include_in_final: current.include_in_final !== false,
      is_draft: current.is_draft !== false,
      track_authenticity: current.track_authenticity === true,
      position,
    })

    current = null
    instructionLines = []
    section = 'instructions'
  }

  for (const line of lines) {
    lineNumber += 1

    const titleMatch = line.match(/^##(?!#)\s*(.*?)(?:\s+\[DRAFT\])?$/)
    if (titleMatch) {
      flushAssignment()
      startLine = lineNumber
      current = {
        title: titleMatch[1].trim(),
        is_draft: line.includes('[DRAFT]'),
        include_in_final: true,
        default_due_days: 0,
        default_due_time: '23:59',
        submission_requirements: [],
      }
      section = 'instructions'
      continue
    }

    if (!current) continue

    if (line.trim() === '---') {
      flushAssignment()
      continue
    }

    if (/^###\s+Submission Requirements\s*$/i.test(line.trim())) {
      section = 'requirements'
      continue
    }

    if (/^###\s+Instructions\s*$/i.test(line.trim())) {
      section = 'instructions'
      continue
    }

    if (section === 'requirements') {
      const trimmed = line.trim()
      if (!trimmed) continue

      const requirementMatch = trimmed.match(/^-\s*(.+)$/)
      if (!requirementMatch) {
        warnings.push(`Ignoring unrecognized submission requirement at line ${lineNumber}`)
        continue
      }

      const parts = requirementMatch[1].split('|').map((part) => part.trim())
      const hasArtifactId = isCourseBlueprintArtifactId(parts[0])
      const artifactId = resolveCourseBlueprintArtifactId(
        hasArtifactId ? parts[0] : undefined,
        options
      )
      const offset = hasArtifactId ? 1 : 0
      const type = parts[offset]
      if (parts[0] && !hasArtifactId && parts.length >= 5) {
        errors.push(`Submission requirement at line ${lineNumber} has invalid Artifact ID "${parts[0]}"`)
        continue
      }
      if (!artifactId && options.requireArtifactIds) {
        errors.push(`Submission requirement at line ${lineNumber} is missing Artifact ID`)
        continue
      }
      if (!isAssignmentSubmissionRequirementType(type)) {
        errors.push(`Submission requirement at line ${lineNumber} has invalid type "${type}"`)
        continue
      }

      const requiredValue = (parts[offset + 2] || 'required').toLowerCase()
      const requirement: AssignmentSubmissionRequirementDraft = {
        id: artifactId,
        type,
        label: parts[offset + 1] || DEFAULT_REQUIREMENT_LABELS[type],
        required: !['optional', 'false', 'no'].includes(requiredValue),
        instructions: parts.slice(offset + 3).join(' | ').trim(),
        position: current.submission_requirements?.length || 0,
        validation_policy_json: {},
      }
      current.submission_requirements = [
        ...(current.submission_requirements || []),
        requirement,
      ]
      continue
    }

    const fieldMatch = line.match(/^([A-Za-z ]+):\s*(.+)$/)
    if (fieldMatch) {
      const key = fieldMatch[1].trim().toLowerCase()
      const value = fieldMatch[2].trim()
      if (key === 'due days') {
        current.default_due_days = Number(value)
        continue
      }
      if (key === 'artifact id') {
        current.artifact_id = value
        continue
      }
      if (key === 'classwork position') {
        current.position = Number(value)
        continue
      }
      if (key === 'due time') {
        current.default_due_time = value
        continue
      }
      if (key === 'points') {
        current.points_possible = Number(value)
        continue
      }
      if (key === 'gradebook weight') {
        current.gradebook_weight = Number(value)
        continue
      }
      if (key === 'include in final') {
        current.include_in_final = ['true', 'yes', '1'].includes(value.toLowerCase())
        continue
      }
      if (key === 'track authenticity') {
        current.track_authenticity = ['true', 'yes', '1'].includes(value.toLowerCase())
        continue
      }
    }

    if (instructionLines.length > 0 || line.trim()) {
      instructionLines.push(line)
    }
  }

  flushAssignment()

  existingAssignments.forEach((assignment) => {
    if (!seenTitles.has(assignment.title.toLowerCase())) {
      warnings.push(`Assignment "${assignment.title}" not in markdown - will be archived`)
    }
  })

  return { assignments, errors, warnings }
}
