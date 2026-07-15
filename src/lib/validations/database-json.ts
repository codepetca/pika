import { z } from 'zod'
import type { Json } from '@/types/database.generated'

const databaseJsonSchema = z.json()

export function parseDatabaseJson(value: unknown): Json {
  return databaseJsonSchema.parse(value)
}
