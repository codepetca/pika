import { z } from 'zod'

const ref = z.string().min(1).max(128).regex(/^[A-Za-z0-9._~-]+$/)
const connectionSchema = z.object({
  connectionRef: ref, teacherId: z.uuid(), workspaceRef: ref, installationRef: ref,
  apiKey: z.string().regex(/^rl_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/), active: z.boolean().default(true),
}).strict()
export type RepoLightConnection = z.infer<typeof connectionSchema>
export type RepoLightConfig = { enabled: boolean; apiOrigin: string | null; connections: RepoLightConnection[] }
export class RepoLightConfigError extends Error {
  readonly code = 'repolight_not_configured'
  constructor() { super('RepoLight is not configured.'); this.name = 'RepoLightConfigError' }
}
function validateRepoLightOrigin(raw: string, mode: string | undefined): string {
  if (raw.length > 2048 || raw !== raw.trim()) throw new RepoLightConfigError()
  const url = new URL(raw)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(mode === 'development' && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new RepoLightConfigError()
  return url.origin
}
export function parseRepoLightConfig(env: Record<string, string | undefined> = process.env): RepoLightConfig {
  try {
    const flag = env.PIKA_REPOLIGHT_ENABLED ?? 'false'
    if (!['true', 'false'].includes(flag)) throw new RepoLightConfigError()
    const raw = env.REPOLIGHT_TEACHER_CONNECTIONS_JSON ?? '[]'
    if (Buffer.byteLength(raw) > 262144) throw new RepoLightConfigError()
    const connections = z.array(connectionSchema).max(100).parse(JSON.parse(raw))
    const refs = new Set<string>(), activeTeachers = new Set<string>()
    for (const connection of connections) {
      if (refs.has(connection.connectionRef) || (connection.active && activeTeachers.has(connection.teacherId))) throw new RepoLightConfigError()
      refs.add(connection.connectionRef)
      if (connection.active) activeTeachers.add(connection.teacherId)
      if (connections.some(entry => entry.workspaceRef === connection.workspaceRef && entry.teacherId !== connection.teacherId)) throw new RepoLightConfigError()
      const teacherEntries = connections.filter(entry => entry.teacherId === connection.teacherId)
      if (teacherEntries.some(entry => entry.workspaceRef !== connection.workspaceRef || entry.installationRef !== connection.installationRef)) throw new RepoLightConfigError()
    }
    const apiOrigin = env.REPOLIGHT_API_URL ? validateRepoLightOrigin(env.REPOLIGHT_API_URL, env.NODE_ENV) : null
    if (flag === 'true' && (!apiOrigin || !connections.length)) throw new RepoLightConfigError()
    return { enabled: flag === 'true', apiOrigin, connections }
  } catch { throw new RepoLightConfigError() }
}
export function resolveRepoLightConnection(config: RepoLightConfig, teacherId: string, connectionRef?: string): RepoLightConnection {
  const match = config.connections.find(connection => connection.teacherId === teacherId && (connectionRef ? connection.connectionRef === connectionRef : connection.active))
  if (!match || !config.apiOrigin) throw new RepoLightConfigError()
  return match
}
