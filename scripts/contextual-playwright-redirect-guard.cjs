'use strict'
// Compatibility shim for this separately admitted, pinned runner ONLY. No I/O
// or hook registration on import; installed dependencies are never rewritten.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync, realpathSync } = require('node:fs')
const { createRequire, registerHooks } = require('node:module')
const { dirname, join } = require('node:path')
const { pathToFileURL } = require('node:url')
const UPSTREAM_SHA256 = 'ad55830a87387450440a4b372ae6a93a6c91c089ccc1e72ffeb298662dddb744'
const CLIENT_NETWORK_SHA256 = '385cd7a58fea3cf46d82533b7c041eee41c903cf9179a810da11f4953df4d9e3'
// The departure fence consumes the SDK's existing, request-correlated frame
// commit event, not a URL-only public event or another CDP interception session.
const NAVIGATION_SOURCES = Object.freeze({
  'server/frames.js': 'fa67e7a3755a79cf0e0ac96b6930987ec2bcc643f60735c6ec748066f7c3e16b',
  'server/chromium/crPage.js': '08f14f9abc4bde5b36a0679889de05e8c3c0ebbf7e15c3bafc3639830e01c174',
  'client/frame.js': 'f3eeec1734312b518d488763365f7b3f877284bf92c01edc267bdbb1648ef8c7',
  'client/channelOwner.js': '7052cae26b3fc156572494b9cf8a6cdddc8d3845aea7dec9ef7642f44f866c7e',
  'client/connection.js': 'e063a23c7fb0ed81e7a09baa0844851c660b3cba1c39176963f17b10a1bf1526',
  'server/dispatchers/frameDispatcher.js': '59c3fd3d39f0dfe8424c50810d035cf74ad44d845d143b7ca7dbcd6d5ead6096',
  'protocol/validator.js': '6643ff17117b16115867af7c647bbe5de151682d9cc8d7998db343405e465c59',
  'server/network.js': '679bd2f9566d39b2ac16bba525b6d40c9f250463dc00b84a71fce226a1e41cd0',
  'server/dispatchers/networkDispatchers.js': '2cfe9170ee8a1519166bc3da8138b7b711518253a0fae2ca750a8228aac643cf',
})
const digest = value => createHash('sha256').update(value).digest('hex')
let installed

function assertContextualNavigationSources(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(NAVIGATION_SOURCES).sort(), 'Private navigation source set mismatch')
  for (const [name, expected] of Object.entries(NAVIGATION_SOURCES)) {
    assert.equal(digest(sources[name]), expected, 'Private navigation source mismatch')
  }
}

function rewriteContextualRedirectAdapter(source) {
  assert.equal(typeof source, 'string')
  assert.equal(digest(source), UPSTREAM_SHA256, 'Private redirect adapter source mismatch')
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, 'Private redirect adapter shape mismatch')
    source = source.replace(before, after)
  }
  // Every hop gets an ordinary RouteImpl, with the browser's actual method,
  // URL and body. The existing context route admits/counts it before continuation.
  replace('if (redirectedFrom || !this._userRequestInterceptionEnabled && this._protocolRequestInterceptionEnabled)',
    'if (!this._userRequestInterceptionEnabled && this._protocolRequestInterceptionEnabled)')
  // Never auto-continue a pause whose request or frame cannot be attributed.
  // Abort and fail the worker; a timeout or ignored event cannot grant success.
  replace('if (!event.networkId) {\n      sessionInfo.session._sendMayFail("Fetch.continueRequest", { requestId: event.requestId });\n      return;\n    }',
    'if (!event.networkId) {\n      sessionInfo.session._sendMayFail("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });\n      throw new Error("Private redirect interception correlation missing");\n    }')
  replace('if (!frame && !this._serviceWorker) {\n      if (requestPausedEvent)\n        requestPausedSessionInfo.session._sendMayFail("Fetch.continueRequest", { requestId: requestPausedEvent.requestId });\n      return;\n    }',
    'if (!frame && !this._serviceWorker) {\n      if (requestPausedEvent) {\n        requestPausedSessionInfo.session._sendMayFail("Fetch.failRequest", { requestId: requestPausedEvent.requestId, errorReason: "BlockedByClient" });\n        throw new Error("Private redirect interception ownership missing");\n      }\n      return;\n    }')
  // This is NOT a general SDK patch: this runner never rewrites requests.
  // In particular it must not depend on inherited redirect header overrides.
  replace('async continue(overrides) {\n    this._alreadyContinuedParams = {',
    'async continue(overrides) {\n    if (["url", "method", "headers", "postData"].some(key => overrides[key] !== undefined))\n      throw new Error("Private redirect interception overrides prohibited");\n    this._alreadyContinuedParams = {')
  // Ordinary Playwright tolerates abort races. This proof runner requires a
  // positive Fetch.failRequest acknowledgement; a swallowed rejection is not one.
  replace('await catchDisallowedErrors(async () => {\n      await this._session.send("Fetch.failRequest", {\n        requestId: this._interceptionId,\n        errorReason\n      });\n    });',
    'await this._session.send("Fetch.failRequest", {\n      requestId: this._interceptionId,\n      errorReason\n    });')
  return source
}

