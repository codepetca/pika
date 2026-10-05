/** PATCH-only inventory seam. The unchanged native collector still owns config,
 * endpoint/socket guards, bulk volumes and full sealed-parser replay. Import inert. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, normalize } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'

type Seams = Omit<NonNullable<Parameters<typeof testOwnerListDockerInventory>[1]>, 'run'>
const BYTES = 64 * 1024 * 1024
const MS = 20000
const CHUNK = 32
const CONTEXT = ['context', 'inspect', '--format', '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}']
const ID = /^[a-f0-9]{64}$/
const error = () => new Error('Private Test draft save inventory rejected')
type Job = { args: string[]; deadline: number; resolve: (output: string) => void; reject: (error: Error) => void }
type Owned = { child: ChildProcess; closed: Promise<void> }

export async function draftSaveProofDockerInventory(seams: Seams = {}): ReturnType<typeof testOwnerListDockerInventory> {
  const env = Object.freeze({ ...(seams.env ?? process.env) })
  let template: string
  try {
    const declarations = [...readFileSync(new URL('./contextual-assignment-list-proof-platform.ts', import.meta.url), 'utf8')
      .matchAll(/^const containerTemplate = '([^'\r\n]+)'$/gm)]
    assert.equal(declarations.length, 1); template = declarations[0][1]
  } catch { throw error() }
  let failed = false; let host: string | undefined; let contextDone = false
  let fragments = 0; let accepted = 0
  const listed = new Set<string>(); const allowed = new Set<string>()
  const queue: Job[] = []; const active = new Set<Owned>()
  const key = (args: string[]) => JSON.stringify(args)
  function fail() {
    if (failed) return
    failed = true
    for (const job of queue.splice(0)) job.reject(error())
    for (const owned of active) owned.child.kill('SIGKILL')
  }
  function charge(bytes: number) {
    assert(Number.isSafeInteger(bytes) && bytes >= 0 && accepted + fragments + bytes <= BYTES)
    fragments += bytes
  }
  function pump() {
    // Two physical CLI children reserve one slot permanently for bulk-volume HTTP.
    while (!failed && active.size < 2 && queue.length) {
      const job = queue.shift()!
      if (Date.now() >= job.deadline) { job.reject(error()); fail(); break }
      let child: ChildProcess
      try { child = spawn('docker', job.args, { env, stdio: ['ignore', 'pipe', 'pipe'] }) }
      catch { job.reject(error()); fail(); break }
      let release!: () => void
      const owned = { child, closed: new Promise<void>(resolve => { release = resolve }) }
      active.add(owned)
      const chunks: string[] = []; const decoder = new StringDecoder('utf8')
      let bytes = 0; let stderr = 0; let bad = false
      const timer = setTimeout(() => { bad = true; fail() }, Math.max(1, job.deadline - Date.now()))
      child.stdout!.on('data', (chunk: Buffer) => {
        if (failed) return
        let reserved = 0
        try {
          assert(Buffer.isBuffer(chunk))
          // Reserve worst-case replacement expansion plus decoder carry BEFORE
          // allocating decoded fragments; release unused capacity immediately.
          const reservation = 3 * (chunk.length + 3); charge(reservation); reserved = reservation
          const text = decoder.write(chunk); const size = Buffer.byteLength(text)
          assert(size <= reservation); fragments -= reservation - size; reserved = 0
          bytes += size; chunks.push(text)
        }
        catch { fragments -= reserved; bad = true; fail() }
      })
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.length
        if (stderr > BYTES) { bad = true; fail() }
      })
      child.on('error', () => { bad = true; fail() })
      child.stdout!.on('error', () => { bad = true; fail() })
      child.stderr!.on('error', () => { bad = true; fail() })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        let output: string | undefined
        try {
          assert(!failed && !bad && code === 0 && signal === null && Date.now() < job.deadline)
          charge(9)
          const tail = decoder.end(); const tailBytes = Buffer.byteLength(tail)
          assert(tailBytes <= 9); fragments -= 9 - tailBytes; bytes += tailBytes
          if (tail) chunks.push(tail)
          // Account for the new joined string while original fragments still exist.
          charge(bytes); output = chunks.join('').trim(); fragments -= bytes
          const actual = Buffer.byteLength(output)
          assert(actual <= bytes); fragments -= bytes - actual
        } catch { bad = true; fail(); fragments -= bytes }
        chunks.length = 0; active.delete(owned); release()
        if (bad || output === undefined) job.reject(error()); else job.resolve(output)
        pump()
      })
    }
  }
  async function settle() { await Promise.allSettled([...active].map(owned => owned.closed)) }
  function enqueue(args: string[], deadline: number) {
    return new Promise<string>((resolve, reject) => { if (failed) { reject(error()); return }; queue.push({ args, deadline, resolve, reject }); pump() })
  }
  async function run(file: string, args: string[]) {
    const deadline = Date.now() + MS
    const timer = setTimeout(fail, MS)
    const outputs: string[] = []
    let held = 0
    try {
      assert(!failed && file === 'docker' && args.every(value => typeof value === 'string'))
      let chunks: string[][]; let listing: 'container' | 'network' | 'volume' | undefined
      if (key(args) === key(CONTEXT)) {
        assert(!contextDone && !host); contextDone = true; chunks = [[...args]]
      } else {
        assert(contextDone && args[0] === '--host' && typeof args[1] === 'string')
        const path = args[1].slice('unix://'.length)
        assert(args[1].startsWith('unix:///') && isAbsolute(path) && normalize(path) === path && !/[\x00-\x20\x7f%?#]/.test(path))
        if (host) assert.equal(args[1], host); else host = args[1]
        const command = args.slice(2)
        if (key(command) === key(['ps', '-aq', '--no-trunc'])) listing = 'container'
        else if (key(command) === key(['volume', 'ls', '-q'])) listing = 'volume'
        else if (key(command) === key(['network', 'ls', '-q', '--no-trunc'])) listing = 'network'
        if (listing) { assert(!listed.has(listing)); listed.add(listing); chunks = [[...args]] }
        else {
          assert(allowed.delete(key(args)))
          if (command[0] === 'inspect') {
            assert(command[1] === '--format' && command[2] === template)
            const ids = command.slice(3); assert(ids.length > 0 && ids.length <= 128 && ids.every(id => ID.test(id)) && new Set(ids).size === ids.length)
            chunks = []
            for (let n = 0; n < ids.length; n += CHUNK) chunks.push([...args.slice(0, 5), ...ids.slice(n, n + CHUNK)])
          } else { assert(command[0] === 'network' && command[1] === 'inspect'); chunks = [[...args]] }
        }
      }
      // Parents own no child permit. Queue all chunks, attach rejection handlers
      // immediately, and settle every chunk before interpreting output or failure.
      const results = await Promise.allSettled(chunks.map(chunk => enqueue(chunk, deadline)))
      for (const result of results) if (result.status === 'fulfilled') { outputs.push(result.value); held += Buffer.byteLength(result.value) }
      assert(!failed && results.every(result => result.status === 'fulfilled') && Date.now() < deadline)
      if (chunks.length > 1) for (let n = 0; n < outputs.length; n++) {
        const ids = outputs[n].split(/\r?\n/).filter(Boolean).map(line => (JSON.parse(line) as { id?: unknown }).id)
        assert.deepEqual(ids, chunks[n].slice(5))
      }
      const joinBytes = held + Math.max(0, outputs.length - 1)
      charge(joinBytes)
      const output = outputs.join('\n'); fragments -= held; fragments -= joinBytes; accepted += Buffer.byteLength(output)
      held = 0; outputs.length = 0
      if (listing) {
        const ids = output.split(/\s+/).filter(Boolean)
        assert(new Set(ids).size === ids.length)
        assert(ids.every(id => listing === 'volume' ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) : ID.test(id)))
        if (listing !== 'volume') for (let n = 0; n < ids.length; n += 128) {
          allowed.add(key(['--host', host!, ...(listing === 'container' ? ['inspect', '--format', template] : ['network', 'inspect']), ...ids.slice(n, n + 128)]))
        }
      }
      assert(Date.now() < deadline)
      return output
    } catch {
      fail(); await settle(); throw error()
    } finally { clearTimeout(timer); fragments -= held; outputs.length = 0 }
  }
  try {
    const inventory = await testOwnerListDockerInventory(undefined, { ...seams, env, run })
    assert(allowed.size === 0)
    return inventory
  }
  catch { fail(); throw error() }
  finally { if (active.size || queue.length) fail(); await settle(); queue.length = 0; allowed.clear() }
}
