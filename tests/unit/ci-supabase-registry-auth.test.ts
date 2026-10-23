import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupRegistryAuth, loginRegistryAuth, runRegistryAuthCli } from '../../scripts/ci-supabase-registry-auth.mjs'

type DockerOptions = {
  input: string
  env: NodeJS.ProcessEnv
  timeout: number
  killSignal: string
  maxBuffer: number
  stdio: string[]
}
type DockerResult = { status: number | null; signal?: string; error?: Error; stdout?: string; stderr?: string }

describe('job-owned Supabase CI registry authentication', () => {
  let root: string
  let env: NodeJS.ProcessEnv
  let operatorConfig: string
  const secret = 'ghs_unit_test_private_credential'
  const docker = vi.fn<(binary: string, args: string[], options: DockerOptions) => DockerResult>()

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'pika-registry-auth-test-')))
    const runnerTemp = join(root, 'runner')
    mkdirSync(runnerTemp)
    operatorConfig = join(root, 'operator-docker')
    mkdirSync(operatorConfig)
    writeFileSync(join(operatorConfig, 'config.json'), '{"auths":{"operator":"keep"}}')
    const githubEnv = join(root, 'github-env')
    writeFileSync(githubEnv, '')
    env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTOR: 'pika-ci[bot]',
      SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io',
      SUPABASE_CI_GHCR_TOKEN: secret,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: githubEnv,
      DOCKER_CONFIG: operatorConfig,
      PATH: '/fake-ci/bin',
    }
    docker.mockReset().mockReturnValue({ status: 0 })
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function exportedEnv() {
    return Object.fromEntries(readFileSync(env.GITHUB_ENV!, 'utf8').trim().split('\n').map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }))
  }

  function login() {
    return loginRegistryAuth({ env, runDocker: docker })
  }

  it('sends credentials only through stdin with a private isolated config and bounded Docker call', () => {
    const previousUmask = process.umask()
    docker.mockImplementation((binary, args, options) => {
      expect(binary).toBe('docker')
      expect(args).toEqual(['login', 'ghcr.io', '--username', 'pika-ci[bot]', '--password-stdin'])
      expect(options.input).toBe(`${secret}\n`)
      expect(options.env.SUPABASE_CI_GHCR_TOKEN).toBeUndefined()
      expect(options.env.DOCKER_CONFIG).not.toBe(operatorConfig)
      expect(options.env.PATH).toBe('/fake-ci/bin')
      // A populated fixed-host entry disables Docker's platform helper discovery.
      // Otherwise an installed helper can persist the token outside this config.
      expect(JSON.parse(readFileSync(join(options.env.DOCKER_CONFIG!, 'config.json'), 'utf8'))).toEqual({ auths: { 'ghcr.io': {} } })
      expect(options).toMatchObject({ timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
      expect(JSON.stringify({ binary, args, env: options.env })).not.toContain(secret)
      expect(process.umask()).toBe(0o077)
      // Paths must be durable in GITHUB_ENV before any interruptible child runs.
      expect(exportedEnv()).toEqual({ DOCKER_CONFIG: options.env.DOCKER_CONFIG, PIKA_CI_REGISTRY_AUTH_DIR: options.env.DOCKER_CONFIG })
      writeFileSync(join(options.env.DOCKER_CONFIG!, 'config.json'), 'fake Docker credentials')
      return { status: 0, stdout: secret, stderr: 'private raw Docker diagnostic' }
    })

    const authDir = login()
    expect(authDir).toMatch(/\/runner\/pika-supabase-registry-[A-Za-z0-9]{6}$/)
    expect(statSync(authDir).mode & 0o777).toBe(0o700)
    expect(statSync(join(authDir, 'config.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(env.GITHUB_ENV!, 'utf8')).not.toContain(secret)
    expect(env.DOCKER_CONFIG).toBe(operatorConfig)
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toBe('{"auths":{"operator":"keep"}}')
    expect(process.umask()).toBe(previousUmask)
  })

  it.each([
    { status: 1, stderr: secret },
    { status: null, signal: 'SIGKILL', error: new Error(secret) },
    { status: 0, error: new Error(secret) },
  ])('removes config on failed, timed out, or errored login without exposing diagnostics: %j', result => {
    docker.mockReturnValue(result)
    const output: string[] = []
    expect(runRegistryAuthCli(['login'], { env, runDocker: docker, write: (line: string) => output.push(line) })).toBe(1)
    expect(output).toEqual(['FAIL Supabase CI registry login.\n'])
    expect(output.join('')).not.toContain(secret)
    expect(readdirSync(env.RUNNER_TEMP!)).toEqual([])
    expect(exportedEnv().PIKA_CI_REGISTRY_AUTH_DIR).toMatch(/pika-supabase-registry-/)
    expect(cleanupRegistryAuth({ env: { ...env, ...exportedEnv() } })).toBe(false)
  })

  it('sanitizes thrown child errors and restores the process umask', () => {
    const previousUmask = process.umask()
    docker.mockImplementation(() => { throw new Error(secret) })
    expect(login).toThrow('Supabase CI registry login failed')
    expect(readdirSync(env.RUNNER_TEMP!)).toEqual([])
    expect(process.umask()).toBe(previousUmask)
  })

  it('cleans owned credentials without Docker, token, or a running daemon and tolerates repeated cleanup', () => {
    const authDir = login()
    const cleanupEnv = { RUNNER_TEMP: env.RUNNER_TEMP, ...exportedEnv() }
    expect(cleanupRegistryAuth({ env: cleanupEnv })).toBe(true)
    expect(cleanupRegistryAuth({ env: cleanupEnv })).toBe(false)
    expect(readdirSync(env.RUNNER_TEMP!)).not.toContain(authDir)
    expect(docker).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it('does nothing without an exported ownership path, even if operator DOCKER_CONFIG exists', () => {
    expect(cleanupRegistryAuth({ env: {} })).toBe(false)
    expect(cleanupRegistryAuth({ env })).toBe(false)
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it('refuses outside, nested, mismatched, or noncanonical cleanup paths', () => {
    const authDir = login()
    for (const overrides of [
      { PIKA_CI_REGISTRY_AUTH_DIR: operatorConfig, DOCKER_CONFIG: operatorConfig },
      { PIKA_CI_REGISTRY_AUTH_DIR: join(authDir, 'nested'), DOCKER_CONFIG: join(authDir, 'nested') },
      { DOCKER_CONFIG: operatorConfig },
      { PIKA_CI_REGISTRY_AUTH_DIR: `${authDir}/../${authDir.split('/').at(-1)}` },
      { PIKA_CI_REGISTRY_AUTH_DIR: `${authDir}\nEVIL=value` },
    ]) {
      expect(() => cleanupRegistryAuth({ env: { ...env, ...exportedEnv(), ...overrides } })).toThrow()
      expect(statSync(authDir).isDirectory()).toBe(true)
    }
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it('refuses a symlink auth directory and an unowned directory with the right prefix', () => {
    const symlinkPath = join(env.RUNNER_TEMP!, 'pika-supabase-registry-ABC123')
    symlinkSync(operatorConfig, symlinkPath)
    const unownedPath = join(env.RUNNER_TEMP!, 'pika-supabase-registry-DEF456')
    mkdirSync(unownedPath, { mode: 0o700 })
    writeFileSync(join(unownedPath, 'valuable'), 'keep')
    for (const authDir of [symlinkPath, unownedPath]) {
      expect(() => cleanupRegistryAuth({ env: { ...env, DOCKER_CONFIG: authDir, PIKA_CI_REGISTRY_AUTH_DIR: authDir } })).toThrow()
    }
    expect(readFileSync(join(unownedPath, 'valuable'), 'utf8')).toBe('keep')
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it('refuses changed permissions or a symlink ownership marker', () => {
    const authDir = login()
    const cleanupEnv = { ...env, ...exportedEnv() }
    chmodSync(authDir, 0o755)
    expect(() => cleanupRegistryAuth({ env: cleanupEnv })).toThrow()
    chmodSync(authDir, 0o700)
    unlinkSync(join(authDir, '.pika-ci-registry-auth'))
    symlinkSync(join(operatorConfig, 'config.json'), join(authDir, '.pika-ci-registry-auth'))
    expect(() => cleanupRegistryAuth({ env: cleanupEnv })).toThrow()
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it('does not follow credential-directory children during recursive cleanup', () => {
    const authDir = login()
    symlinkSync(operatorConfig, join(authDir, 'external-config'))
    expect(cleanupRegistryAuth({ env: { ...env, ...exportedEnv() } })).toBe(true)
    expect(readFileSync(join(operatorConfig, 'config.json'), 'utf8')).toContain('keep')
  })

  it.each([
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_ACTOR: '' },
    { GITHUB_ACTOR: '--password=unsafe' },
    { SUPABASE_CI_GHCR_TOKEN: '' },
    { SUPABASE_CI_GHCR_TOKEN: 'token\nextra' },
    { SUPABASE_INTERNAL_IMAGE_REGISTRY: 'docker.io' },
    { RUNNER_TEMP: 'relative-temp' },
    { RUNNER_TEMP: '/tmp/unsafe\nENV=value' },
    { PIKA_CI_REGISTRY_AUTH_DIR: '/previous-auth-dir' },
  ])('rejects unsupported login context before invoking Docker: %j', overrides => {
    expect(() => loginRegistryAuth({ env: { ...env, ...overrides }, runDocker: docker })).toThrow()
    expect(docker).not.toHaveBeenCalled()
    expect(readdirSync(env.RUNNER_TEMP!)).toEqual([])
    expect(readFileSync(env.GITHUB_ENV!, 'utf8')).toBe('')
  })

  it('refuses a symlink GITHUB_ENV before storing credentials or invoking Docker', () => {
    const link = join(root, 'github-env-link')
    symlinkSync(env.GITHUB_ENV!, link)
    env.GITHUB_ENV = link
    expect(login).toThrow()
    expect(docker).not.toHaveBeenCalled()
    expect(readFileSync(join(root, 'github-env'), 'utf8')).toBe('')
    expect(readdirSync(env.RUNNER_TEMP!)).toEqual([])
  })

  it('accepts only the two fixed CLI modes and emits sanitized success/failure statuses', () => {
    const output: string[] = []
    const write = (line: string) => output.push(line)
    for (const args of [[], ['logout'], ['login', secret], ['cleanup', '--registry=unsafe']]) {
      expect(runRegistryAuthCli(args, { env, runDocker: docker, write })).toBe(1)
    }
    expect(docker).not.toHaveBeenCalled()
    expect(output.join('')).not.toContain(secret)
    output.length = 0
    expect(runRegistryAuthCli(['login'], { env, runDocker: docker, write })).toBe(0)
    expect(runRegistryAuthCli(['cleanup'], { env: { ...env, ...exportedEnv() }, write })).toBe(0)
    expect(output).toEqual(['PASS Supabase CI registry login.\n', 'PASS Supabase CI registry cleanup.\n'])
  })
})
