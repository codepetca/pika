import { createHash } from 'crypto'
import type { MappedOperation, PlannedOperation } from './types'

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function planOperations(
  mapped: MappedOperation[],
  lastHashes: Map<string, string>
): PlannedOperation[] {
  return mapped.map((operation) => {
    const payload_hash = hashPayload(operation.payload)
    const key = `${operation.entity_type}:${operation.entity_key}`
    const action = lastHashes.get(key) === payload_hash ? 'noop' : 'upsert'

    return {
      ...operation,
      payload_hash,
      action,
    }
  })
}
