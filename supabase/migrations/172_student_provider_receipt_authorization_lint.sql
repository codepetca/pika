-- Preserve the receipt authorization call without storing its unused return value.
-- Forward-only correction; no data, gate, receipt, or signature changes.
begin;
set local lock_timeout = '5s';

create or replace function public.record_student_provider_cleanup_receipt(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,
  p_provider text,p_receipt jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_binding private.student_provider_cleanup_bindings; v_keys text[];
begin
  perform public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id for update;
  if jsonb_typeof(p_receipt) is distinct from 'object' then
    raise exception using errcode='22023',message='student_provider_receipt_invalid';
  end if;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(p_receipt) key;
  if p_provider='pal' then
    if v_keys is distinct from array['begun_at','completed_at','learner_id','operation_id','schema_version','status']
      or p_receipt->'schema_version' is distinct from '1'::jsonb
      or p_receipt->>'operation_id' is distinct from p_operation_id::text
      or p_receipt->>'learner_id' is distinct from v_binding.pal_reference
      or coalesce(p_receipt->>'status','') not in ('pending','completed')
      or jsonb_typeof(p_receipt->'begun_at') is distinct from 'string'
      or p_receipt->>'begun_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$'
      or (p_receipt->>'status'='pending' and p_receipt->'completed_at' is distinct from 'null'::jsonb)
      or (p_receipt->>'status'='completed' and (jsonb_typeof(p_receipt->'completed_at') is distinct from 'string'
        or p_receipt->>'completed_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$'
        or (p_receipt->>'completed_at')::timestamptz < (p_receipt->>'begun_at')::timestamptz)) then
      raise exception using errcode='22023',message='student_provider_receipt_invalid';
    end if;
    perform (p_receipt->>'begun_at')::timestamptz;
    update private.student_provider_cleanup_bindings set pal_receipt=p_receipt where operation_id=p_operation_id;
  elsif p_provider='bara' then
    if v_keys is distinct from array['absence_verified','deleted_count','installation_ref','ok','operation_ref','participant_ref','roster_ref','schema_version','state']
      or p_receipt->'schema_version' is distinct from '1'::jsonb or p_receipt->'ok' is distinct from 'true'::jsonb
      or p_receipt->>'installation_ref' is distinct from v_binding.installation_ref
      or p_receipt->>'roster_ref' is distinct from v_binding.roster_ref
      or p_receipt->>'participant_ref' is distinct from v_binding.participant_ref
      or p_receipt->>'operation_ref' is distinct from 'erase_participant_'||replace(p_operation_id::text,'-','')
      or coalesce(p_receipt->>'state','') not in ('deleting','blocked','deleted')
      or p_receipt->'absence_verified' is distinct from to_jsonb(p_receipt->>'state'='deleted')
      or jsonb_typeof(p_receipt->'deleted_count') is distinct from 'number'
      or p_receipt->>'deleted_count' !~ '^[0-9]+$'
      or (p_receipt->>'deleted_count')::numeric > 9007199254740991 then
      raise exception using errcode='22023',message='student_provider_receipt_invalid';
    end if;
    update private.student_provider_cleanup_bindings set bara_receipt=p_receipt where operation_id=p_operation_id;
  else
    raise exception using errcode='22023',message='student_provider_unknown';
  end if;
  -- Receipts never invoke finalization, erase mappings, clear fences, or rotate.
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;

commit;
