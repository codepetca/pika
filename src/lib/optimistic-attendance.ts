type MarkOperation<Status> = {
  studentIds: string[]
  status: Status
  committedAt: number | null
}

/** Keeps independent students responsive while serializing overlapping writes. */
export class OptimisticAttendanceQueue<View, Status> {
  private base: View | null = null
  private operations: MarkOperation<Status>[] = []
  private tails = new Map<string, Promise<void>>()
  private active = true
  private epoch = 0
  version = 0

  constructor(private readonly adapter: {
    project: (view: View, studentIds: string[], status: Status) => View
    matches: (view: View, studentId: string, status: Status) => boolean
    onChange: (view: View, pendingStudentIds: Set<string>) => void
  }) {}

  get isActive() { return this.active }

  get pendingStudentIds() {
    return new Set(this.operations.filter(op => op.committedAt === null).flatMap(op => op.studentIds))
  }

  get hasUnconfirmedMarks() {
    return this.operations.some(op => op.committedAt !== null)
  }

  private publish() {
    if (!this.active || this.base === null) return
    const projected = this.operations.reduce<View>(
      (view, op) => this.adapter.project(view, op.studentIds, op.status), this.base,
    )
    this.adapter.onChange(projected, this.pendingStudentIds)
  }

  accept(view: View, readVersion: number) {
    if (!this.active) return
    this.base = view
    // Retire saved prefixes per student. Never let a read started before a
    // commit retire its projection, or retire a newer write with an older read.
    const confirmedThrough = new Map<string, number>()
    this.operations.forEach((op, index) => {
      if (op.committedAt === null || op.committedAt > readVersion) return
      op.studentIds.forEach(id => {
        if (this.adapter.matches(view, id, op.status)) confirmedThrough.set(id, index)
      })
    })
    this.operations = this.operations.flatMap((op, index) => {
      const studentIds = op.studentIds.filter(id => (
        op.committedAt === null || index > (confirmedThrough.get(id) ?? -1)
      ))
      op.studentIds = studentIds
      return studentIds.length ? [op] : []
    })
    this.publish()
  }

  activate() {
    this.active = true
  }

  dispose() {
    this.active = false
    this.epoch++
    this.operations = []
    this.tails.clear()
  }

  run(
    studentIds: string[],
    status: Status,
    write: (ids: string[], commit: (ids: string[]) => void) => Promise<string[]>,
  ): Promise<void> {
    if (!this.active || this.base === null || studentIds.length === 0) return Promise.resolve()
    const ids = [...new Set(studentIds)]
    const epoch = this.epoch
    const operation: MarkOperation<Status> = { studentIds: ids, status, committedAt: null }
    const dependencies = [...new Set(ids.map(id => this.tails.get(id)).filter(Boolean))]
    this.operations.push(operation)
    this.version++
    this.publish()
    const isCurrent = () => this.active && this.epoch === epoch
    const commit = (savedIds: string[]) => {
      if (!isCurrent()) return
      const saved = new Set(savedIds)
      const index = this.operations.indexOf(operation)
      if (index === -1) return
      const committedIds = operation.studentIds.filter(id => saved.has(id))
      operation.studentIds = operation.studentIds.filter(id => !saved.has(id))
      if (committedIds.length) {
        // The new committed value supersedes earlier receipts for these rows.
        // Keep the ledger bounded even when a background read is unavailable.
        this.operations.forEach(op => {
          if (op.committedAt !== null) op.studentIds = op.studentIds.filter(id => !saved.has(id))
        })
        this.operations.splice(index, 0, {
          studentIds: committedIds, status, committedAt: ++this.version,
        })
      }
      this.publish()
    }
    const command = Promise.resolve().then(async () => {
      await Promise.all(dependencies)
      if (!isCurrent()) return
      try {
        commit(await write(ids, commit))
      } finally {
        if (isCurrent()) {
          this.operations = this.operations.filter(op => op !== operation && op.studentIds.length > 0)
          this.version++
          this.publish()
        }
      }
    })
    // A failed write must not poison a later correction for the same student.
    const settled = command.catch(() => {}).finally(() => {
      if (!isCurrent()) return
      ids.forEach(id => { if (this.tails.get(id) === settled) this.tails.delete(id) })
    })
    ids.forEach(id => this.tails.set(id, settled))
    return command
  }
}
