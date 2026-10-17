/** OS-enforced destinations for the narrow workflow. No framework IPC hooks. */
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { contextualTestReadOnlyDependencyProfile } from './contextual-test-rehearsal-launch'

function checked(value: string): string {
  assert(isAbsolute(value) && normalize(value) === value && !/[\x00-\x20\x7f]/.test(value))
  assert(!['/', '/Users', '/private/tmp'].includes(value))
  return JSON.stringify(value)
}
export function contextualTestVerticalProfile(role: 'app' | 'browser', roots: readonly string[], workdir: string, outputDir: string): string {
  assert(role === 'app' || role === 'browser'); checked(workdir); checked(outputDir)
  const inherited = contextualTestReadOnlyDependencyProfile(roots)
  const sensitive = ['Repos/.env', '.ssh', '.aws', '.config/gcloud', 'Library/Keychains'].map(p => `(subpath ${checked(join(homedir(), p))})`).join(' ')
  return `${inherited}(deny network*)\n(deny file-read-data ${sensitive})\n`
    + (role === 'app'
      ? '(allow network-outbound (remote tcp4 "localhost:54340"))\n(allow network-bind network-inbound (local tcp4 "localhost:3118"))\n'
      : '(allow network-outbound (remote tcp4 "localhost:3117"))\n')
}
export function contextualTestVerticalCommands(runnerRoot: string, dependencyRoot: string) {
  checked(runnerRoot); checked(dependencyRoot)
  return { app: [join(dependencyRoot, 'next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3118'],
    runner: [join(dependencyRoot, '@playwright/test/cli.js'), 'test', `--config=${join(runnerRoot, 'playwright.contextual-test-vertical.config.ts')}`, 'contextual-test-vertical.spec.ts'] }
}

/** Literal JS keeps tsx/esbuild naming helpers outside the serialized program. */
const verticalNetworkProbeSource = String.raw`async function verticalNetworkProbeMain(config) {
  const net = require('node:net')
  const dgram = require('node:dgram')
  const token = 'vertical-network-denied-v1'
  const deadline = config.deadline ?? Date.now() + 9500, workDeadline = deadline - 2500
  const denied = error => !!error && ['EPERM','EACCES'].includes(error.code ?? '')
  function attempt(udp, target) {
    return new Promise(resolve => {
      let socket
      let stopping = false, accepted = false, finished = false
      const done = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(accepted) }
      const stop = ok => {
        if (stopping) return
        stopping = true; accepted = ok
        if (!socket) { done(); return }
        try { if (udp) socket.close(); else socket.destroy() }
        catch (error) {
          // dgram has no live handle when close reports NOT_RUNNING.
          if (udp && error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') done()
          else accepted = false // Uncertain live handle: native deadline owns closure.
        }
      }
      const timer = setTimeout(() => stop(false), Math.max(0, workDeadline - Date.now()))
      try {
        socket = udp ? dgram.createSocket(target.host === '::1' ? 'udp6' : 'udp4') : new net.Socket()
        socket.once('close', done)
        socket.on('error', error => stop(denied(error)))
        socket.once('connect', () => stop(false))
        if (udp) socket.connect(target.port, target.host, () => stop(false))
        else socket.connect(target)
      } catch (error) { stop(denied(error)) }
    })
  }
  // Every attempt sends zero payload bytes. A refused/missing service is no proof.
  const ports = [54321,54322,54331,54332,config.role === 'browser' ? 3118 : 3117]
  const jobs = ['127.0.0.1','::1'].flatMap(host => ports.map(port => attempt(false, { host, port })))
  // The permitted port is IPv4-only, including when the peer is v4-mapped IPv6.
  jobs.push(...['::1','::ffff:127.0.0.1'].map(host => attempt(false, { host, port: config.role === 'browser' ? 3117 : 54340 })))
  jobs.push(attempt(false, { host: '192.0.2.1', port: 80 }), attempt(false, { path: config.socketPath }),
    attempt(true, { host: '127.0.0.1', port: 54321 }), attempt(true, { host: '::1', port: 54321 }))
  let childResult = Promise.resolve(true)
  if (!config.inherited) {
    const { spawn } = require('node:child_process')
    const source = '(' + verticalNetworkProbeMain.toString() + ')(' + JSON.stringify({ ...config, inherited: true, deadline }) + ').catch(() => { process.exitCode = 1 })'
    childResult = new Promise(resolve => {
      let output = '', failed = false
      const child = spawn(process.execPath, ['-e', source], { env: { NODE_ENV: 'test' }, stdio: ['ignore','pipe','ignore'] })
      // Work stops at 7s. Late child closure rejects success; this program has
      // no authority to signal a PID without the native owner's identity checks.
      const timer = setTimeout(() => { failed = true }, Math.max(0, deadline - 1000 - Date.now()))
      child.on('error', () => { failed = true })
      child.stdout.on('data', chunk => {
        const text = chunk.toString()
        if (output.length + text.length > token.length) { failed = true; return }
        output += text
      })
      child.once('close', (code, signal) => { clearTimeout(timer); resolve(!failed && code === 0 && signal === null && output === token) })
    }).catch(() => false) // A synchronous spawn failure owns no child; join sockets.
  }
  const results = await Promise.all([...jobs, childResult])
  // Joined success is bounded to 9.5s. Uncertain OS closure prints no token;
  // it remains owned by the native caller rather than forcing an unsafe exit.
  if (results.every(Boolean) && Date.now() < deadline) process.stdout.write(token)
  else process.exitCode = 1
}`

/** Generate only; the caller supplies the pinned Node and sandbox invocation. */
export function contextualTestVerticalNetworkProbe(role: 'app' | 'browser', dockerSocketPath: string): string {
  assert(role === 'app' || role === 'browser'); checked(dockerSocketPath)
  return `(${verticalNetworkProbeSource})(${JSON.stringify({ role, socketPath: dockerSocketPath, inherited: false })}).catch(() => { process.exitCode = 1 })`
}
