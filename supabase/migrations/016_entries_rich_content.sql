-- Migration: Add rich_content JSONB column to entries table for TipTap rich text
-- Keeps text column for search/AI (extracted plain text)

-- STEP 1: Add new JSONB column
ALTER TABLE public.entries
  ADD COLUMN rich_content JSONB;

-- STEP 2: Set default for new entries
ALTER TABLE public.entries
  ALTER COLUMN rich_content SET DEFAULT '{"type":"doc","content":[]}'::jsonb;

-- STEP 3: Migrate existing plain text data to TipTap JSON format
-- Convert each line of text into a paragraph node
UPDATE public.entries
SET rich_content = CASE
  WHEN text IS NULL OR text = '' THEN '{"type":"doc","content":[]}'::jsonb
  ELSE jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'text',
            'text', text
          )
        )
      )
    )
  )
END
WHERE rich_content IS NULL;

-- STEP 4: Add comment for documentation
COMMENT ON COLUMN public.entries.rich_content IS 'TipTap JSON content for rich text editing. Plain text is extracted to the text column for search and AI features.';
