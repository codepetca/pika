'use strict'
/** Import-safe policy. Native activation is explicit and needs the coordinator's
 * inherited macOS sandbox as well: JavaScript hooks are defense in depth. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')

/** One private, append-monotonic counter state shared by the Next parent and
 * child. A lock is never adopted, expired, or removed by a competing process.
 * Interrupted writes/unknown lock ownership poison the attempt; no recovery. */
function createContextualTestSharedLedger({ outputDir, nonce, deadline }, { create = false } = {}) {
  assert(path.isAbsolute(outputDir) && fs.realpathSync(outputDir) === outputDir)
  assert(/^[a-f0-9]{32}$/.test(nonce) && Number.isSafeInteger(deadline))
  const names = Object.freeze({ ledger: path.join(outputDir, 'server-counts.json'), lock: path.join(outputDir, 'server-counts.lock'), poison: path.join(outputDir, 'server-counts.poison') })
  const parent = fs.lstatSync(outputDir)
  assert(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === process.getuid() && (parent.mode & 0o777) === 0o700)
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino
  const regular = s => assert(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === 0o600 && s.nlink === 1 && s.size <= 4096)
  const directory = () => { const s = fs.lstatSync(outputDir); assert(same(s, parent) && s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === parent.uid) }
  const flags = () => ({ denied: false, capExceeded: false, expired: false, uncertain: false })
  const decode = text => {
    const state = JSON.parse(text)
    assert.deepEqual(Object.keys(state).sort(), ['api','app','deadline','flags','nonce','storage','version'])
    assert.equal(state.version, 1); assert.equal(state.nonce, nonce); assert.equal(state.deadline, deadline)
    for (const key of ['app','storage','api']) assert(Number.isSafeInteger(state[key]) && state[key] >= 0)
    assert(state.app <= 50 && state.storage <= 20)
    assert.deepEqual(Object.keys(state.flags).sort(), Object.keys(flags()).sort())
    assert(Object.values(state.flags).every(v => typeof v === 'boolean'))
    return state
  }
  const sleep = new Int32Array(new SharedArrayBuffer(4))
  const acquire = () => {
    directory()
    const until = Math.min(Date.now() + 100, deadline)
    for (;;) {
      try {
        const fd = fs.openSync(names.lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
        const token = randomBytes(16).toString('hex')
        const owner = JSON.stringify({ version: 1, nonce, token, pid: process.pid })
        let stat
        try { fs.writeFileSync(fd, owner); fs.fsyncSync(fd); stat = fs.fstatSync(fd) } finally { fs.closeSync(fd) }
        return { stat, owner }
      } catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= until) throw new Error('Tests shared ledger lock uncertain')
        // Never inspect a competing lock to justify stale adoption.
        Atomics.wait(sleep, 0, 0, Math.min(5, Math.max(1, until - Date.now())))
      }
    }
  }
  const release = owner => {
    directory()
    const s = fs.lstatSync(names.lock); regular(s); assert(!s.isSymbolicLink() && same(s, owner.stat))
    const fd = fs.openSync(names.lock, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try { assert(same(fs.fstatSync(fd), owner.stat)); assert.equal(fs.readFileSync(fd, 'utf8'), owner.owner) } finally { fs.closeSync(fd) }
    fs.unlinkSync(names.lock)
  }
  let identity
  const open = () => {
    directory()
    const s = fs.lstatSync(names.ledger); regular(s); assert(!s.isSymbolicLink())
    if (identity) assert(same(s, identity), 'Tests shared ledger replaced')
    const fd = fs.openSync(names.ledger, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW)
    try {
      const actual = fs.fstatSync(fd); regular(actual); assert(same(s, actual))
      const state = decode(fs.readFileSync(fd, 'utf8'))
      return { fd, state, stat: actual }
    } catch (error) { fs.closeSync(fd); throw error }
  }
  const poison = () => {
    try {
      directory()
      const fd = fs.openSync(names.poison, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, nonce, deadline, uncertain: true })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    } catch { /* Existing or unverified paths are never overwritten. */ }
  }
  if (create) {
    assert(Date.now() < deadline)
    assert(!fs.existsSync(names.ledger) && !fs.existsSync(names.lock) && !fs.existsSync(names.poison), 'Shared ledger may only be initialized once')
    const owner = acquire()
    try {
      const fd = fs.openSync(names.ledger, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, nonce, deadline, app: 0, storage: 0, api: 0, flags: flags() })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    } finally { release(owner) }
  }
  // Establish this attempt before acquiring authority to write a poison marker.
  const initialOwner = acquire()
  try { const initial = open(); identity = initial.stat; fs.closeSync(initial.fd) } finally { release(initialOwner) }
  const transaction = action => {
    let owner, opened
    try {
      owner = acquire(); opened = open()
      const hasPoison = fs.existsSync(names.poison)
      if (hasPoison) {
        const s = fs.lstatSync(names.poison); regular(s); assert(!s.isSymbolicLink())
        const marker = JSON.parse(fs.readFileSync(names.poison, 'utf8'))
        assert.equal(marker.nonce, nonce); assert.equal(marker.deadline, deadline); assert.equal(marker.uncertain, true)
        opened.state.flags.uncertain = true
      }
      const result = action(opened.state)
      assert(same(fs.lstatSync(names.ledger), identity))
      const bytes = Buffer.from(JSON.stringify(opened.state)); assert(bytes.length <= 4096)
      fs.writeSync(opened.fd, bytes, 0, bytes.length, 0); fs.ftruncateSync(opened.fd, bytes.length); fs.fsyncSync(opened.fd)
      assert(same(fs.lstatSync(names.ledger), identity))
      return result
    } catch (error) { poison(); throw new Error('Tests shared ledger uncertain', { cause: error }) }
    finally {
      if (opened) fs.closeSync(opened.fd)
      if (owner) { try { release(owner) } catch (error) { poison(); throw new Error('Tests shared ledger lock release uncertain', { cause: error }) } }
    }
  }
  return Object.freeze({
    paths: names,
    charge(bucket) {
      assert(['app','storage','api'].includes(bucket))
      let failed = false
      transaction(state => {
        if (Object.values(state.flags).some(Boolean)) failed = true
        if (Date.now() >= deadline) { state.flags.expired = true; failed = true }
        if (!failed) {
          if (!Number.isSafeInteger(state[bucket] + 1) || (bucket === 'app' && state.app === 50) || (bucket === 'storage' && state.storage === 20)) { state.flags.capExceeded = true; failed = true }
          else state[bucket]++
        }
      })
      assert(!failed, 'Tests shared server allocation closed')
    },
    note(flag) { assert(Object.hasOwn(flags(), flag)); transaction(state => { state.flags[flag] = true }) },
    snapshot() { return transaction(state => structuredClone(state)) },
  })
}

