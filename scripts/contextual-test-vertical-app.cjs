/** Test-only standard Next custom server. Importing never launches anything.
 * Advertise the real browser origin while binding only the private gateway port.
 * No request/Origin rewriting or framework interception is used.
 */
'use strict'

async function startContextualTestVerticalApp({ next, createServer, dir }) {
  const server = createServer()
  const app = next({ dev: true, hostname: 'localhost', port: 3117, dir, httpServer: server })
  await app.prepare()
  const handler = app.getRequestHandler()
  server.on('request', (request, response) => {
    Promise.resolve().then(() => handler(request, response)).catch(() => response.destroy())
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(3118, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  // Readiness is independently checked through an owned listener and HTTP GET.
  return { app, server }
}

module.exports = { startContextualTestVerticalApp }
if (require.main === module) {
  const assert = require('node:assert/strict')
  assert.equal(process.argv.length, 3)
  const next = require(process.argv[2])
  const startedAt = Date.now()
  startContextualTestVerticalApp({ next, createServer: require('node:http').createServer, dir: process.cwd() })
    .then(() => process.stdout.write(`Ready in ${Date.now() - startedAt}ms\n`))
    .catch(() => { process.stderr.write('Private contextual Test app startup failed\n'); process.exitCode = 1 })
}
