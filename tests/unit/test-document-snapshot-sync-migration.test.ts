import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/105_atomic_test_document_snapshot_sync.sql',
  ),
  'utf8',
)

describe('atomic test document snapshot sync migration', () => {
  it('locks the test and classroom before checking ownership and archive state', () => {
    expect(migration).toMatch(/for update of t, c/i)
    expect(migration).toMatch(/v_owner_id is distinct from p_teacher_id/i)
    expect(migration).toMatch(/v_archived_at is not null/i)
  })

  it('rejects a removed, replaced, or edited link document', () => {
    expect(migration).toMatch(/document\.value ->> 'id' = p_document_id/i)
    expect(migration).toMatch(/v_document ->> 'source' is distinct from 'link'/i)
    expect(migration).toMatch(/v_document ->> 'url' is distinct from p_expected_url/i)
    expect(migration).toMatch(/message = 'document_conflict'/i)
  })

  it('updates one current document element and preserves the rest of the array', () => {
    expect(migration).toMatch(/jsonb_set\(\s*v_documents/i)
    expect(migration).toMatch(/array\[v_document_index::text\]/i)
    expect(migration).toMatch(/'previous_snapshot_path'/i)
  })

  it('limits execution to the service role', () => {
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/i)
    expect(migration).toMatch(/grant execute on function[\s\S]*to service_role/i)
  })
})
