-- Add raster image references without weakening the existing private bucket,
-- file-size ceiling, or document MIME allowlist. SVG remains intentionally absent.
update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then null
  else (
    select array_agg(distinct mime_type order by mime_type)
    from unnest(allowed_mime_types || array['image/png', 'image/jpeg']) as mime_type
  )
end
where id = 'test-documents';
