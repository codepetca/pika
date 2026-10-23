#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIRECTORY_PREFIX = 'pika-supabase-registry-'
const DIRECTORY_NAME = /^pika-supabase-registry-[A-Za-z0-9]{6}$/
const OWNER_FILE = '.pika-ci-registry-auth'
const OWNER_CONTENT = 'pika-supabase-registry-auth-v1\n'
const INVENTORY_DENIED_ENV = /^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i
const MAX_CONFIG_BYTES = 16 * 1024
const BASE64_AUTH = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/

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

function ownedAuthDirectory(env, { allowMissing = false } = {}) {
  const root = runnerTemp(env)
  const directory = assertSafePath(env.PIKA_CI_REGISTRY_AUTH_DIR)
  if (env.DOCKER_CONFIG !== directory || dirname(directory) !== root || !DIRECTORY_NAME.test(basename(directory))) {
    throw new Error('Refusing unowned registry authentication cleanup')
  }
  let stat
  try {
    stat = lstatSync(directory)
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return undefined
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
  return directory
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKey(value, key) {
  return isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, key)
}

/** Preserve daemon-routing restrictions, allowing only the job's GHCR auth file. */
export function assertDockerInventoryEnvironment(env = process.env) {
  try {
    const denied = Object.keys(env).filter(name => INVENTORY_DENIED_ENV.test(name))
    if (!denied.length) return
    if (denied.length !== 1 || denied[0] !== 'DOCKER_CONFIG' || env.GITHUB_ACTIONS !== 'true' || env.SUPABASE_INTERNAL_IMAGE_REGISTRY !== 'ghcr.io') {
      throw new Error('Unsupported Docker inventory environment')
    }
    const directory = ownedAuthDirectory(env)
    const members = readdirSync(directory).sort()
    if (members.length !== 2 || members[0] !== OWNER_FILE || members[1] !== 'config.json') {
      throw new Error('Unexpected Docker config directory members')
    }
    const configPath = join(directory, 'config.json')
    if (realpathSync(configPath) !== configPath) throw new Error('Unsafe Docker config file')
    const fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let contents
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size <= 0 || stat.size > MAX_CONFIG_BYTES ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        throw new Error('Unsafe Docker config file metadata')
      }
      // Read at most the allowed size plus one byte, even if a file grows after
      // fstat. Never decode the auth value or include config data in diagnostics.
      const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, length)
        if (count === 0) break
        length += count
      }
      if (length > MAX_CONFIG_BYTES) throw new Error('Oversized Docker config file')
      contents = bytes.subarray(0, length).toString('utf8')
    } finally {
      closeSync(fd)
    }
    const config = JSON.parse(contents)
    if (!onlyKey(config, 'auths') || !onlyKey(config.auths, 'ghcr.io') || !onlyKey(config.auths['ghcr.io'], 'auth')) {
      throw new Error('Unexpected Docker configuration keys')
    }
    const auth = config.auths['ghcr.io'].auth
    if (typeof auth !== 'string' || auth.length === 0 || auth.length > 12 * 1024 || !BASE64_AUTH.test(auth)) {
      throw new Error('Invalid Docker registry credential encoding')
    }
  } catch {
    throw new Error('Docker inventory environment is not permitted')
  }
}

/** Remove only this helper's private, marked, direct-child Docker config. */
export function cleanupRegistryAuth({ env = process.env } = {}) {
  if (!env.PIKA_CI_REGISTRY_AUTH_DIR) return false
  const directory = ownedAuthDirectory(env, { allowMissing: true })
  if (!directory) return false
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
