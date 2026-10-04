/** Invocation-local acceleration for the Test owner list extension guard only.
 * Import is inert. Three bounded workers discover the complete global topology;
 * the sealed assignment-list parser still validates and constructs the result.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { request, type ClientRequest, type IncomingMessage } from 'node:http'
import { isAbsolute, join, normalize } from 'node:path'
import { homedir } from 'node:os'
import type { Socket } from 'node:net'
import { assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'

type Run = (file: string, args: string[]) => Promise<string>
const outputBytes = 64 * 1024 * 1024
const failure = () => new Error('Private Test owner list inventory rejected')
const commandKey = (file: string, args: string[]) => JSON.stringify([file, args])

function command(file: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 20000, maxBuffer: outputBytes, encoding: 'utf8', env }, (error, stdout) => {
      if (error) reject(failure())
      else resolve(stdout.trim())
    })
  })
}

/** Explicit offline seams exercise the production path without Docker or a socket. */
type NativeTransport = { env: NodeJS.ProcessEnv; run: Run; realpath: typeof realpathSync; stat: typeof statSync; request: typeof request; readConfig: (env: NodeJS.ProcessEnv) => string | undefined }
const contextTemplate = '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function bounded(output: string) {
  assert(typeof output === 'string' && Buffer.byteLength(output, 'utf8') <= outputBytes)
  return output
}
function readConfig(env: NodeJS.ProcessEnv): string | undefined {
  let fd: number
  try { fd = openSync(join(env.HOME ?? homedir(), '.docker', 'config.json'), constants.O_RDONLY | constants.O_NONBLOCK) }
  catch (error) { if (object(error) && error.code === 'ENOENT') return undefined; throw failure() }
  try {
    const stat = fstatSync(fd)
    assert(stat.isFile() && Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= outputBytes)
    // One extra byte detects growth after stat without ever allocating an
    // unbounded config file. Nothing from this credential-bearing file is kept.
    const buffer = Buffer.alloc(stat.size + 1)
    let bytes = 0; let count: number
    while ((count = readSync(fd, buffer, bytes, buffer.length - bytes, null)) > 0) {
      bytes += count; assert(bytes <= stat.size)
    }
    assert.equal(bytes, stat.size)
    return buffer.subarray(0, bytes).toString('utf8')
  } finally { closeSync(fd) }
}
async function localEndpoint(transport: NativeTransport) {
  assert(!Object.keys(transport.env).some(name => /^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)))
  const configText = transport.readConfig(transport.env)
  if (configText !== undefined) {
    const config: unknown = JSON.parse(bounded(configText))
    assert(object(config))
    assert(!Object.hasOwn(config, 'HttpHeaders') || (object(config.HttpHeaders) && Object.keys(config.HttpHeaders).length === 0))
  }
  const context: unknown = JSON.parse(bounded(await transport.run('docker', ['context', 'inspect', '--format', contextTemplate])))
  assert(object(context) && object(context.endpoints))
  assert.deepEqual(Object.keys(context.endpoints), ['docker'])
  assert(context.tlsMaterial === null || (object(context.tlsMaterial) && Object.keys(context.tlsMaterial).length === 0))
  const docker = context.endpoints.docker
  assert(object(docker) && typeof docker.Host === 'string' && (docker.SkipTLSVerify === false || docker.SkipTLSVerify === undefined))
  assert(Object.keys(docker).every(key => key === 'Host' || key === 'SkipTLSVerify'))
  const host = docker.Host
  assert(host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(host))
  const path = host.slice('unix://'.length)
  assert(isAbsolute(path) && normalize(path) === path)
  const canonical = transport.realpath(path)
  assert(typeof canonical === 'string' && isAbsolute(canonical) && normalize(canonical) === canonical && !/[\x00-\x20\x7f%?#]/.test(canonical))
  const identity = () => {
    assert.equal(transport.realpath(path), canonical)
    const stat = transport.stat(canonical)
    assert(stat.isSocket())
    return [stat.dev, stat.ino, stat.mode, stat.rdev]
  }
  const original = identity()
  return { canonical, host: `unix://${canonical}`, verify: () => assert.deepEqual(identity(), original) }
}

/** One finite request. Resolution owns request/socket close, including success. */
function bulkVolumes(socketPath: string, httpRequest: typeof request, onFailure: () => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let req: ClientRequest | undefined; let response: IncomingMessage | undefined
    const sockets = new Set<Socket>()
    let requestClosed = false; let finishing = false; let bad = false; let value: unknown
    let bytes = 0; const chunks: Buffer[] = []
    const deadline = performance.now() + 20000
    const timer = setTimeout(() => finish(true), 20000) // Absolute, never refreshed by data.
    function settle() {
      if (!finishing || !requestClosed || sockets.size) return
      if (performance.now() >= deadline) { bad = true; onFailure() }
      clearTimeout(timer); chunks.length = 0
      if (bad) reject(failure()); else resolve(value)
    }
    function finish(failed: boolean, result?: unknown) {
      failed ||= performance.now() >= deadline
      if (failed) onFailure() // Stop queued work while request/socket cleanup is still settling.
      if (finishing) { if (failed) bad = true; return }
      finishing = true; bad = failed; value = result
      response?.destroy(); req?.destroy()
      for (const socket of sockets) socket.destroy()
      if (!req) requestClosed = true
      settle()
    }
    try {
      req = httpRequest({ socketPath, path: '/v1.45/volumes', method: 'GET', agent: false,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Connection: 'close' } }, incoming => {
        response = incoming
        incoming.on('error', () => finish(true)); incoming.on('aborted', () => finish(true))
        incoming.on('close', () => { if (!finishing) finish(true) })
        if (finishing) { incoming.destroy(); return }
        if (incoming.statusCode !== 200 || !/^application\/json(?:\s*;.*)?$/i.test(String(incoming.headers['content-type'] ?? '')) ||
          (incoming.headers['content-encoding'] !== undefined && incoming.headers['content-encoding'] !== 'identity')) { finish(true); return }
        incoming.on('data', (chunk: Buffer) => {
          if (finishing) return
          if (!Buffer.isBuffer(chunk) || chunk.length > outputBytes - bytes) { finish(true); return }
          bytes += chunk.length; chunks.push(chunk)
        })
        incoming.on('end', () => {
          if (finishing) return
          try { assert(incoming.complete); finish(false, JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))) }
          catch { finish(true) }
        })
      })
      req.on('socket', socket => {
        sockets.add(socket)
        socket.on('error', () => finish(true))
        socket.once('close', () => { sockets.delete(socket); if (!finishing) finish(true); settle() })
        if (finishing) socket.destroy()
      })
      req.on('error', () => finish(true))
      req.once('close', () => { requestClosed = true; if (!finishing) finish(true); settle() })
      req.end()
    } catch { finish(true) }
  })
}

