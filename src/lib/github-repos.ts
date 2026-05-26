export interface ParsedGitHubRepo {
  owner: string
  name: string
  normalizedUrl: string
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

const RESERVED_GITHUB_ROOT_PATHS = new Set([
  'about',
  'apps',
  'blog',
  'business',
  'collections',
  'contact',
  'customer-stories',
  'events',
  'explore',
  'features',
  'integrations',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
])

function buildParsedRepo(owner: string, name: string): ParsedGitHubRepo {
  return {
    owner,
    name,
    normalizedUrl: `https://github.com/${owner}/${name}`,
  }
}

function isGitHubHost(hostname: string): boolean {
  return GITHUB_HOSTS.has(hostname.toLowerCase())
}

function isReservedGitHubRootPath(segment: string): boolean {
  return RESERVED_GITHUB_ROOT_PATHS.has(segment.toLowerCase())
}

export function parseGitHubRepoReference(input: string): ParsedGitHubRepo | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const shorthandMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (shorthandMatch) {
    if (isReservedGitHubRootPath(shorthandMatch[1])) return null
    return buildParsedRepo(shorthandMatch[1], shorthandMatch[2].replace(/\.git$/i, ''))
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(parsed.protocol)) return null
  if (!isGitHubHost(parsed.hostname)) return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const owner = segments[0]
  const rawRepo = segments[1]
  if (!owner || !rawRepo) return null
  if (isReservedGitHubRootPath(owner)) return null

  return buildParsedRepo(owner, rawRepo.replace(/\.git$/i, ''))
}

export function parseGitHubRepoRootReference(input: string): ParsedGitHubRepo | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!/^https?:$/i.test(parsed.protocol)) return null
  if (!isGitHubHost(parsed.hostname)) return null

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null

  const owner = segments[0]
  const rawRepo = segments[1]
  if (!owner || !rawRepo) return null
  if (isReservedGitHubRootPath(owner)) return null

  return buildParsedRepo(owner, rawRepo.replace(/\.git$/i, ''))
}

export function normalizeGitHubRepoUrl(input: string): string | null {
  return parseGitHubRepoReference(input)?.normalizedUrl ?? null
}
