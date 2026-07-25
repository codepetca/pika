export function isPalEnabled(): boolean {
  return process.env.PAL_ENABLED?.trim().toLowerCase() === 'true'
}

export function requirePalEnvironment(): {
  apiUrl: string
  integrationSecret: string
  pseudonymSecret: string
} {
  const apiUrl = process.env.PAL_API_URL?.trim()
  const integrationSecret = process.env.PAL_INTEGRATION_SECRET?.trim()
  const pseudonymSecret = process.env.PAL_PSEUDONYM_SECRET?.trim()

  if (!apiUrl || !integrationSecret || !pseudonymSecret) {
    throw new Error(
      'PAL_ENABLED requires PAL_API_URL, PAL_INTEGRATION_SECRET, and PAL_PSEUDONYM_SECRET',
    )
  }
  let parsedApiUrl: URL
  try {
    parsedApiUrl = new URL(apiUrl)
  } catch {
    throw new Error('PAL_API_URL must be a valid http or https URL')
  }
  if (parsedApiUrl.protocol !== 'https:' && parsedApiUrl.protocol !== 'http:') {
    throw new Error('PAL_API_URL must be a valid http or https URL')
  }

  return {
    apiUrl: parsedApiUrl.toString().replace(/\/+$/, ''),
    integrationSecret,
    pseudonymSecret,
  }
}

export function getPalEmbedUrl(): string | null {
  if (!isPalEnabled()) return null

  const apiUrl = process.env.PAL_API_URL?.trim()
  if (!apiUrl) return null

  try {
    const parsedApiUrl = new URL(apiUrl)
    if (parsedApiUrl.protocol !== 'https:' && parsedApiUrl.protocol !== 'http:') {
      return null
    }
    return new URL('/embed/roadmap', parsedApiUrl).toString()
  } catch {
    return null
  }
}