function createContextualTestEgressPolicy({ deadline, ledger }) {
  assert(Number.isSafeInteger(deadline))
  let app = 0, storage = 0
  const check = () => {
    if (Date.now() >= deadline) { ledger?.note('expired'); throw new Error('Tests server deadline expired') }
  }
  const url = value => {
    check()
    try {
      const u = new URL(value)
      assert(!u.username && !u.password && !u.hash)
      assert(u.origin === 'http://localhost:3117' || (u.origin === 'http://127.0.0.1:54331' && /^\/(?:rest|storage)\/v1(?:\/|$)/.test(u.pathname)), 'Tests server egress rejected')
      return u
    } catch (error) { ledger?.note('denied'); throw error }
  }
  return Object.freeze({
    check,
    admit(value) {
      const u = url(value)
      const isStorage = u.origin === 'http://127.0.0.1:54331' && u.pathname.startsWith('/storage/')
      const bucket = isStorage ? 'storage' : u.origin === 'http://localhost:3117' ? 'app' : 'api'
      if (ledger) ledger.charge(bucket)
      else if (isStorage) assert(++storage <= 20, 'Tests server Storage allocation exhausted')
      else if (bucket === 'app') assert(++app <= 50, 'Tests server app allocation exhausted')
      return bucket
    },
    socket(options) {
      check()
      try {
        assert(options && !options.path && !options.socketPath)
        const host = options.hostname || options.host
        assert((host === 'localhost' && Number(options.port) === 3117) || (host === '127.0.0.1' && Number(options.port) === 54331), 'Tests server socket rejected')
      } catch (error) { ledger?.note('denied'); throw error }
    },
    counts: () => ledger ? ledger.snapshot() : Object.freeze({ app, storage }),
  })
}