function volumeMetadata(body: unknown, names: string[]) {
  assert(object(body) && Object.hasOwn(body, 'Volumes') && Object.hasOwn(body, 'Warnings'))
  assert(body.Warnings === null || (Array.isArray(body.Warnings) && body.Warnings.length === 0))
  assert(Array.isArray(body.Volumes) || (body.Volumes === null && names.length === 0))
  const rows = (body.Volumes ?? []) as unknown[]
  const volumes = new Map<string, { Name: string; CreatedAt: string; Labels: Record<string, string> | null }>()
  for (const row of rows) {
    assert(object(row) && typeof row.Name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(row.Name))
    assert(typeof row.CreatedAt === 'string' && row.CreatedAt.length > 0)
    assert(row.Labels === null || (object(row.Labels) && Object.values(row.Labels).every(value => typeof value === 'string')))
    assert(!volumes.has(row.Name))
    volumes.set(row.Name, { Name: row.Name, CreatedAt: row.CreatedAt, Labels: row.Labels as Record<string, string> | null })
  }
  assert.deepEqual([...volumes.keys()].sort(), [...names].sort())
  return volumes
}

function pipelines() {
  // Bind to the format in the sealed source, rather than maintain another
  // container projection. A changed/ambiguous declaration fails closed.
  const source = readFileSync(new URL('./contextual-assignment-list-proof-platform.ts', import.meta.url), 'utf8')
  const declarations = [...source.matchAll(/^const containerTemplate = '([^'\r\n]+)'$/gm)]
  assert.equal(declarations.length, 1)
  const template = declarations[0][1]
  assert(template.startsWith('{') && template.endsWith('}'))
  return [
    { list: ['ps', '-aq', '--no-trunc'], inspect: ['inspect', '--format', template], valid: /^[a-f0-9]{64}$/ },
    { list: ['volume', 'ls', '-q'], inspect: ['volume', 'inspect'], valid: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/ },
    { list: ['network', 'ls', '-q', '--no-trunc'], inspect: ['network', 'inspect'], valid: /^[a-f0-9]{64}$/ },
  ]
}

