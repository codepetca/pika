import { parseRepoLightConfig, resolveRepoLightConnection, type RepoLightConfig } from './repolight-config'
import { createManagedRepoLightRegistry, parseManagedRepoLightConfig, parseManagedRepoLightKeyring } from './repolight-managed'
import { createManagedRepoLightServiceDatabase } from './repolight-managed-database'

export type ManagedRepoLightRegistry = Pick<ReturnType<typeof createManagedRepoLightRegistry>, 'ensure' | 'resolveSaved'>
export type RepoLightConnectionDependencies = {
  managedRegistry?: ManagedRepoLightRegistry
  managedConfig?: typeof parseManagedRepoLightConfig
}
function registry(deps: RepoLightConnectionDependencies) {
  return deps.managedRegistry ?? createManagedRepoLightRegistry(createManagedRepoLightServiceDatabase(), {
    config: deps.managedConfig ?? parseManagedRepoLightConfig, keyring: parseManagedRepoLightKeyring,
  })
}
export function validateManagedRepoLightConfiguration(config: RepoLightConfig, deps: RepoLightConnectionDependencies) {
  const managed = (deps.managedConfig ?? parseManagedRepoLightConfig)()
  if (!managed.enabled || managed.apiOrigin !== config.apiOrigin) throw new Error('repolight_not_configured')
}
export async function ensureRepoLightConnection(config: RepoLightConfig, teacherId: string, deps: RepoLightConnectionDependencies) {
  if (config.managedEnabled) {
    validateManagedRepoLightConfiguration(config, deps)
    return registry(deps).ensure(teacherId)
  }
  return { connection: resolveRepoLightConnection(config, teacherId), apiOrigin: config.apiOrigin! }
}
/** Call only after the run/resource or destructive lifecycle has authorized the
 * actor. A saved managed locator remains usable when new provisioning is off. */
export async function resolveSavedRepoLightConnection(teacherId: string, connectionRef: string, deps: RepoLightConnectionDependencies & { config?: typeof parseRepoLightConfig } = {}) {
  if (connectionRef.startsWith('pika_managed_')) return registry(deps).resolveSaved(teacherId, connectionRef)
  const config = (deps.config ?? parseRepoLightConfig)()
  return { connection: resolveRepoLightConnection(config, teacherId, connectionRef), apiOrigin: config.apiOrigin! }
}
