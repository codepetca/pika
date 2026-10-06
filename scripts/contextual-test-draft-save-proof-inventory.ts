/** PATCH-only transport. The unchanged native export owns endpoint/config/socket
 * validation, global discovery, bulk volumes and the sealed parser. Import inert. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { request, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import type { Socket } from 'node:net'
import { isAbsolute, normalize } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { TextDecoder } from 'node:util'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'

type Seams = Omit<NonNullable<Parameters<typeof testOwnerListDockerInventory>[1]>, 'run'>
const BYTES = 64 * 1024 * 1024
const MS = 20000
const CONTEXT = ['context', 'inspect', '--format', '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}']
const TEMPLATE = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}},"created":{{json .Created}}}'
const ID = /^[a-f0-9]{64}$/
const error = () => new Error('Private Test draft save inventory rejected')
const key = (args: string[]) => JSON.stringify(args)
const textBytes = (text: string) => Math.max(Buffer.byteLength(text), 2 * text.length)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
type Lease = { release: () => void; shrink: (size: number) => void }
type Output = { text: string; lease: Lease }
type Owned = { abort: () => void; closed: Promise<void> }
type Job = { args?: string[]; id?: string; deadline: number; resolve: (output: Output) => void; reject: (error: Error) => void }

export async function draftSaveProofDockerInventory(seams: Seams = {}): ReturnType<typeof testOwnerListDockerInventory> {
  const env = Object.freeze({ ...(seams.env ?? process.env) })
  try {
    const declarations = [...readFileSync(new URL('./contextual-assignment-list-proof-platform.ts', import.meta.url), 'utf8')
      .matchAll(/^const containerTemplate = '([^'\r\n]+)'$/gm)]
    assert.equal(declarations.length, 1); assert.equal(declarations[0][1], TEMPLATE)
  } catch { throw error() }
  let failed = false; let host: string | undefined; let contextDone = false; let allocated = 0
  const retained: Lease[] = []; const listed = new Set<string>(); const allowed = new Set<string>()
  const queue: Job[] = []; const active = new Set<Owned>(); const reserved = new Set<Owned>()
  const http = seams.request ?? request
  function reserve(size: number): Lease {
    assert(Number.isSafeInteger(size) && size >= 0 && size <= BYTES - allocated)
    allocated += size; let held = size
    return { release() { allocated -= held; held = 0 }, shrink(next) { assert(Number.isSafeInteger(next) && next >= 0 && next <= held); allocated -= held - next; held = next } }
  }
  function fail() {
    if (failed) return
    failed = true
    for (const job of queue.splice(0)) job.reject(error())
    for (const owned of [...active, ...reserved]) { try { owned.abort() } catch { /* Still await exact close/reaping; never release a live permit. */ } }
  }
  async function settle() { await Promise.allSettled([...active, ...reserved].map(owned => owned.closed)) }

  /** Track exact request AND every assigned socket. Failure latches before destroy.
   * The volume request has its permanent third slot, never an own-reader permit. */
  function reader(socketPath: string, path: string, deadline: number, consume: (incoming: IncomingMessage, finish: (bad: boolean, output?: Output) => void) => void,
    complete: (output?: Output) => void) {
    let release!: () => void; let req: ClientRequest | undefined; let response: IncomingMessage | undefined
    let requestClosed = false; let responseClosed = true; let finishing = false; let output: Output | undefined
    const sockets = new Set<Socket>()
    const owned: Owned = { closed: new Promise<void>(resolve => { release = resolve }), abort: () => finish(true) }
    active.add(owned)
    const timer = setTimeout(() => finish(true), Math.max(1, deadline - Date.now()))
    function done() {
      if (!finishing || !requestClosed || !responseClosed || sockets.size) return
      clearTimeout(timer)
      if (Date.now() >= deadline) fail()
      if (failed) { output?.lease.release(); output = undefined }
      active.delete(owned); release(); complete(output); pump()
    }
    function finish(bad: boolean, value?: Output) {
      if (bad || Date.now() >= deadline) fail()
      if (finishing) { value?.lease.release(); return }
      finishing = true; output = value
      response?.destroy(); req?.destroy(); for (const socket of sockets) socket.destroy()
      if (!req) requestClosed = true
      done()
    }
    try {
      assert(!failed && Date.now() < deadline)
      req = http({ socketPath, path, method: 'GET', agent: false,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Connection: 'close' } }, incoming => {
        response = incoming; responseClosed = false
        incoming.on('error', () => finish(true)); incoming.on('aborted', () => finish(true))
        incoming.on('close', () => { responseClosed = true; if (!finishing) finish(true); done() })
        if (finishing) { incoming.destroy(); return }
        if (incoming.statusCode !== 200 || !/^application\/json(?:\s*;.*)?$/i.test(String(incoming.headers['content-type'] ?? '')) ||
          (incoming.headers['content-encoding'] !== undefined && incoming.headers['content-encoding'] !== 'identity')) { finish(true); return }
        consume(incoming, finish)
      })
      req.on('socket', socket => {
        sockets.add(socket); socket.on('error', () => finish(true))
        socket.once('close', () => { sockets.delete(socket); if (!finishing) finish(true); done() })
        if (finishing) socket.destroy()
      })
      req.on('error', () => finish(true))
      req.once('close', () => { requestClosed = true; if (!finishing) finish(true); done() })
      req.end()
    } catch { finish(true) }
    return owned
  }

  function startHttp(job: Job) {
    const chunks: Buffer[] = []; const leases: Lease[] = []; let bytes = 0
    reader(host!.slice(7), `/v1.45/containers/${job.id}/json`, job.deadline, (incoming, finish) => {
      incoming.on('data', (chunk: Buffer) => {
        if (failed) return
        try { assert(Buffer.isBuffer(chunk)); leases.push(reserve(chunk.length)); bytes += chunk.length; chunks.push(chunk) }
        catch { finish(true) }
      })
      incoming.on('end', () => {
        if (failed) return
        let projected: Lease | undefined
        const temporary: Lease[] = []
        try {
          assert(incoming.complete && Date.now() < job.deadline)
          // Account BEFORE concat, fatal UTF8 decode, JSON parse and projection.
          // This bounds owned buffers/string allocations, not the V8 whole heap.
          // Store each acquired lease immediately: a later failed reservation
          // must not orphan an earlier argument-evaluation allocation.
          temporary.push(reserve(bytes)); temporary.push(reserve(3 * bytes + 3)); temporary.push(reserve(3 * bytes + 3))
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes)))
          assert(object(value) && value.Id === job.id && typeof value.Name === 'string' && typeof value.Created === 'string')
          assert(object(value.Config) && Object.hasOwn(value.Config, 'Labels') && Object.hasOwn(value, 'Mounts') &&
            object(value.NetworkSettings) && Object.hasOwn(value.NetworkSettings, 'Networks') && object(value.HostConfig) && Object.hasOwn(value.HostConfig, 'PortBindings'))
          projected = reserve(12 * bytes + 1024)
          const text = JSON.stringify({ id: value.Id, name: value.Name, labels: value.Config.Labels, mounts: value.Mounts,
            networks: value.NetworkSettings.Networks, bindings: value.HostConfig.PortBindings, created: value.Created })
          projected.shrink(textBytes(text)); assert(Date.now() < job.deadline)
          finish(false, { text, lease: projected }); projected = undefined
        } catch { finish(true) }
        finally { projected?.release(); temporary.forEach(lease => lease.release()); leases.splice(0).forEach(lease => lease.release()); chunks.length = 0 }
      })
    }, output => {
      leases.splice(0).forEach(lease => lease.release()); chunks.length = 0
      if (output && !failed) job.resolve(output); else job.reject(error())
    })
  }
  function startCli(job: Job) {
    let child: ReturnType<typeof spawn>
    try { child = spawn('docker', job.args!, { env, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { job.reject(error()); fail(); return }
    let release!: () => void
    const owned: Owned = { closed: new Promise<void>(resolve => { release = resolve }), abort: () => { child.kill('SIGKILL') } }
    active.add(owned)
    const pieces: string[] = []; const leases: Lease[] = []; const decoder = new StringDecoder('utf8')
    let size = 0; let stderr = 0
    const timer = setTimeout(fail, Math.max(1, job.deadline - Date.now()))
    child.stdout!.on('data', (chunk: Buffer) => {
      if (failed) return
      let lease: Lease | undefined
      try { assert(Buffer.isBuffer(chunk)); lease = reserve(3 * (chunk.length + 3)); const text = decoder.write(chunk)
        lease.shrink(textBytes(text)); leases.push(lease); lease = undefined; size += textBytes(text); pieces.push(text) }
      catch { lease?.release(); fail() }
    })
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.length; if (stderr > BYTES) fail() })
    child.on('error', fail); child.stdout!.on('error', fail); child.stderr!.on('error', fail)
    child.once('close', (code, signal) => {
      clearTimeout(timer); let output: Output | undefined; let joined: Lease | undefined
      try {
        assert(!failed && code === 0 && signal === null && Date.now() < job.deadline)
        const tailLease = reserve(9); leases.push(tailLease); const tail = decoder.end(); tailLease.shrink(textBytes(tail)); pieces.push(tail); size += textBytes(tail)
        joined = reserve(2 * size); const text = pieces.join('').trim(); joined.shrink(textBytes(text)); output = { text, lease: joined }; joined = undefined
      } catch { fail() }
      joined?.release(); leases.forEach(lease => lease.release()); pieces.length = 0; active.delete(owned); release()
      if (output && !failed) job.resolve(output); else { output?.lease.release(); job.reject(error()) }
      pump()
    })
  }
  function pump() {
    // Parents hold no permits. Two actual CLI/container readers plus at most one
    // original volume HTTP reader; the original outer pool remains unchanged.
    while (!failed && active.size < 2 && queue.length) {
      const job = queue.shift()!
      if (Date.now() >= job.deadline) { job.reject(error()); fail(); break }
      if (job.id) startHttp(job); else startCli(job)
    }
  }
  function enqueue(job: Omit<Job, 'resolve' | 'reject'>) {
    return new Promise<Output>((resolve, reject) => { if (failed) { reject(error()); return }; queue.push({ ...job, resolve, reject }); pump() })
  }
  async function run(file: string, args: string[]) {
    const deadline = Date.now() + MS; const timer = setTimeout(fail, MS); const outputs: Output[] = []
    try {
      assert(!failed && file === 'docker' && args.every(value => typeof value === 'string'))
      let jobs: Array<Omit<Job, 'resolve' | 'reject'>>; let listing: 'container' | 'network' | 'volume' | undefined
      if (key(args) === key(CONTEXT)) { assert(!contextDone && !host); contextDone = true; jobs = [{ args: [...args], deadline }] }
      else {
        assert(contextDone && args[0] === '--host' && typeof args[1] === 'string')
        const path = args[1].slice(7)
        assert(args[1].startsWith('unix:///') && isAbsolute(path) && normalize(path) === path && !/[\x00-\x20\x7f%?#]/.test(path))
        if (host) assert.equal(host, args[1]); else host = args[1]
        const command = args.slice(2)
        if (key(command) === key(['ps', '-aq', '--no-trunc'])) listing = 'container'
        else if (key(command) === key(['volume', 'ls', '-q'])) listing = 'volume'
        else if (key(command) === key(['network', 'ls', '-q', '--no-trunc'])) listing = 'network'
        if (listing) { assert(!listed.has(listing)); listed.add(listing); jobs = [{ args: [...args], deadline }] }
        else {
          assert(allowed.delete(key(args)))
          if (command[0] === 'inspect') {
            assert(command[1] === '--format' && command[2] === TEMPLATE)
            const ids = command.slice(3); assert(ids.length > 0 && ids.length <= 128 && ids.every(id => ID.test(id)) && new Set(ids).size === ids.length)
            jobs = ids.map(id => ({ id, deadline }))
          } else { assert(command[0] === 'network' && command[1] === 'inspect'); jobs = [{ args: [...args], deadline }] }
        }
      }
      const results = await Promise.allSettled(jobs.map(enqueue))
      for (const result of results) if (result.status === 'fulfilled') outputs.push(result.value)
      assert(!failed && results.every(result => result.status === 'fulfilled') && Date.now() < deadline)
      const size = outputs.reduce((n, output) => n + textBytes(output.text), 2 * Math.max(0, outputs.length - 1))
      const lease = reserve(size); retained.push(lease)
      const output = outputs.map(value => value.text).join('\n'); outputs.splice(0).forEach(value => value.lease.release())
      if (listing) {
        const ids = output.split(/\s+/).filter(Boolean)
        assert(new Set(ids).size === ids.length && ids.every(id => listing === 'volume' ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) : ID.test(id)))
        if (listing !== 'volume') for (let start = 0; start < ids.length; start += 128)
          allowed.add(key(['--host', host!, ...(listing === 'container' ? ['inspect', '--format', TEMPLATE] : ['network', 'inspect']), ...ids.slice(start, start + 128)]))
      }
      assert(Date.now() < deadline); return output
    } catch { fail(); await settle(); throw error() }
    finally { clearTimeout(timer); outputs.forEach(value => value.lease.release()) }
  }
  // Intercept only the original volume request to reserve its raw/transient
  // allocation allowance and immediate cancellation. Its parser is unchanged.
  const volumeRequest = ((options: RequestOptions, callback: (incoming: IncomingMessage) => void) => {
    assert(object(options) && options.path === '/v1.45/volumes' && options.socketPath === host?.slice(7) && options.method === 'GET' && options.agent === false &&
      object(options.headers) && key(Object.keys(options).sort()) === key(['agent', 'headers', 'method', 'path', 'socketPath']) &&
      key(Object.keys(options.headers).sort()) === key(['Accept', 'Accept-Encoding', 'Connection']) &&
      options.headers.Accept === 'application/json' && options.headers['Accept-Encoding'] === 'identity' && options.headers.Connection === 'close' && reserved.size === 0 && !failed)
    let original: ClientRequest | undefined; let response: IncomingMessage | undefined
    // Keep the exact original volume request and parser; track only its transport
    // ownership and reserve concurrent raw/concat/decode/metadata allocations.
    let release!: () => void; const sockets = new Set<Socket>(); let closed = false; let responseClosed = true
    const owned: Owned = { closed: new Promise<void>(resolve => { release = resolve }), abort: () => { response?.destroy(); original?.destroy(); for (const socket of sockets) socket.destroy() } }
    reserved.add(owned)
    const done = () => { if (closed && responseClosed && sockets.size === 0) { reserved.delete(owned); release() } }
    try {
      const req = original = http(options, incoming => {
        response = incoming; responseClosed = false
        incoming.once('close', () => { responseClosed = true; done() })
        incoming.on('error', fail); incoming.on('aborted', fail)
        if (incoming.statusCode !== 200 || !/^application\/json(?:\s*;.*)?$/i.test(String(incoming.headers['content-type'] ?? '')) ||
          (incoming.headers['content-encoding'] !== undefined && incoming.headers['content-encoding'] !== 'identity')) fail()
        incoming.on('data', (chunk: Buffer) => { if (failed) return; try { assert(Buffer.isBuffer(chunk)); retained.push(reserve(12 * chunk.length + 24)) } catch { fail() } })
        incoming.on('end', () => { if (!incoming.complete) fail() })
        callback(incoming)
      })
      req.on('socket', socket => { sockets.add(socket); socket.on('error', fail); socket.once('close', () => { sockets.delete(socket); done() }); if (failed) socket.destroy() })
      req.on('error', fail); req.once('close', () => { closed = true; done() }); return req
    } catch { closed = true; fail(); done(); throw error() }
  }) as typeof request
  try {
    const inventory = await testOwnerListDockerInventory(undefined, { ...seams, env, run, request: volumeRequest })
    assert(!failed && allowed.size === 0); return inventory
  } catch { fail(); throw error() }
  finally { if (active.size || queue.length) fail(); await settle(); queue.length = 0; allowed.clear(); retained.forEach(lease => lease.release()) }
}
