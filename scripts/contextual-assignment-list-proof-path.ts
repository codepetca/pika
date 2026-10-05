import assert from 'node:assert/strict'

/** Fixed existing system temp roots; no caller-supplied parent or filesystem access. */
export function assignmentListProofWorkdir(projectId: string, platform = process.platform) {
  assert.match(projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  assert(platform === 'darwin' || platform === 'linux')
  return `${platform === 'darwin' ? '/private/tmp' : '/tmp'}/pika-assignment-list-${projectId.slice(-12)}`
}
