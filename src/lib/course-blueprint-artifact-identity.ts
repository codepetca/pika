export type CourseBlueprintArtifactParseOptions = {
  requireArtifactIds?: boolean
  generateMissingArtifactIds?: boolean
  requirePositions?: boolean
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isCourseBlueprintArtifactId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim())
}

export function createCourseBlueprintArtifactId(): string {
  return crypto.randomUUID()
}

export function resolveCourseBlueprintArtifactId(
  value: unknown,
  options: CourseBlueprintArtifactParseOptions
): string | undefined {
  if (isCourseBlueprintArtifactId(value)) return value.trim().toLowerCase()
  if (options.generateMissingArtifactIds) return createCourseBlueprintArtifactId()
  return undefined
}
