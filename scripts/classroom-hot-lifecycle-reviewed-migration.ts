/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const CLASSROOM_HOT_LIFECYCLE_REVIEWED_MIGRATION=Object.freeze({
  name:'268_contextual_classroom_hot_lifecycle.sql',
  sha256:'f7990de91330bb951fd7c63784f9a324b19c16ff946c094797d187af02a76254',
})
export function validateClassroomHotLifecycleReviewedMigration(migration:{name:string;sql:string;sha256:string}) {
  assert.equal(migration.name,CLASSROOM_HOT_LIFECYCLE_REVIEWED_MIGRATION.name)
  const seal=CLASSROOM_HOT_LIFECYCLE_REVIEWED_MIGRATION.sha256
  assert.match(seal,/^[a-f0-9]{64}$/);assert.equal(migration.sha256,seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'),seal)
}
