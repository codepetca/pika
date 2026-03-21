import type { TiptapContent, TiptapMark, TiptapNode } from '@/types'
import { parseGitHubRepoReference } from '@/lib/github-repos'

export type AssignmentArtifactType = 'image' | 'link' | 'repo'

export interface AssignmentArtifact {
  type: AssignmentArtifactType
  url: string
  repo_owner?: string
  repo_name?: string
  normalized_url?: string
}

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
])
const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi

function toHttpUrl(value: string): string | null {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.href
  } catch {
    return null
  }
}

function stripTrailingPunctuation(raw: string): string {
  let url = raw
  while (/[),.;:!?]$/.test(url)) {
    if (url.endsWith(')')) {
      const opening = (url.match(/\(/g) || []).length
      const closing = (url.match(/\)/g) || []).length
      if (closing <= opening) break
    }
    url = url.slice(0, -1)
  }
  return url
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return []

  const matches = text.match(URL_REGEX) || []
  const urls: string[] = []
  for (const candidate of matches) {
    const normalized = toHttpUrl(stripTrailingPunctuation(candidate))
    if (normalized) {
      urls.push(normalized)
    }
  }
  return urls
}

function getLinkMarkHref(mark: TiptapMark): string | null {
  if (mark.type !== 'link') return null
  const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
  return toHttpUrl(href)
}

function isLikelyImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.toLowerCase()
    for (const ext of IMAGE_EXTENSIONS) {
      if (pathname.endsWith(ext)) return true
    }
    return pathname.includes('/submission-images/')
  } catch {
    return false
  }
}

type ArtifactSource = 'image' | 'link'

function walkNode(
  node: TiptapNode,
  pushUrl: (url: string, source: ArtifactSource) => void
): void {
  if (node.type === 'image') {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
    const normalized = toHttpUrl(src)
    if (normalized) {
      pushUrl(normalized, 'image')
    }
  }

  if (node.type === 'text') {
    const text = typeof node.text === 'string' ? node.text : ''
    for (const url of extractUrlsFromText(text)) {
      pushUrl(url, 'link')
    }

    for (const mark of node.marks || []) {
      const href = getLinkMarkHref(mark)
      if (href) {
        pushUrl(href, 'link')
      }
    }
  }

  for (const child of node.content || []) {
    walkNode(child, pushUrl)
  }
}

function parseUnknownContent(content: unknown): TiptapContent | null {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return parsed as TiptapContent
      }
      return null
    } catch {
      return null
    }
  }
  if (typeof content === 'object' && (content as TiptapContent).type === 'doc') {
    return content as TiptapContent
  }
  return null
}

export function extractAssignmentArtifactsFromContent(
  content: TiptapContent
): AssignmentArtifact[] {
  const byUrl = new Map<string, AssignmentArtifact>()

  const pushUrl = (url: string, source: ArtifactSource) => {
    const parsedRepo = source === 'image' || isLikelyImageUrl(url) ? null : parseGitHubRepoReference(url)
    const nextArtifact: AssignmentArtifact =
      source === 'image' || isLikelyImageUrl(url)
        ? { type: 'image', url }
        : parsedRepo
          ? {
              type: 'repo',
              url,
              repo_owner: parsedRepo.owner,
              repo_name: parsedRepo.name,
              normalized_url: parsedRepo.normalizedUrl,
            }
          : { type: 'link', url }
    const previous = byUrl.get(url)

    // If the same URL appears as both link and image, keep image.
    if (previous?.type === 'image' || previous?.type === nextArtifact.type) return
    byUrl.set(url, nextArtifact)
  }

  for (const node of content.content || []) {
    walkNode(node, pushUrl)
  }

  return Array.from(byUrl.values())
}

export function extractAssignmentArtifacts(content: unknown): AssignmentArtifact[] {
  const parsed = parseUnknownContent(content)
  if (!parsed) return []
  return extractAssignmentArtifactsFromContent(parsed)
}

export function summarizeArtifactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const pathParts = parsed.pathname.split('/').filter(Boolean).slice(0, 2)
    return pathParts.length > 0 ? `${host}/${pathParts.join('/')}` : host
  } catch {
    return url
  }
}
