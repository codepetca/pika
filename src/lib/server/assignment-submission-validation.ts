import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { parseGitHubRepoReference } from '@/lib/github-repos'
import {
  normalizeAssignmentSubmissionValidationPolicy,
  type AssignmentSubmissionValidationPolicy,
} from '@/lib/assignment-submission-requirements'
import { validatePublicGitHubRepo } from '@/lib/server/assignment-repo-targets'
import type {
  AssignmentArtifactValidationStatus,
  AssignmentSubmissionRequirementType,
} from '@/types'

const GITHUB_API_BASE = 'https://api.github.com'
const LINK_VALIDATION_TIMEOUT_MS = 3500
const LINK_VALIDATION_REDIRECT_LIMIT = 3
const LINK_VALIDATION_MAX_BODY_CHARS = 24_000

export type ArtifactValidationResult = {
  validation_status: AssignmentArtifactValidationStatus
  validation_message: string | null
  metadata_json: Record<string, unknown>
  normalized_url: string | null
  github_login_validation_status?: 'valid' | 'invalid' | 'inaccessible'
  github_login_validation_message?: string | null
}

type LinkReachabilityResult = {
  ok: boolean
  finalUrl: string
  status: number | null
  title: string | null
  loginLike: boolean
  error: string | null
}

type PublicResolutionResult =
  | { ok: true; address: string; family: 4 | 6 }
  | { ok: false; error: string }

type BoundedHttpResponse = {
  status: number
  location: string | null
  body: string
}

export function getGitHubIdentityValidationFromArtifact(
  validation: ArtifactValidationResult
): {
  validation_status: 'unvalidated' | 'valid' | 'invalid' | 'inaccessible'
  validation_message: string | null
} {
  if (validation.github_login_validation_status === 'valid') {
    return { validation_status: 'valid', validation_message: null }
  }

  if (validation.github_login_validation_status === 'invalid') {
    return {
      validation_status: 'invalid',
      validation_message: validation.github_login_validation_message ?? null,
    }
  }

  if (validation.github_login_validation_status === 'inaccessible') {
    return {
      validation_status: 'inaccessible',
      validation_message: validation.github_login_validation_message ?? null,
    }
  }

  return {
    validation_status: 'unvalidated',
    validation_message: validation.validation_message,
  }
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

async function validatePublicUrlResolution(url: string): Promise<PublicResolutionResult> {
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    return { ok: false, error: 'Enter a public http or https URL.' }
  }

  if (isBlockedPublicLinkHostname(hostname)) {
    return { ok: false, error: 'Enter a public http or https URL.' }
  }

  const literalIpVersion = isIP(normalizeHostnameForIpCheck(hostname))
  if (literalIpVersion === 4 || literalIpVersion === 6) {
    return {
      ok: true,
      address: normalizeHostnameForIpCheck(hostname),
      family: literalIpVersion,
    }
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.length === 0) {
      return { ok: false, error: 'Pika could not resolve this link right now.' }
    }
    if (addresses.some((address) => isBlockedIpAddress(address.address))) {
      return { ok: false, error: 'Enter a public http or https URL.' }
    }
    const selectedAddress = addresses.find((address) => address.family === 4 || address.family === 6)
    if (!selectedAddress || (selectedAddress.family !== 4 && selectedAddress.family !== 6)) {
      return { ok: false, error: 'Pika could not resolve this link right now.' }
    }
    return {
      ok: true,
      address: selectedAddress.address,
      family: selectedAddress.family,
    }
  } catch {
    return { ok: false, error: 'Pika could not resolve this link right now.' }
  }
}

function getComparableHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function hostnameMatchesExpected(hostname: string, expectedDomains: string[]): boolean {
  const comparable = hostname.toLowerCase().replace(/^www\./, '')
  return expectedDomains.some((domain) => comparable === domain || comparable.endsWith(`.${domain}`))
}

function resolveRedirectUrl(currentUrl: string, location: string | null): string | null {
  if (!location) return null

  try {
    return normalizePublicUrl(new URL(location, currentUrl).href)
  } catch {
    return null
  }
}

function getHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) return null
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 140) || null
}

function isLoginLikePage(url: string, html: string): boolean {
  const haystack = `${url}\n${html.slice(0, LINK_VALIDATION_MAX_BODY_CHARS)}`.toLowerCase()
  const loginSignals = [
    'sign in',
    'signin',
    'log in',
    'login',
    'password',
    'authentication required',
    'access denied',
    'permission denied',
    'private',
  ]
  return loginSignals.some((signal) => haystack.includes(signal))
}

async function readSmallResponseBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0

  return await new Promise((resolve, reject) => {
    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (total < LINK_VALIDATION_MAX_BODY_CHARS) {
        const remaining = LINK_VALIDATION_MAX_BODY_CHARS - total
        chunks.push(buffer.subarray(0, remaining))
        total += Math.min(buffer.byteLength, remaining)
      }
      if (total >= LINK_VALIDATION_MAX_BODY_CHARS) {
        response.destroy()
        resolve(Buffer.concat(chunks).subarray(0, LINK_VALIDATION_MAX_BODY_CHARS).toString('utf8'))
      }
    })
    response.on('end', () => {
      resolve(Buffer.concat(chunks).subarray(0, LINK_VALIDATION_MAX_BODY_CHARS).toString('utf8'))
    })
    response.on('error', (error) => {
      if (total >= LINK_VALIDATION_MAX_BODY_CHARS) return
      reject(error)
    })
  })
}

async function requestSmallPublicUrl(
  url: string,
  resolution: Extract<PublicResolutionResult, { ok: true }>
): Promise<BoundedHttpResponse> {
  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const request = isHttps ? httpsRequest : httpRequest
  const options: RequestOptions = {
    protocol: parsed.protocol,
    hostname: resolution.address,
    family: resolution.family,
    port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'GET',
    headers: {
      Host: parsed.host,
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.4',
      Range: `bytes=0-${LINK_VALIDATION_MAX_BODY_CHARS - 1}`,
    },
    timeout: LINK_VALIDATION_TIMEOUT_MS,
    ...(isHttps ? { servername: parsed.hostname } : {}),
  }

  return await new Promise((resolve, reject) => {
    const req = request(options, async (response) => {
      const status = response.statusCode ?? 0
      const locationHeader = response.headers.location
      const location = Array.isArray(locationHeader) ? locationHeader[0] ?? null : locationHeader ?? null

      if (status >= 300 && status < 400) {
        response.resume()
        resolve({ status, location, body: '' })
        return
      }

      try {
        const body = await readSmallResponseBody(response)
        resolve({ status, location, body })
      } catch (error) {
        reject(error)
      }
    })

    req.on('timeout', () => {
      const error = new Error('Request timed out')
      error.name = 'TimeoutError'
      req.destroy(error)
    })
    req.on('error', reject)
    req.end()
  })
}