function validateContextualTestNextFork(expectedModule, modulePath, args, forkOptions, parentEnv, preloadPath, platform = process.platform) {
  assert.equal(modulePath, expectedModule)
  assert(args && !Array.isArray(args) && forkOptions === undefined)
  assert.deepEqual(Object.keys(args).sort(), ['env','stdio']); assert.equal(args.stdio, 'inherit')
  const env = args.env
  assert(env && Object.getPrototypeOf(env) === Object.prototype)
  const allowed = new Set(['NEXT_PRIVATE_WORKER','NEXT_PRIVATE_TRACE_ID','NODE_OPTIONS','WATCHPACK_WATCHER_LIMIT','NODE_EXTRA_CA_CERTS'])
  for (const key of new Set([...Object.keys(parentEnv), ...Object.keys(env)])) {
    if (!allowed.has(key)) assert.equal(env[key], parentEnv[key], 'Next child environment drift')
  }
  assert.equal(env.NEXT_PRIVATE_WORKER, '1')
  assert(typeof env.NEXT_PRIVATE_TRACE_ID === 'string' && /^[a-f0-9]{16,64}$/.test(env.NEXT_PRIVATE_TRACE_ID))
  assert(env.NODE_EXTRA_CA_CERTS === undefined && parentEnv.NODE_EXTRA_CA_CERTS === undefined)
  assert(env.WATCHPACK_WATCHER_LIMIT === (platform === 'darwin' ? '20' : undefined))
  assert.equal(parentEnv.NEXT_DISABLE_MEM_OVERRIDE, '1')
  const tokens = value => String(value || '').trim().split(/\s+/).filter(Boolean)
  const actual = tokens(env.NODE_OPTIONS).filter(t => t !== '--enable-source-maps')
  const original = tokens(parentEnv.NODE_OPTIONS).filter(t => t !== '--enable-source-maps')
  assert.deepEqual(actual, original, 'Next child must inherit the exact preload')
  assert(actual.some(t => t === `--require=${preloadPath}`), 'Exact egress preload missing')
}

/** Keep failures visible even when application code catches the network error.
 * The timer covers dispatch through the original response's complete body; an
 * inactivity timeout alone would allow a trickle to extend the operation. */
function boundContextualTestHttpRequest(req, options) {
  let complete = false
  const fail = (flag, message) => { options.ledger?.note(flag); req.destroy(new Error(message)) }
  const remaining = Math.min(30000, options.deadline - Date.now())
  assert(remaining > 0)
  const timer = setTimeout(() => fail('uncertain', 'Tests server operation deadline'), remaining)
  timer.unref?.()
  req.once('error', () => { options.ledger?.note('uncertain'); clearTimeout(timer) })
  req.once('close', () => { clearTimeout(timer); if (!complete) options.ledger?.note('uncertain') })
  req.once('response', res => {
    let bytes = 0
    res.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 1048576) fail('capExceeded', 'Tests server response cap')
    })
    res.once('end', () => { complete = true; clearTimeout(timer) })
    res.once('aborted', () => fail('uncertain', 'Tests server response incomplete'))
    res.once('error', () => fail('uncertain', 'Tests server response failed'))
  })
  return req
}

function createContextualTestBoundedFetch(originalFetch, options, policy) {
  return async (input, init = {}) => {
    policy.admit(input instanceof Request ? input.url : String(input))
    const remaining = Math.min(30000, options.deadline - Date.now()); assert(remaining > 0)
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining)
    try {
      const response = await originalFetch(input, { ...init, redirect: 'error', signal })
      assert(!response.redirected)
      const reader = response.body?.getReader(); const chunks = []; let size = 0
      if (reader) {
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length
          if (size > 1048576) { options.ledger?.note('capExceeded'); throw new Error('Tests server response cap') }
          chunks.push(value)
        } } catch (error) { await reader.cancel().catch(() => {}); throw error }
      }
      policy.check()
      return new Response(response.body ? Buffer.concat(chunks) : null, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch { options.ledger?.note('uncertain'); throw new Error('Tests server bounded fetch failed') }
  }
}

