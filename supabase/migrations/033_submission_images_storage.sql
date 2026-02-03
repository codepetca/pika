-- Create storage bucket for submission images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'submission-images',
  'submission-images',
  true,
  10485760,  -- 10MB limit
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload images
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'submission-images');

-- Allow public read access to uploaded images
CREATE POLICY "Allow public read access"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'submission-images');

-- Allow users to delete only their own uploads (files in their user ID folder)
CREATE POLICY "Allow owner deletes"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'submission-images' AND (storage.foldername(name))[1] = auth.uid()::text);
