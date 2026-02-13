import type { SyncEntityType } from './types'

export interface TeachAssistClient {
  upsert(entityType: SyncEntityType, payload: Record<string, unknown>): Promise<Record<string, unknown>>
}

function getBaseUrl(): string {
  const value = process.env.TEACHASSIST_BASE_URL?.trim()
  if (!value) throw new Error('Missing TEACHASSIST_BASE_URL')
  return value.replace(/\/$/, '')
}

function getApiKey(): string {
  const value = process.env.TEACHASSIST_API_KEY?.trim()
  if (!value) throw new Error('Missing TEACHASSIST_API_KEY')
  return value
}

function endpointFor(entityType: SyncEntityType): string {
  if (entityType === 'attendance') return '/attendance'
  if (entityType === 'mark') return '/marks'
  return '/report-cards'
}

export class TeachAssistApiClient implements TeachAssistClient {
  async upsert(entityType: SyncEntityType, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${getBaseUrl()}${endpointFor(entityType)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : `TeachAssist API error (${response.status})`
      throw new Error(message)
    }

    return data
  }
}