export async function testOwnerListDockerInventory(run?: Run, seams: Partial<NativeTransport> = {}): ReturnType<typeof assignmentListDockerInventory> {
  const results = new Map<string, string>()
  let resultBytes = 0
  let pending: Promise<void> | undefined
  let endpoint: Awaited<ReturnType<typeof localEndpoint>> | undefined
  async function prefetch() {
    const specs = pipelines()
    const env = { ...(seams.env ?? process.env) }
    const transport: NativeTransport = { run: (file, args) => command(file, args, env), realpath: realpathSync, stat: statSync, request, readConfig, ...seams, env }
    if (!run) endpoint = await localEndpoint(transport)
    function store(args: string[], output: string) {
      const key = commandKey('docker', args)
      assert(!results.has(key)); bounded(output)
      const bytes = Buffer.byteLength(output, 'utf8')
      assert(bytes <= outputBytes - resultBytes)
      resultBytes += bytes; results.set(key, output)
      return output
    }
    async function capture(args: string[]) {
      return store(args, await (run ? run('docker', [...args]) : transport.run('docker', ['--host', endpoint!.host, ...args])))
    }
    // Each fresh listing validates its IDs before queuing exact inspect batches.
    // Use idle capacity as soon as independent discovery finishes, but never
    // exceed three commands TOTAL, including listings. Inspection is read-only;
    // parser replay, resource authorization and SQL still await the FULL graph.
    await new Promise<void>((resolve, reject) => {
      let active = 0; let failed = false
      const queue: Array<() => Promise<void>> = specs.map(spec => async () => {
        const ids = (await capture(spec.list)).split(/\s+/).filter(Boolean)
        assert.equal(new Set(ids).size, ids.length)
        assert(ids.every(value => spec.valid.test(value)))
        if (!run && spec.list[0] === 'volume') {
          // Keep the exact fresh CLI name set; the one bulk GET occupies a pool
          // slot and only supplies metadata for the sealed logical batch keys.
          queue.push(async () => {
            const volumes = volumeMetadata(await bulkVolumes(endpoint!.canonical, transport.request, () => { failed = true }), ids)
            for (let start = 0; start < ids.length; start += 128) {
              const batch = ids.slice(start, start + 128)
              store([...spec.inspect, ...batch], JSON.stringify(batch.map(name => volumes.get(name)!)))
            }
          })
          return
        }
        for (let start = 0; start < ids.length; start += 128) {
          const args = [...spec.inspect, ...ids.slice(start, start + 128)]
          queue.push(async () => { await capture(args) })
        }
      })
      function pump() {
        while (!failed && active < 3 && queue.length) {
          const task = queue.shift()!; active++
          // Attach failure handlers immediately. No queued work starts after an
          // observed failure, and all active listings/inspections settle before
          // rejection. The invocation-local pending promise owns the whole pool.
          task().catch(() => { failed = true }).finally(() => {
            active--
            if (!active && (failed || !queue.length)) { failed ? reject(failure()) : resolve() }
            else pump()
          })
        }
      }
      pump()
    })
  }
  async function consume(file: string, args: string[]) {
    if (!pending) {
      // The sealed parser's first request is its exact global container list.
      // Deny substitutions before even starting the read-only prefetch.
      assert.equal(commandKey(file, args), commandKey('docker', ['ps', '-aq', '--no-trunc']))
      pending = prefetch()
    }
    await pending
    const key = commandKey(file, args)
    assert(results.has(key))
    const output = results.get(key)!
    results.delete(key) // Each original command consumes its exact result once.
    resultBytes -= Buffer.byteLength(output, 'utf8')
    return output
  }
  try {
    const inventory = await assignmentListDockerInventory(consume)
    assert.equal(results.size, 0)
    endpoint?.verify()
    return inventory
  } catch {
    throw failure()
  } finally {
    // Also covers a parser rejection while prefetch is pending. No command or
    // prefetched record can outlive this invocation or be reused by another.
    await pending?.catch(() => {})
    results.clear()
  }
}
