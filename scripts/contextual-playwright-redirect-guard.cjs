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
const digest = value => createHash('sha256').update(value).digest('hex')
let installed

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
  return source
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
  const file = join(dirname(manifest), 'lib/server/chromium/crNetworkManager.js')
  assert.equal(realpathSync(file), file)
  assert(!require.cache[file], 'Private redirect adapter loaded before guard')
  const original = readFileSync(file, 'utf8'), rewritten = rewriteContextualRedirectAdapter(original)
  const url = pathToFileURL(file).href
  let loads = 0
  registerHooks({ load(value, context, nextLoad) {
    const result = nextLoad(value, context)
    if (value !== url) return result
    assert.equal(++loads, 1, 'Private redirect adapter duplicate load')
    // Node's synchronous CJS loader leaves format undefined for this .js file
    // in a package without type. The complete pinned source is CommonJS.
    assert(result.format === undefined || result.format === 'commonjs')
    assert.equal(digest(result.source), UPSTREAM_SHA256, 'Private redirect adapter loader mismatch')
    return { ...result, format: 'commonjs', source: rewritten }
  } })
  const native = require(file)
  assert.equal(loads, 1, 'Private redirect adapter not intercepted')
  assert.equal(digest(readFileSync(file)), UPSTREAM_SHA256)
  installed = { native, file, prototype: native.CRNetworkManager.prototype,
    request: native.CRNetworkManager.prototype._onRequest, pause: native.CRNetworkManager.prototype._onRequestPaused }
}

function assertContextualRedirectInterception() {
  assert(installed, 'Private redirect adapter not installed')
  assert.equal(require(installed.file), installed.native)
  assert.equal(installed.prototype._onRequest, installed.request)
  assert.equal(installed.prototype._onRequestPaused, installed.pause)
}

module.exports = { rewriteContextualRedirectAdapter, installContextualRedirectInterception, assertContextualRedirectInterception }
