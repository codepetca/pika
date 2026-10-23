#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIRECTORY_PREFIX = 'pika-supabase-registry-'
const DIRECTORY_NAME = /^pika-supabase-registry-[A-Za-z0-9]{6}$/
const OWNER_FILE = '.pika-ci-registry-auth'
const OWNER_CONTENT = 'pika-supabase-registry-auth-v1\n'

function assertSafePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || resolve(value) !== value) {
    throw new Error('Unsafe registry authentication path')
  }
  return value
}

function runnerTemp(env) {
  const root = realpathSync(assertSafePath(env.RUNNER_TEMP))
  assertSafePath(root)
  if (!lstatSync(root).isDirectory()) throw new Error('Invalid runner temporary directory')
  return root
}

function assertPrivateOwner(stat) {
  if ((stat.mode & 0o777) !== 0o700 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('Registry authentication directory is not private and owned')
  }
}

// GITHUB_ENV is an existing runner-owned regular file. Never follow a replacement
// symlink or create an arbitrary output file supplied through the environment.
function openGithubEnv(env) {
  const path = assertSafePath(env.GITHUB_ENV)
  if (realpathSync(path) !== path) throw new Error('Unsafe GitHub environment file')
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Invalid GitHub environment file')
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

/** Remove only this helper's private, marked, direct-child Docker config. */
export function cleanupRegistryAuth({ env = process.env } = {}) {
  if (!env.PIKA_CI_REGISTRY_AUTH_DIR) return false
  const root = runnerTemp(env)
  const directory = assertSafePath(env.PIKA_CI_REGISTRY_AUTH_DIR)
  if (env.DOCKER_CONFIG !== directory || dirname(directory) !== root || !DIRECTORY_NAME.test(basename(directory))) {
    throw new Error('Refusing unowned registry authentication cleanup')
  }
  let stat
  try {
    stat = lstatSync(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error('Refusing unsafe registry authentication cleanup')
  }
  assertPrivateOwner(stat)
  const marker = openSync(join(directory, OWNER_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const markerStat = fstatSync(marker)
    if (!markerStat.isFile() || markerStat.size !== Buffer.byteLength(OWNER_CONTENT) || readFileSync(marker, 'utf8') !== OWNER_CONTENT) {
      throw new Error('Refusing unmarked registry authentication cleanup')
    }
  } finally {
    closeSync(marker)
  }
  // No Docker command is needed: this also works after Supabase and its daemon stop.
  rmSync(directory, { recursive: true, force: true })
  return true
}

/** Login is restricted to the fixed CI host and never modifies the operator config. */
export function loginRegistryAuth({ env = process.env, runDocker = spawnSync } = {}) {
  let directory
  let githubEnvFd
  const previousUmask = process.umask(0o077)
  try {
    if (env.GITHUB_ACTIONS !== 'true' || env.SUPABASE_INTERNAL_IMAGE_REGISTRY !== 'ghcr.io' ||
      typeof env.GITHUB_ACTOR !== 'string' || env.GITHUB_ACTOR.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/.test(env.GITHUB_ACTOR) ||
      typeof env.SUPABASE_CI_GHCR_TOKEN !== 'string' || !env.SUPABASE_CI_GHCR_TOKEN || env.SUPABASE_CI_GHCR_TOKEN.length > 8192 || /[\s\x00-\x1f\x7f]/.test(env.SUPABASE_CI_GHCR_TOKEN) ||
      env.PIKA_CI_REGISTRY_AUTH_DIR) {
      throw new Error('Unsupported CI registry authentication context')
    }
    const root = runnerTemp(env)
    githubEnvFd = openGithubEnv(env)
    directory = mkdtempSync(join(root, DIRECTORY_PREFIX))
    chmodSync(directory, 0o700)
    writeFileSync(join(directory, OWNER_FILE), OWNER_CONTENT, { flag: 'wx', mode: 0o600 })
    // A nonempty auth map prevents Docker from auto-selecting a host credential
    // helper, which could persist this job's token outside the owned directory.
    writeFileSync(join(directory, 'config.json'), '{"auths":{"ghcr.io":{}}}\n', { flag: 'wx', mode: 0o600 })

    // Publish cleanup ownership BEFORE the interruptible login. This contains
    // paths only; neither the token nor Docker diagnostics enter runner output.
    writeFileSync(githubEnvFd, `DOCKER_CONFIG=${directory}\nPIKA_CI_REGISTRY_AUTH_DIR=${directory}\n`)
    closeSync(githubEnvFd)
    githubEnvFd = undefined

    const childEnv = { ...env, DOCKER_CONFIG: directory }
    delete childEnv.SUPABASE_CI_GHCR_TOKEN
    const result = runDocker('docker', ['login', 'ghcr.io', '--username', env.GITHUB_ACTOR, '--password-stdin'], {
      env: childEnv,
      input: `${env.SUPABASE_CI_GHCR_TOKEN}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    })
    if (result.error || result.signal || result.status !== 0) throw new Error('Docker registry login failed')
    return directory
  } catch {
    if (directory) {
      // This path was created by this invocation. No environment-supplied path
      // is passed to removal, including failures before the ownership export.
      rmSync(directory, { recursive: true, force: true })
    }
    // Child errors can include credentials or private server diagnostics.
    throw new Error('Supabase CI registry login failed')
  } finally {
    if (githubEnvFd !== undefined) closeSync(githubEnvFd)
    process.umask(previousUmask)
  }
}

export function runRegistryAuthCli(args, { env = process.env, runDocker = spawnSync, write = line => process.stdout.write(line) } = {}) {
  const mode = args.length === 1 && ['login', 'cleanup'].includes(args[0]) ? args[0] : undefined
  if (!mode) {
    write('FAIL Usage: ci-supabase-registry-auth.mjs login|cleanup.\n')
    return 1
  }
  try {
    if (mode === 'login') loginRegistryAuth({ env, runDocker })
    else cleanupRegistryAuth({ env })
    write(`PASS Supabase CI registry ${mode}.\n`)
    return 0
  } catch {
    write(`FAIL Supabase CI registry ${mode}.\n`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runRegistryAuthCli(process.argv.slice(2))
}
