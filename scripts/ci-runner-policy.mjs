#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Routing changes compute location only; required jobs and checks stay intact.
export function selectCiRunner({ event, repository, headRepository, enabled = '', requested = 'auto' }) {
  if (!['pull_request', 'workflow_dispatch'].includes(event)) throw new Error('Unsupported CI event')
  if (!['', 'false', 'true'].includes(enabled)) throw new Error('PIKA_SELF_HOSTED_CI must be true, false, or unset')
  if (!['auto', 'hosted', 'self-hosted'].includes(requested)) throw new Error('Unknown CI runner request')
  const trusted = Boolean(repository)
    && (event === 'workflow_dispatch' || headRepository === repository)
  if (requested === 'self-hosted' && !trusted) throw new Error('Self-hosted CI requires a repository identity and same-repository source')
  return (requested === 'self-hosted' || (requested === 'auto' && enabled === 'true' && trusted))
    ? ['self-hosted', 'Linux', 'pika-ci'] : ['ubuntu-latest']
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runner = selectCiRunner({
      event: process.env.CI_EVENT,
      repository: process.env.CI_REPOSITORY,
      headRepository: process.env.CI_HEAD_REPOSITORY,
      enabled: process.env.CI_SELF_HOSTED_ENABLED,
      requested: process.env.CI_REQUESTED_RUNNER || 'auto',
    })
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GITHUB_OUTPUT')
    appendFileSync(process.env.GITHUB_OUTPUT, `heavy_runner=${JSON.stringify(runner)}\n`)
    console.log(`Heavy CI runner: ${runner.join(', ')}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
