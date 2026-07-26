import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'

export type CourseBlueprintProposalSource =
  | 'classroom'
  | 'package'
  | 'repository'
  | 'ai'
  | 'blueprint'

type ArtifactCollection =
  | 'assignments'
  | 'assessments'
  | 'lesson_templates'
  | 'materials'
  | 'surveys'
type SnapshotArtifact = CourseBlueprintSnapshot[ArtifactCollection][number]
type SingletonKey = 'metadata' | 'sections' | 'grading' | 'planned_site'

export type CourseBlueprintChangeOperation =
  | {
      action: 'singleton'
      key: SingletonKey
      before: CourseBlueprintSnapshot[SingletonKey]
      after: CourseBlueprintSnapshot[SingletonKey]
    }
  | {
      action: 'add'
      collection: ArtifactCollection
      artifact_id: string
      after: SnapshotArtifact
    }
  | {
      action: 'update'
      collection: ArtifactCollection
      artifact_id: string
      before: SnapshotArtifact
      after: SnapshotArtifact
    }
  | {
      action: 'move'
      collection: ArtifactCollection
      artifact_id: string
      from_position: number
      to_position: number
    }
  | {
      action: 'archive'
      collection: ArtifactCollection
      artifact_id: string
      before: SnapshotArtifact
    }

export type CourseBlueprintChangeProposal = {
  id: string
  blueprint_id: string
  source: CourseBlueprintProposalSource
  base_draft_revision: number
  status: 'needs_review'
  operations: CourseBlueprintChangeOperation[]
  summary: {
    add: number
    update: number
    move: number
    archive: number
    singleton: number
  }
}

export class StaleCourseBlueprintProposalError extends Error {
  constructor(expected: number, actual: number) {
    super(`Blueprint Draft revision changed from ${expected} to ${actual}`)
    this.name = 'StaleCourseBlueprintProposalError'
  }
}

function comparableArtifact(artifact: SnapshotArtifact) {
  const { position: _position, ...content } = artifact
  return content
}

function isEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function diffArtifacts(
  base: CourseBlueprintSnapshot,
  candidate: CourseBlueprintSnapshot,
  collection: ArtifactCollection
): CourseBlueprintChangeOperation[] {
  const operations: CourseBlueprintChangeOperation[] = []
  const baseById = new Map(
    base[collection].map((artifact) => [artifact.artifact_id, artifact])
  )
  const candidateById = new Map(
    candidate[collection].map((artifact) => [artifact.artifact_id, artifact])
  )

  candidateById.forEach((after, artifactId) => {
    const before = baseById.get(artifactId)
    if (!before) {
      operations.push({
        action: 'add',
        collection,
        artifact_id: artifactId,
        after,
      })
      return
    }
    if (!isEqual(comparableArtifact(before), comparableArtifact(after))) {
      operations.push({
        action: 'update',
        collection,
        artifact_id: artifactId,
        before,
        after,
      })
    }
    if (before.position !== after.position) {
      operations.push({
        action: 'move',
        collection,
        artifact_id: artifactId,
        from_position: before.position,
        to_position: after.position,
      })
    }
  })

  baseById.forEach((before, artifactId) => {
    if (!candidateById.has(artifactId)) {
      operations.push({
        action: 'archive',
        collection,
        artifact_id: artifactId,
        before,
      })
    }
  })

  return operations
}

export function buildCourseBlueprintChangeProposal(
  base: CourseBlueprintSnapshot,
  candidate: CourseBlueprintSnapshot,
  source: CourseBlueprintProposalSource
): CourseBlueprintChangeProposal {
  if (base.blueprint_id !== candidate.blueprint_id) {
    throw new Error('A proposal cannot change Blueprint lineage')
  }

  const operations: CourseBlueprintChangeOperation[] = []
  const singletonKeys: SingletonKey[] = ['metadata', 'sections', 'grading', 'planned_site']
  singletonKeys.forEach((key) => {
    if (!isEqual(base[key], candidate[key])) {
      operations.push({
        action: 'singleton',
        key,
        before: base[key],
        after: candidate[key],
      })
    }
  })
  ;(['assignments', 'assessments', 'lesson_templates', 'materials', 'surveys'] as const).forEach(
    (collection) => operations.push(...diffArtifacts(base, candidate, collection))
  )

  return {
    id: crypto.randomUUID(),
    blueprint_id: base.blueprint_id,
    source,
    base_draft_revision: base.draft_revision,
    status: 'needs_review',
    operations,
    summary: {
      add: operations.filter((operation) => operation.action === 'add').length,
      update: operations.filter((operation) => operation.action === 'update').length,
      move: operations.filter((operation) => operation.action === 'move').length,
      archive: operations.filter((operation) => operation.action === 'archive').length,
      singleton: operations.filter((operation) => operation.action === 'singleton').length,
    },
  }
}

function findArtifactIndex(
  snapshot: CourseBlueprintSnapshot,
  collection: ArtifactCollection,
  artifactId: string
) {
  return snapshot[collection].findIndex((artifact) => artifact.artifact_id === artifactId)
}

export function applyCourseBlueprintChangeProposal(
  current: CourseBlueprintSnapshot,
  proposal: CourseBlueprintChangeProposal
): CourseBlueprintSnapshot {
  if (proposal.blueprint_id !== current.blueprint_id) {
    throw new Error('Proposal targets a different Blueprint')
  }
  if (proposal.base_draft_revision !== current.draft_revision) {
    throw new StaleCourseBlueprintProposalError(
      proposal.base_draft_revision,
      current.draft_revision
    )
  }

  const next = structuredClone(current)
  proposal.operations.forEach((operation) => {
    if (operation.action === 'singleton') {
      if (!isEqual(next[operation.key], operation.before)) {
        throw new Error(`Proposal conflict in ${operation.key}`)
      }
      Object.assign(next[operation.key], structuredClone(operation.after))
      return
    }

    const index = findArtifactIndex(next, operation.collection, operation.artifact_id)
    if (operation.action === 'add') {
      if (index >= 0) throw new Error(`Artifact ${operation.artifact_id} already exists`)
      next[operation.collection].push(structuredClone(operation.after) as never)
      return
    }
    if (index < 0) throw new Error(`Artifact ${operation.artifact_id} no longer exists`)

    if (operation.action === 'archive') {
      if (!isEqual(next[operation.collection][index], operation.before)) {
        throw new Error(`Artifact ${operation.artifact_id} changed`)
      }
      next[operation.collection].splice(index, 1)
      return
    }
    if (operation.action === 'update') {
      if (!isEqual(next[operation.collection][index], operation.before)) {
        throw new Error(`Artifact ${operation.artifact_id} changed`)
      }
      next[operation.collection][index] = structuredClone(operation.after) as never
      return
    }
    next[operation.collection][index].position = operation.to_position
  })

  next.assignments.sort((left, right) => left.position - right.position)
  next.assessments.sort((left, right) => left.position - right.position)
  next.lesson_templates.sort((left, right) => left.position - right.position)
  next.materials.sort((left, right) => left.position - right.position)
  next.surveys.sort((left, right) => left.position - right.position)
  next.draft_revision += 1
  return next
}
