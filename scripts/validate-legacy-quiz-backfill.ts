import { canonicalJsonStringify } from '@/lib/server/classroom-archive-canonical'
import { adaptLegacyQuizArchiveResources } from '@/lib/server/classroom-archive-quiz-retirement'

type Input = {
  classroomId: string
  archiveActors: Array<{ id: string }>
  resources: Record<string, Array<Record<string, unknown>>>
  envelopeRecords: Array<Record<string, unknown>>
  envelopeActors: Array<Record<string, unknown>>
}

async function readInput(): Promise<Input> {
  let input = ''
  for await (const chunk of process.stdin) input += String(chunk)
  return JSON.parse(input) as Input
}

async function main() {
  const input = await readInput()
  const expected = adaptLegacyQuizArchiveResources({
    classroomId: input.classroomId,
    resources: input.resources,
    actors: input.archiveActors,
  })

  if (
    canonicalJsonStringify(expected.records) !==
    canonicalJsonStringify(input.envelopeRecords)
  ) {
    throw new Error('Database backfill records differ from the TypeScript adapter')
  }
  if (
    canonicalJsonStringify(expected.actors) !==
    canonicalJsonStringify(input.envelopeActors)
  ) {
    throw new Error('Database backfill actors differ from the TypeScript adapter')
  }

  process.stdout.write('Legacy Quiz database backfill matches the TypeScript adapter.\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
