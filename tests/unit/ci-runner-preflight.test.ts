import { describe, expect, it } from 'vitest'
import { validateCiWorkspace, validateCiDockerInventory } from '../../scripts/ci-runner-preflight.mjs'

describe('CI runner isolation', () => {
  it('allows the tracked example environment but refuses local credentials', () => {
    expect(() => validateCiWorkspace(['.env.example', 'package.json'])).not.toThrow()
    for (const name of ['.env', '.env.local', '.env.production', '.env.test']) {
      expect(() => validateCiWorkspace(['.env.example', name])).toThrow(/environment/)
    }
  })
  it('refuses existing resources before any stack startup or cleanup', () => {
    expect(() => validateCiDockerInventory({ containers: '', volumes: '', networks: '' })).not.toThrow()
    for (const kind of ['containers', 'volumes', 'networks']) {
      expect(() => validateCiDockerInventory({ containers: '', volumes: '', networks: '', [kind]: 'existing' })).toThrow(/dedicated/)
    }
  })
})
