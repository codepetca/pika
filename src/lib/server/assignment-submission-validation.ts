import { isIP } from 'node:net'
import { parseGitHubRepoReference } from '@/lib/github-repos'
import { validatePublicGitHubRepo } from '@/lib/server/assignment-repo-targets'
import type {
  AssignmentArtifactValidationStatus,
  AssignmentSubmissionRequirementType,
} from '@/types'

const GITHUB_API_BASE = 'https://api.github.com'

export type ArtifactValidationResult = {
  validation_status: AssignmentArtifactValidationStatus
  validation_message: string | null
  metadata_json: Record<string, unknown>
  normalized_url: string | null
}

export function normalizeGitHubLogin(value: string | null | undefined): string | null {
  const login = String(value ?? '').trim().replace(/^@+/, '')
  if (!login) return null
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) {
    return null
  }
  return login
}

function normalizeHostnameForIpCheck(hostname: string): string {
  const normalized = hostname.toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1)
  }
  return normalized
}

function getIpv4Parts(address: string): number[] | null {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return parts
}

function isBlockedIpv4Address(address: string): boolean {
  const parts = getIpv4Parts(address)
  if (!parts) return false

  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isBlockedIpv6Address(address: string): boolean {
  const normalized = normalizeHostnameForIpCheck(address)
  if (normalized === '::' || normalized === '::1') return true

  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappedIpv4?.[1]) {
    return isBlockedIpv4Address(mappedIpv4[1])
  }
  if (normalized.startsWith('::ffff:')) return true

  const [firstRaw, secondRaw] = normalized.split(':')
  const first = Number.parseInt(firstRaw || '0', 16)
  const second = Number.parseInt(secondRaw || '0', 16)
  if (!Number.isFinite(first)) return false

  return (
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xfec0 && first <= 0xfeff) ||
    (first >= 0xff00 && first <= 0xffff) ||
    (first === 0x0100 && second === 0) ||
    (first === 0x2001 && second === 0x0db8)
  )
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeHostnameForIpCheck(address)
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return isBlockedIpv4Address(normalized)
  if (ipVersion === 6) return isBlockedIpv6Address(normalized)
  return false
}

export function isBlockedPublicLinkHostname(hostname: string): boolean {
  const normalized = normalizeHostnameForIpCheck(hostname)
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isBlockedIpAddress(normalized)
  )
}

export function normalizePublicUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (isBlockedPublicLinkHostname(parsed.hostname)) return null
    return parsed.href
  } catch {
    return null
  }
}

function getGitHubToken(): string | null {
  const key = process.env.GITHUB_PAT?.trim() || process.env.GITHUB_FEEDBACK_TOKEN?.trim() || ''
  return key || null
}

export async function validateGitHubLogin(login: string): Promise<{
  validation_status: 'valid' | 'invalid' | 'inaccessible'
  validation_message: string | null
}> {
  const normalized = normalizeGitHubLogin(login)
  if (!normalized) {
    return {
      validation_status: 'invalid',
      validation_message: 'Enter a valid GitHub username.',
    }
  }

  const token = getGitHubToken()
  const res = await fetch(`${GITHUB_API_BASE}/users/${encodeURIComponent(normalized)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })

  if (res.status === 404) {
    return {
      validation_status: 'invalid',
      validation_message: 'GitHub username was not found.',
    }
  }

  if (!res.ok) {
    return {
      validation_status: 'inaccessible',
      validation_message: 'Pika could not verify this GitHub username right now.',
    }
  }

  return {
    validation_status: 'valid',
    validation_message: null,
  }
}

export async function validateAssignmentSubmissionArtifactValue(opts: {
  type: AssignmentSubmissionRequirementType
  url?: string | null
  storagePath?: string | null
  githubLogin?: string | null
}): Promise<ArtifactValidationResult> {
  if (opts.type === 'image') {
    if (!opts.storagePath?.trim()) {
      return {
        validation_status: 'invalid',
        validation_message: 'Upload an image for this requirement.',
        metadata_json: {},
        normalized_url: null,
      }
    }
    return {
      validation_status: 'valid',
      validation_message: null,
      metadata_json: {},
      normalized_url: opts.url?.trim() || null,
    }
  }

  const normalizedUrl = normalizePublicUrl(opts.url)
  if (!normalizedUrl) {
    return {
      validation_status: 'invalid',
      validation_message: 'Enter a public http or https URL.',
      metadata_json: {},
      normalized_url: null,
    }
  }

  if (opts.type === 'repo_link') {
    const parsed = parseGitHubRepoReference(normalizedUrl)
    if (!parsed) {
      return {
        validation_status: 'invalid',
        validation_message: 'Repo link must point to a GitHub repository.',
        metadata_json: {},
        normalized_url: null,
      }
    }

    const repoValidation = await validatePublicGitHubRepo(normalizedUrl)
    const githubLogin = normalizeGitHubLogin(opts.githubLogin)

    if (githubLogin) {
      const loginValidation = await validateGitHubLogin(githubLogin)
      if (loginValidation.validation_status === 'invalid') {
        return {
          validation_status: 'invalid',
          validation_message: loginValidation.validation_message,
          metadata_json: {
            repo_owner: repoValidation.repoOwner || parsed.owner,
            repo_name: repoValidation.repoName || parsed.name,
            github_login: githubLogin,
          },
          normalized_url: parsed.normalizedUrl,
        }
      }
    }

    return {
      validation_status: repoValidation.validationStatus === 'valid'
        ? 'valid'
        : repoValidation.validationStatus === 'invalid'
          ? 'invalid'
          : 'inaccessible',
      validation_message: repoValidation.validationMessage,
      metadata_json: {
        repo_owner: repoValidation.repoOwner || parsed.owner,
        repo_name: repoValidation.repoName || parsed.name,
        normalized_url: repoValidation.repoUrl || parsed.normalizedUrl,
        default_branch: repoValidation.defaultBranch,
        ...(githubLogin ? { github_login: githubLogin } : {}),
      },
      normalized_url: repoValidation.repoUrl || parsed.normalizedUrl,
    }
  }

  return {
    validation_status: 'valid',
    validation_message: null,
    metadata_json: { validation: 'format_only' },
    normalized_url: normalizedUrl,
  }
}
