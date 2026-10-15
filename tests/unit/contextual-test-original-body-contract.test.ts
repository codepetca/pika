/** Execute the installed adapter with an inert protocol sender. No browser,
 * request, dependency mutation or replay is performed by this contract test. */
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { ContextualTestBoundary } from '../../e2e/helpers/contextual-test-boundary'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const require = createRequire(import.meta.url)
const playwright = createRequire(require.resolve('@playwright/test/package.json'))
const core = createRequire(playwright.resolve('playwright/package.json'))
const root = dirname(core.resolve('playwright-core/package.json'))
type Header = { name: string; value: string }
type ServerResponse = { headers(): Header[]; body(): Promise<Buffer>; _requestFinished(time: number): void; setRawResponseHeaders(headers: Header[]): void }
const { CRNetworkManager } = require(join(root, 'lib/server/chromium/crNetworkManager.js')) as {
  CRNetworkManager: new (page: null, worker: null) => { _createResponse(request: unknown, payload: unknown, extra: boolean): ServerResponse }
}
const { RawHeaders, Response } = require(join(root, 'lib/client/network.js')) as {
  RawHeaders: new (headers: Header[]) => { headers(): Record<string, string> }
  Response: { prototype: { headers(): Record<string, string> } }
}
const plan = createContextualTestPlan('pika_assignment_list_012345abcdef')
function original(headers: Record<string, string>, inspectorBody = '{}') {
  const send = vi.fn(async (method: string) => {
    if (method === 'Network.getResponseBody') return { body: inspectorBody, base64Encoded: false }
    if (method === 'Network.loadNetworkResource') return { resource: {} }
    throw Error('Unexpected CPU protocol call')
  })
  const request = { url: () => plan.appOrigin + '/incidental', frame: () => ({ attribution: {}, _id: 'CPU-frame' }), _setResponse() {}, setRawRequestHeaders() {}, _timing: {} }
  const server = new CRNetworkManager(null, null)._createResponse({ request, session: { send }, _requestId: 'CPU-request', _wallTime: 0 },
    { headers: { 'content-type': 'application/json', ...headers }, status: 200, statusText: 'OK', protocol: 'http/1.1' }, true)
  // Dispatcher forwards server.headers(); client constructor preserves exactly
  // that array in RawHeaders. Exercise the installed client method, not a copy.
  const provisional = new RawHeaders(server.headers())
  const client = { headers: () => Response.prototype.headers.call({ _provisionalHeaders: provisional }),
    body: vi.fn(() => server.body()), url: request.url, status: () => 200 }
  return { server, client, send }
}

describe('installed Chromium original-body compatibility contract', () => {
  it('pins the adapter and the dispatcher/client provisional-header bridge', () => {
    expect(require('@playwright/test/package.json').version).toBe('1.58.0')
    expect(require(join(root, 'package.json')).version).toBe('1.58.0')
    const dispatcher = readFileSync(join(root, 'lib/server/dispatchers/networkDispatchers.js'), 'utf8')
    expect(dispatcher.slice(dispatcher.indexOf('class ResponseDispatcher'), dispatcher.indexOf('class RouteDispatcher'))).toContain('headers: response.headers()')
    const client = readFileSync(join(root, 'lib/client/network.js'), 'utf8')
    expect(client.slice(client.indexOf('class Response extends'), client.indexOf('class WebSocket extends'))).toContain('this._provisionalHeaders = new RawHeaders(initializer.headers)')
  })
  it('demonstrates the actual empty positive-length fallback and transport-completion delay', async () => {
    const { server, client, send } = original({ 'Content-Length': '2' }, '')
    const body = client.body(); await Promise.resolve(); expect(send).not.toHaveBeenCalled()
    server._requestFinished(1); await body
    expect(send.mock.calls.map(call => call[0])).toEqual(['Network.getResponseBody', 'Network.loadNetworkResource'])
  })
  it.each([
    { 'Content-Length': '2' }, { 'Content-Length': '2', 'content-length': '0' },
    { 'content-length': '0', 'CONTENT-LENGTH': '2' }, { 'Content-Length': '0', 'content-length': '0' },
  ])('rejects positive/duplicate provisional lengths before adapter invocation: %j', async headers => {
    const { server, client, send } = original(headers, '')
    // Extra-info headers are deliberately different: synchronous headers must
    // still expose the original payload used by the adapter's fallback.
    server.setRawResponseHeaders([{ name: 'content-length', value: '0' }])
    const b = new ContextualTestBoundary(plan, Date.now() + 30000), context = {}
    await b.observe(context, client); await expect(b.settle(context)).rejects.toThrow()
    expect(client.body).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
    expect(b.receipt().responseFailure).toMatchObject({ phase: 'response-original-incompatible', resource: 'other' })
  })
  it.each([{}, { 'Content-Length': '0' }])('never invokes the fallback for accepted provisional headers: %j', async headers => {
    const { server, client, send } = original(headers, '')
    const b = new ContextualTestBoundary(plan, Date.now() + 30000), context = {}
    const observed = b.observe(context, client); server._requestFinished(1); await observed
    await expect(b.settle(context)).rejects.toThrow() // empty JSON is still invalid
    expect(b.receipt().firstFailure).toBe('response-json')
    expect(send.mock.calls.map(call => call[0])).toEqual(['Network.getResponseBody'])
  })
})
