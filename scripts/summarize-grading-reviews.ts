import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  gradingReviewSnapshotSchema,
  summarizeGradingReviews,
} from '@/lib/grading/evals'

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    throw new Error('Usage: pnpm eval:grading-reviews <identity-free-reviews.json>')
  }

  const payload = JSON.parse(readFileSync(resolve(process.cwd(), inputPath), 'utf8'))
  if (!Array.isArray(payload)) {
    throw new Error('Grading review input must be a JSON array')
  }

  const reviews = payload.map((value, index) => {
    const parsed = gradingReviewSnapshotSchema.safeParse(value)
    if (!parsed.success) {
      throw new Error(`Invalid grading review at index ${index}: ${parsed.error.message}`)
    }
    return parsed.data
  })

  console.log(JSON.stringify(summarizeGradingReviews(reviews), null, 2))
}

main()
