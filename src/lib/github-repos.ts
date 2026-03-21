export interface ParsedGitHubRepo {
  owner: string
  name: string
  normalizedUrl: string
}

function buildParsedRepo(owner: string, name: string): ParsedGitHubRepo {
  return {
    owner,
    name,
    normalizedUrl: `https://github.com/${owner}/${name}`,
  }
}

export function parseGitHubRepoReference(input: string): ParsedGitHubRepo | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (shorthandMatch) {
    return buildParsedRepo(shorthandMatch[1], shorthandMatch[2].replace(/\.git$/i, ''))
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(parsed.protocol)) return null
  if (!/^www\./i.test(parsed.hostname) && parsed.hostname.toLowerCase() !== 'github.com') return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = segments[0]
  const rawRepo = segments[1]
  if (!owner || !rawRepo) return null

  return buildParsedRepo(owner, rawRepo.replace(/\.git$/i, ''))
}

export function normalizeGitHubRepoUrl(input: string): string | null {
  return parseGitHubRepoReference(input)?.normalizedUrl ?? null
}

