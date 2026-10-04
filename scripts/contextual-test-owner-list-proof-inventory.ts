/** Invocation-local acceleration for the Test owner list extension guard only.
 * Import is inert. Three bounded workers discover the complete global topology;
 * the sealed assignment-list parser still validates and constructs the result.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'

type Run = (file: string, args: string[]) => Promise<string>
const outputBytes = 64 * 1024 * 1024
const failure = () => new Error('Private Test owner list inventory rejected')
const commandKey = (file: string, args: string[]) => JSON.stringify([file, args])

function command(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 20000, maxBuffer: outputBytes, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(failure())
      else resolve(stdout.trim())
    })
  })
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

export async function testOwnerListDockerInventory(run: Run = command): ReturnType<typeof assignmentListDockerInventory> {
  const results = new Map<string, string>()
  let pending: Promise<void> | undefined
  async function prefetch() {
    const specs = pipelines()
    async function capture(args: string[]) {
      const key = commandKey('docker', args)
      assert(!results.has(key))
      const output = await run('docker', [...args])
      assert(typeof output === 'string' && Buffer.byteLength(output, 'utf8') <= outputBytes)
      results.set(key, output)
      return output
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
    return output
  }
  try {
    const inventory = await assignmentListDockerInventory(consume)
    assert.equal(results.size, 0)
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
