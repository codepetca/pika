#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'

export function validateCiWorkspace(names) {
  if (names.some(name => (name === '.env' || name.startsWith('.env.')) && name !== '.env.example')) {
    throw new Error('CI workspace contains an environment file; use a clean checkout without local credentials')
  }
}

export function validateCiDockerInventory(inventory) {
  if (Object.values(inventory).some(value => value.trim())) {
    throw new Error('CI needs a dedicated empty Docker daemon; existing resources were left untouched. Inspect the VM before retrying.')
  }
}

async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`CI requires unused loopback port ${port}`)))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(resolve))
  })
}

export async function preflightCiRunner(lane) {
  if (!['database', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser', 'browser-dark', 'test-build'].includes(lane)) throw new Error('Unknown CI lane')
  validateCiWorkspace(readdirSync('.'))
  if (process.env.RUNNER_ENVIRONMENT === 'self-hosted' && process.platform !== 'linux') throw new Error('Self-hosted CI requires Linux')
  if (lane === 'test-build') return
  if (process.platform !== 'linux') throw new Error('Database, SDK and browser CI require an isolated Linux VM')
  const docker = args => {
    try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { throw new Error('Cannot inspect the dedicated Docker daemon; no cleanup was attempted') }
  }
  validateCiDockerInventory({
    containers: docker(['ps', '-aq']),
    volumes: docker(['volume', 'ls', '-q']),
    networks: docker(['network', 'ls', '--filter', 'type=custom', '--format', '{{.ID}}']),
  })
  // Existing harnesses use canonical and sibling-stack ports; preserve them.
  await Promise.all([3000, 54320, 54321, 54322, 54323, 54324, 54327, 54329, 54331, 54332, 54340].map(assertFreePort))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--lane') throw new Error('Usage: ci-runner-preflight.mjs --lane database|test-owner-sdk|test-owner-sdk-lifecycle|browser|browser-dark|test-build')
    await preflightCiRunner(process.argv[3])
    console.log('PASS isolated CI workspace and dedicated runner preflight')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
