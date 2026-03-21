import { describe, expect, it } from 'vitest'
import {
  extractAssignmentArtifacts,
  summarizeArtifactUrl,
} from '@/lib/assignment-artifacts'
import type { TiptapContent } from '@/types'

describe('extractAssignmentArtifacts', () => {
  it('extracts links from link marks and plain text URLs', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Visit https://example.com/docs and also click here',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://github.com/codepetca/pika' },
                },
              ],
            },
          ],
        },
      ],
    }

    expect(extractAssignmentArtifacts(content)).toEqual([
      { type: 'link', url: 'https://example.com/docs' },
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
    ])
  })

  it('extracts image artifacts and deduplicates repeated URLs', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'https://cdn.example.com/submission-images/shot.png',
          },
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'https://cdn.example.com/submission-images/shot.png',
            },
          ],
        },
      ],
    }

    expect(extractAssignmentArtifacts(content)).toEqual([
      {
        type: 'image',
        url: 'https://cdn.example.com/submission-images/shot.png',
      },
    ])
  })

  it('ignores mailto and non-http urls', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Valid https://example.com bad ftp://example.com',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'mailto:teacher@example.com' },
                },
              ],
            },
          ],
        },
      ],
    }

    expect(extractAssignmentArtifacts(content)).toEqual([
      { type: 'link', url: 'https://example.com/' },
    ])
  })

  it('accepts legacy stringified JSON content', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'https://example.com/a' }],
        },
      ],
    })

    expect(extractAssignmentArtifacts(content)).toEqual([
      { type: 'link', url: 'https://example.com/a' },
    ])
  })

  it('classifies supported GitHub repo links as repo artifacts', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Repo https://github.com/codepetca/pika/issues/1 and root https://github.com/openai/openai-node.git',
            },
          ],
        },
      ],
    }

    expect(extractAssignmentArtifacts(content)).toEqual([
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika/issues/1',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
      {
        type: 'repo',
        url: 'https://github.com/openai/openai-node.git',
        repo_owner: 'openai',
        repo_name: 'openai-node',
        normalized_url: 'https://github.com/openai/openai-node',
      },
    ])
  })
})

describe('summarizeArtifactUrl', () => {
  it('returns host plus short path summary', () => {
    expect(
      summarizeArtifactUrl('https://www.github.com/codepetca/pika/issues/1')
    ).toBe('github.com/codepetca/pika')
  })
})
