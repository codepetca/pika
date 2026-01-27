-- Migration: Rename classroom_materials to classroom_resources
-- Purpose: Better naming - "Resources" is clearer than "Materials"

ALTER TABLE classroom_materials RENAME TO classroom_resources;
ALTER INDEX classroom_materials_classroom_id_idx RENAME TO classroom_resources_classroom_id_idx;
