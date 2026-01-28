-- Migration: classroom_materials table
-- Purpose: Wiki-style static content per classroom

CREATE TABLE classroom_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  content JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(classroom_id)
);

CREATE INDEX classroom_materials_classroom_id_idx ON classroom_materials(classroom_id);