function rewriteContextualRouteClient(source) {
  assert.equal(typeof source, 'string')
  assert.equal(digest(source), CLIENT_NETWORK_SHA256, 'Private route client source mismatch')
  const before = 'await this._raceWithTargetClose(this._channel.abort({ errorCode }));'
  assert.equal(source.split(before).length, 2, 'Private route client shape mismatch')
  // safeRace resolves on target close even if the command has not acknowledged.
  // Retain _handleRoute and its single-handling bookkeeping, but await the exact
  // channel command. The boundary's original deadline still bounds a lost reply.
  return source.replace(before, 'await this._channel.abort({ errorCode });')
}

function installContextualRedirectInterception() {
  assert.equal(process.version, 'v24.12.0', 'Private redirect adapter Node mismatch')
  assert.equal(typeof registerHooks, 'function')
  assert(!installed, 'Private redirect adapter already installed')
  // Resolve through declared dependencies; pnpm does not expose transitive
  // playwright-core from the repository root in an ordinary Node process.
  const testManifest = realpathSync(require.resolve('@playwright/test/package.json'))
  const playwrightManifest = realpathSync(createRequire(testManifest).resolve('playwright/package.json'))
  const manifest = realpathSync(createRequire(playwrightManifest).resolve('playwright-core/package.json'))
  for (const path of [testManifest, playwrightManifest]) assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, '1.58.0')
  assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).version, '1.58.0')
  assertContextualNavigationSources(Object.fromEntries(Object.keys(NAVIGATION_SOURCES).map(name => {
    const path = join(dirname(manifest), 'lib', name)
    assert.equal(realpathSync(path), path)
    return [name, readFileSync(path)]
  })))
  const file = join(dirname(manifest), 'lib/server/chromium/crNetworkManager.js')
  const clientFile = join(dirname(manifest), 'lib/client/network.js')
  const targets = [
    { file, hash: UPSTREAM_SHA256, rewrite: rewriteContextualRedirectAdapter },
    { file: clientFile, hash: CLIENT_NETWORK_SHA256, rewrite: rewriteContextualRouteClient },
  ].map(target => {
    assert.equal(realpathSync(target.file), target.file)
    assert(!require.cache[target.file], 'Private route adapter loaded before guard')
    return { ...target, url: pathToFileURL(target.file).href, loads: 0, rewritten: target.rewrite(readFileSync(target.file, 'utf8')) }
  })
  registerHooks({ load(value, context, nextLoad) {
    const result = nextLoad(value, context)
    const target = targets.find(target => value === target.url)
    if (!target) return result
    assert.equal(++target.loads, 1, 'Private route adapter duplicate load')
    // Node's synchronous CJS loader leaves format undefined for this .js file
    // in a package without type. The complete pinned source is CommonJS.
    assert(result.format === undefined || result.format === 'commonjs')
    assert.equal(digest(result.source), target.hash, 'Private route adapter loader mismatch')
    return { ...result, format: 'commonjs', source: target.rewritten }
  } })
  const native = require(file), client = require(clientFile)
  for (const target of targets) {
    assert.equal(target.loads, 1, 'Private route adapter not intercepted')
    assert.equal(digest(readFileSync(target.file)), target.hash)
  }
  installed = { native, file, client, clientFile, abort: client.Route.prototype.abort, prototype: native.CRNetworkManager.prototype,
    request: native.CRNetworkManager.prototype._onRequest, pause: native.CRNetworkManager.prototype._onRequestPaused }
}

function assertContextualRedirectInterception() {
  assert(installed, 'Private redirect adapter not installed')
  assert.equal(require(installed.file), installed.native)
  assert.equal(installed.prototype._onRequest, installed.request)
  assert.equal(installed.prototype._onRequestPaused, installed.pause)
  assert.equal(require(installed.clientFile), installed.client)
  assert.equal(installed.client.Route.prototype.abort, installed.abort)
}

module.exports = { rewriteContextualRedirectAdapter, rewriteContextualRouteClient, installContextualRedirectInterception, assertContextualRedirectInterception, assertContextualNavigationSources }
