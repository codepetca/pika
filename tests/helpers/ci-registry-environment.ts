import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loginRegistryAuth } from '../../scripts/ci-supabase-registry-auth.mjs'

/** Real owned config; only Docker login is replaced. Never touches a daemon. */
export function createCiRegistryEnvironment() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pika-ci-registry-fixture-')))
  try {
    const runnerTemp = join(root, 'runner')
    mkdirSync(runnerTemp)
    const githubEnv = join(root, 'github-env')
    writeFileSync(githubEnv, '')
    const input = { GITHUB_ACTIONS: 'true', GITHUB_ACTOR: 'pika-ci',
      SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io', RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: githubEnv, SUPABASE_CI_GHCR_TOKEN: 'fixture-only-token' }
    loginRegistryAuth({ env: input, runDocker: (_binary: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      writeFileSync(join(options.env.DOCKER_CONFIG!, 'config.json'), JSON.stringify({ auths: {
        'ghcr.io': { auth: Buffer.from('pika-ci:fixture-only-token').toString('base64') },
      } }))
      return { status: 0 }
    } })
    const exported = Object.fromEntries(readFileSync(githubEnv, 'utf8').trim().split('\n').map(line => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
    const { SUPABASE_CI_GHCR_TOKEN: _token, ...context } = input
    return { env: { ...context, ...exported }, dispose: () => rmSync(root, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}
