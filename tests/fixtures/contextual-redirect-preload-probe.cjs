'use strict'
// CPU-only module-loading probe. No browser, sockets, app, credentials or DB.
const assert = require('node:assert/strict')
const { fork } = require('node:child_process')
require('@playwright/test')
const guard = require('../../scripts/contextual-playwright-redirect-guard.cjs')
guard.assertContextualRedirectInterception()
if (process.env.PIKA_REDIRECT_CPU_CHILD === 'true') {
  process.send({ installed: true }); process.disconnect()
} else {
  const child = fork(__filename, { env: { ...process.env, PIKA_REDIRECT_CPU_CHILD: 'true' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  let confirmed = false
  const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, 5000)
  child.on('message', value => { assert.deepEqual(value, { installed: true }); confirmed = true })
  child.on('exit', code => { clearTimeout(timer); assert.equal(code, 0); assert(confirmed); process.stdout.write('{"parent":true,"worker":true}\n') })
}
