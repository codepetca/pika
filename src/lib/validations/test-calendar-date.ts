import { z } from 'zod'

/** Classroom calendar metadata; never an availability or submission deadline. */
export const testCalendarDateSchema = z.iso.date().refine(value => !value.startsWith('0000-'), 'Test date must use a year from 0001 to 9999').nullable()
export const testCalendarDatePatchSchema = z.object({ test_date: testCalendarDateSchema }).strict()
