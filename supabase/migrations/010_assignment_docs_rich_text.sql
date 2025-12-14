-- Migration: Convert assignment_docs.content from TEXT to JSONB for Tiptap rich text
-- This enables structured rich text storage for assignment submissions

-- STEP 1: Add new JSONB column
ALTER TABLE public.assignment_docs
  ADD COLUMN content_rich jsonb;

-- STEP 2: Migrate existing plain text data to Tiptap JSON format
UPDATE public.assignment_docs
SET content_rich = CASE
  WHEN content IS NULL OR content = '' THEN '{"type":"doc","content":[]}'::jsonb
  ELSE jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'text',
            'text', content
          )
        )
      )
    )
  )
END;

-- STEP 3: Rename columns (swap old and new)
ALTER TABLE public.assignment_docs
  RENAME COLUMN content TO content_legacy;

ALTER TABLE public.assignment_docs
  RENAME COLUMN content_rich TO content;

-- STEP 4: Set default and constraints for new content column
ALTER TABLE public.assignment_docs
  ALTER COLUMN content SET DEFAULT '{"type":"doc","content":[]}'::jsonb;

ALTER TABLE public.assignment_docs
  ALTER COLUMN content SET NOT NULL;

-- STEP 5: Add GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_assignment_docs_content_gin
  ON public.assignment_docs USING gin(content);

-- STEP 6: Drop legacy column (optional - uncomment after verifying migration)
-- ALTER TABLE public.assignment_docs DROP COLUMN content_legacy;
