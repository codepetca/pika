import {
  isCourseBlueprintArtifactId,
  resolveCourseBlueprintArtifactId,
  type CourseBlueprintArtifactParseOptions,
} from '@/lib/course-blueprint-artifact-identity'

export type CourseBlueprintMaterialMarkdownRecord = {
  id?: string
  artifact_id?: string
  title: string
  content_markdown: string
  position: number
}

export type CourseBlueprintMaterialsParseResult = {
  materials: CourseBlueprintMaterialMarkdownRecord[]
  errors: string[]
  warnings: string[]
}

export function courseBlueprintMaterialsToMarkdown(
  materials: CourseBlueprintMaterialMarkdownRecord[]
): string {
  const lines: string[] = []
  materials
    .slice()
    .sort((left, right) => left.position - right.position)
    .forEach((material) => {
      lines.push(`## ${material.title}`)
      if (material.artifact_id) lines.push(`Artifact ID: ${material.artifact_id}`)
      lines.push(`Classwork Position: ${material.position}`)
      lines.push('')
      if (material.content_markdown.trim()) {
        lines.push(material.content_markdown.trim())
        lines.push('')
      }
      lines.push('---', '')
    })
  return lines.join('\n').trim()
}

export function markdownToCourseBlueprintMaterials(
  markdown: string,
  existingMaterials: CourseBlueprintMaterialMarkdownRecord[],
  options: CourseBlueprintArtifactParseOptions = {}
): CourseBlueprintMaterialsParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const materials: CourseBlueprintMaterialMarkdownRecord[] = []
  const existingByArtifactId = new Map(
    existingMaterials
      .filter((material) => isCourseBlueprintArtifactId(material.artifact_id))
      .map((material) => [material.artifact_id!, material])
  )
  const existingByTitle = new Map(
    existingMaterials.map((material) => [material.title.trim().toLowerCase(), material])
  )
  const seenArtifactIds = new Set<string>()
  const seenPositions = new Set<number>()
  const seenTitles = new Set<string>()
  let currentTitle = ''
  let currentArtifactId: string | undefined
  let currentPosition: number | undefined
  let contentLines: string[] = []

  const flush = () => {
    const title = currentTitle.trim()
    if (!title) return
    const titleKey = title.toLowerCase()
    const artifactId = resolveCourseBlueprintArtifactId(currentArtifactId, options)
    const position = Number.isInteger(currentPosition)
      ? Number(currentPosition)
      : materials.length

    if (currentArtifactId && !artifactId) {
      errors.push(`Material "${title}" has invalid Artifact ID`)
    } else if (!artifactId && options.requireArtifactIds) {
      errors.push(`Material "${title}" is missing Artifact ID`)
    } else if (artifactId && seenArtifactIds.has(artifactId)) {
      errors.push(`Material "${title}" has duplicate Artifact ID "${artifactId}"`)
    } else if (options.requirePositions && !Number.isInteger(currentPosition)) {
      errors.push(`Material "${title}" is missing Classwork Position`)
    } else if (position < 0 || seenPositions.has(position)) {
      errors.push(`Material "${title}" has invalid or duplicate Classwork Position`)
    } else if (seenTitles.has(titleKey)) {
      errors.push(`Duplicate material title: "${title}"`)
    } else {
      const existing = artifactId
        ? existingByArtifactId.get(artifactId)
        : existingByTitle.get(titleKey)
      materials.push({
        id: existing?.id,
        artifact_id: artifactId ?? existing?.artifact_id,
        title,
        content_markdown: contentLines.join('\n').trim(),
        position,
      })
      if (artifactId) seenArtifactIds.add(artifactId)
      seenPositions.add(position)
      seenTitles.add(titleKey)
    }

    currentTitle = ''
    currentArtifactId = undefined
    currentPosition = undefined
    contentLines = []
  }

  markdown.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
    const titleMatch = line.match(/^##(?!#)\s+(.+)$/)
    if (titleMatch) {
      flush()
      currentTitle = titleMatch[1].trim()
      return
    }
    if (!currentTitle) return
    if (line.trim() === '---') {
      flush()
      return
    }
    const artifactMatch = line.match(/^Artifact ID:\s*(.*)$/i)
    if (artifactMatch) {
      currentArtifactId = artifactMatch[1].trim()
      return
    }
    const positionMatch = line.match(/^Classwork Position:\s*(.*)$/i)
    if (positionMatch) {
      currentPosition = Number(positionMatch[1].trim())
      return
    }
    if (contentLines.length > 0 || line.trim()) contentLines.push(line)
  })
  flush()

  existingMaterials.forEach((material) => {
    if (!seenTitles.has(material.title.trim().toLowerCase())) {
      warnings.push(`Material "${material.title}" not in markdown - will be archived`)
    }
  })

  return { materials, errors, warnings }
}