async function checkPublicLinkReachability(url: string): Promise<LinkReachabilityResult> {
  let currentUrl = url

  for (let redirectCount = 0; redirectCount <= LINK_VALIDATION_REDIRECT_LIMIT; redirectCount += 1) {
    const resolution = await validatePublicUrlResolution(currentUrl)
    if (!resolution.ok) {
      return {
        ok: false,
        finalUrl: currentUrl,
        status: null,
        title: null,
        loginLike: false,
        error: resolution.error,
      }
    }

    try {
      const response = await requestSmallPublicUrl(currentUrl, resolution)

      if (response.status >= 300 && response.status < 400) {
        const nextUrl = resolveRedirectUrl(currentUrl, response.location)
        if (!nextUrl) {
          return {
            ok: false,
            finalUrl: currentUrl,
            status: response.status,
            title: null,
            loginLike: false,
            error: 'Redirect target is not a public URL.',
          }
        }
        currentUrl = nextUrl
        continue
      }

      return {
        ok: response.status >= 200 && response.status < 300,
        finalUrl: currentUrl,
        status: response.status,
        title: getHtmlTitle(response.body),
        loginLike: isLoginLikePage(currentUrl, response.body),
        error: response.status >= 200 && response.status < 300 ? null : `Page returned HTTP ${response.status}.`,
      }
    } catch (error) {
      return {
        ok: false,
        finalUrl: currentUrl,
        status: null,
        title: null,
        loginLike: false,
        error: error instanceof Error && error.name === 'TimeoutError'
          ? 'Pika could not reach this link before the check timed out.'
          : 'Pika could not reach this link right now.',
      }
    }
  }

  return {
    ok: false,
    finalUrl: currentUrl,
    status: null,
    title: null,
    loginLike: false,
    error: 'Link redirected too many times.',
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
  validationPolicy?: Record<string, unknown> | null
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
    let githubLoginValidation: Awaited<ReturnType<typeof validateGitHubLogin>> | null = null

    if (githubLogin) {
      githubLoginValidation = await validateGitHubLogin(githubLogin)
      if (githubLoginValidation.validation_status === 'invalid') {
        return {
          validation_status: 'invalid',
          validation_message: githubLoginValidation.validation_message,
          metadata_json: {
            repo_owner: repoValidation.repoOwner || parsed.owner,
            repo_name: repoValidation.repoName || parsed.name,
            github_login: githubLogin,
          },
          normalized_url: parsed.normalizedUrl,
          github_login_validation_status: githubLoginValidation.validation_status,
          github_login_validation_message: githubLoginValidation.validation_message,
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
      ...(githubLoginValidation
        ? {
            github_login_validation_status: githubLoginValidation.validation_status,
            github_login_validation_message: githubLoginValidation.validation_message,
          }
        : {}),
    }
  }

  const policy: AssignmentSubmissionValidationPolicy = normalizeAssignmentSubmissionValidationPolicy(
    opts.type,
    opts.validationPolicy
  )
  if (policy.mode === 'format_only') {
    return {
      validation_status: 'valid',
      validation_message: null,
      metadata_json: {
        validation: 'format_only',
        validation_level: 'format_only',
      },
      normalized_url: normalizedUrl,
    }
  }

  const initialHostname = getComparableHostname(normalizedUrl)
  if (policy.mode === 'expected_domain' && initialHostname && !hostnameMatchesExpected(initialHostname, policy.expected_domains)) {
    return {
      validation_status: 'invalid',
      validation_message: `Link must point to ${policy.expected_domains.join(' or ')}.`,
      metadata_json: {
        validation: policy.mode,
        validation_level: 'format_only',
        checked_host: initialHostname,
        expected_domains: policy.expected_domains,
      },
      normalized_url: normalizedUrl,
    }
  }

  const reachability = await checkPublicLinkReachability(normalizedUrl)
  const finalHostname = getComparableHostname(reachability.finalUrl)
  const metadata = {
    validation: policy.mode,
    validation_level: 'verified',
    final_url: reachability.finalUrl,
    checked_host: finalHostname,
    http_status: reachability.status,
    page_title: reachability.title,
    expected_domains: policy.expected_domains,
  }

  if (policy.mode === 'expected_domain' && finalHostname && !hostnameMatchesExpected(finalHostname, policy.expected_domains)) {
    return {
      validation_status: 'invalid',
      validation_message: `Link must point to ${policy.expected_domains.join(' or ')}.`,
      metadata_json: metadata,
      normalized_url: normalizedUrl,
    }
  }

  if (!reachability.ok) {
    return {
      validation_status: 'warning',
      validation_message: reachability.error ?? 'Pika could not verify this link right now.',
      metadata_json: {
        ...metadata,
        validation_level: 'review',
      },
      normalized_url: normalizedUrl,
    }
  }

  if (reachability.loginLike) {
    return {
      validation_status: 'warning',
      validation_message: 'This page may require login or extra access. Your teacher may need to review it.',
      metadata_json: {
        ...metadata,
        validation_level: 'review',
        login_like: true,
      },
      normalized_url: normalizedUrl,
    }
  }

  return {
    validation_status: 'valid',
    validation_message: null,
    metadata_json: metadata,
    normalized_url: normalizedUrl,
  }
}
