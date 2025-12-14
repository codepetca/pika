import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateDailyLogSummary, hashDailyLogText } from '@/lib/daily-log-summaries'

describe('daily log summaries', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  describe('hashDailyLogText', () => {
    it('should hash deterministically', () => {
      expect(hashDailyLogText('hello')).toBe(hashDailyLogText('hello'))
      expect(hashDailyLogText('hello')).not.toBe(hashDailyLogText('hello!'))
    })
  })

  describe('generateDailyLogSummary', () => {
    it('should throw when OPENAI_API_KEY is missing', async () => {
      vi.stubEnv('OPENAI_API_KEY', '')
      await expect(generateDailyLogSummary('hello')).rejects.toThrow('OPENAI_API_KEY is not configured')
    })

    it('should accept output_text shape', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ output_text: 'One line summary.' }),
        } as any)
      )

      await expect(generateDailyLogSummary('hello')).resolves.toEqual(
        expect.objectContaining({ summary: 'One line summary.', model: expect.any(String) })
      )
    })

    it('should accept output[].content[].type=output_text shape', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            output: [
              { content: [{ type: 'output_text', text: 'Another summary.' }] },
            ],
          }),
        } as any)
      )

      const result = await generateDailyLogSummary('hello')
      expect(result.summary).toBe('Another summary.')
    })
  })
})

