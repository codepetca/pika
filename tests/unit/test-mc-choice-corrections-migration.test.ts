import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/219_allow_started_test_mc_choice_text.sql', 'utf8')

describe('migration 219 post-start MC choice corrections', () => {
  it('retains the locked-question guard while allowing only same-count MC option text updates', () => {
    expect(sql).toContain('create or replace function public.lock_test_parent_for_child_mutation()')
    expect(sql).toContain("array['question_text', 'options', 'updated_at'")
    expect(sql).toContain("old.question_type = 'multiple_choice'")
    expect(sql).toContain("new.question_type = 'multiple_choice'")
    expect(sql).toContain('jsonb_array_length(new.options) = jsonb_array_length(old.options)')
    expect(sql).toContain('new.options is not distinct from old.options')
    expect(sql).toContain('test.questions_locked_at is not null')
    expect(sql).toContain('for update;')
  })
})
