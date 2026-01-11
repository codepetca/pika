-- Add rich_instructions column for TiptapContent (JSONB)
-- Keeps existing description column for backwards compatibility

ALTER TABLE public.assignments
ADD COLUMN rich_instructions jsonb;

-- Migrate existing plain text descriptions to rich format
UPDATE public.assignments
SET rich_instructions = jsonb_build_object(
  'type', 'doc',
  'content', CASE
    WHEN description = '' OR description IS NULL THEN '[]'::jsonb
    ELSE jsonb_build_array(
      jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', description)
        )
      )
    )
  END
)
WHERE rich_instructions IS NULL;

-- Index for querying assignments with instructions
CREATE INDEX idx_assignments_rich_instructions
ON public.assignments ((rich_instructions IS NOT NULL));

COMMENT ON COLUMN public.assignments.rich_instructions IS 'TiptapContent JSON for rich text instructions';