/** Explicit install returns an audit accessor. Never auto-installs in Vitest or
 * application collection; the exact native launch must invoke this preload. */
function installContextualTestEgress(options) {
  const policy = createContextualTestEgressPolicy(options)
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https')
  const child = require('node:child_process'), http2 = require('node:http2')
  const deny = () => { options.ledger?.note('denied'); throw new Error('Tests server native escape rejected') }
  const originalFork = child.fork
  const originalConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    const normalized = net._normalizeArgs(args)
    policy.socket(normalized[0])
    return Reflect.apply(originalConnect, this, args)
  }
  tls.connect = deny; http2.connect = deny
  require('node:worker_threads').Worker = deny
  for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) child[key] = deny
  if (options.nextServerPath) {
    assert(path.isAbsolute(options.nextServerPath) && fs.realpathSync(options.nextServerPath) === options.nextServerPath)
    let launched = false
    child.fork = function (modulePath, args, forkOptions) {
      policy.check()
      assert(!launched && process.env.NEXT_PRIVATE_WORKER !== '1', 'Only one exact Next child is admitted')
      // Set NEXT_DISABLE_MEM_OVERRIDE=1 in the hermetic parent. The installed
      // next-dev fork may add only its documented source-map option.
      validateContextualTestNextFork(options.nextServerPath, fs.realpathSync(modulePath), args, forkOptions, process.env, __filename)
      launched = true
      const result = Reflect.apply(originalFork, this, [modulePath, args])
      options.onChild?.(result)
      return result
    }
  }
  const request = http.request
  http.request = function (...args) {
    const first = args[0]
    let u
    if (typeof first === 'string' || first instanceof URL) u = new URL(first)
    else { assert(first && !first.socketPath && !first.createConnection && !first.agent); u = new URL(`http://${first.hostname || first.host}:${first.port || 80}${first.path || '/'}`) }
    policy.admit(u.href)
    return boundContextualTestHttpRequest(Reflect.apply(request, this, args), options)
  }
  http.get = function (...args) { const req = http.request(...args); req.end(); return req }
  https.request = deny; https.get = deny
  globalThis.fetch = createContextualTestBoundedFetch(globalThis.fetch, options, policy)
  require('node:module').syncBuiltinESMExports()
  return policy
}

module.exports = { createContextualTestEgressPolicy, installContextualTestEgress, validateContextualTestNextFork, createContextualTestSharedLedger, boundContextualTestHttpRequest, createContextualTestBoundedFetch }

// Native launch is possible only with the root's exact private binding digest.
// The application never discovers this configuration from .env files.
if (process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE || process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256) {
  const file = process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE
  const digest = process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256
  assert(file && path.isAbsolute(file) && /^[a-f0-9]{64}$/.test(digest || ''))
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let binding
  try {
    const stat = fs.fstatSync(fd)
    assert(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.nlink === 1 && stat.size <= 65536)
    const text = fs.readFileSync(fd)
    assert.equal(createHash('sha256').update(text).digest('hex'), digest)
    binding = JSON.parse(text.toString('utf8'))
  } finally { fs.closeSync(fd) }
  assert.equal(binding.version, 1)
  assert.equal(binding.sourceSha, '21e755d36037214b32dc6ddd5af68f4247587ca8')
  assert.equal(binding.sourceTree, 'b59213ae97df102ad7ac3ab9912f8a9129f19265')
  assert.equal(binding.appOrigin, 'http://localhost:3117'); assert.equal(binding.apiOrigin, 'http://127.0.0.1:54331')
  assert(Number.isSafeInteger(binding.startedAt) && binding.startedAt <= Date.now())
  assert(Number.isSafeInteger(binding.deadline) && binding.deadline - binding.startedAt <= 2700000)
  assert.equal(path.dirname(file), binding.outputDir)
  const nextServerPath = fs.realpathSync(path.join(binding.appDir, 'node_modules/next/dist/server/lib/start-server.js'))
  const ledger = createContextualTestSharedLedger(binding)
  const policy = installContextualTestEgress({ deadline: binding.deadline, nextServerPath, ledger })
  Object.defineProperty(globalThis, '__contextualTestServerEgress', { value: policy, writable: false, configurable: false })
}
