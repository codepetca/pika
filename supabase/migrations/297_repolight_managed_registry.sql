-- Source only. Depends on296; no rollout activation or shared-DB application.
begin;
create table private.repolight_managed_connections (
 operation_ref uuid primary key,teacher_id uuid not null,
 tenant_ref text not null check(tenant_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 key_id uuid not null unique,
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 connection_ref text not null unique check(connection_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 api_origin text not null check(octet_length(api_origin)<=2048),
 installation_ref text not null check(installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 encrypted_key jsonb not null check(jsonb_typeof(encrypted_key)='object' and octet_length(encrypted_key::text)<=2048),
 operation_kind text not null check(operation_kind in('provision','rotate')),expected_key_id uuid,
 state text not null default 'pending' check(state in('pending','ready','retired')),
 workspace_ref text check(workspace_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
 created_at timestamptz not null default clock_timestamp(),ready_at timestamptz,
 check((operation_kind='rotate')=(expected_key_id is not null)),
 check(operation_kind<>'rotate' or workspace_ref is not null),
 check(state<>'pending' or operation_kind='rotate' or workspace_ref is null),
 check((state='pending' and ready_at is null) or (state in('ready','retired') and workspace_ref is not null and ready_at is not null))
);
-- No FK cascade: retained cleanup credentials survive account removal.
create unique index repolight_managed_one_ready on private.repolight_managed_connections(teacher_id) where state='ready';
create unique index repolight_managed_one_pending on private.repolight_managed_connections(teacher_id) where state='pending';
alter table private.repolight_managed_connections enable row level security;
revoke all on private.repolight_managed_connections from public,anon,authenticated,service_role;

create function private.repolight_managed_json_v1(p_row private.repolight_managed_connections)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('teacherId',p_row.teacher_id,'tenantRef',p_row.tenant_ref,
 'operationRef',p_row.operation_ref,'keyId',p_row.key_id,'secretHash',p_row.secret_hash,
 'connectionRef',p_row.connection_ref,'apiOrigin',p_row.api_origin,'installationRef',p_row.installation_ref,
 'encryptedKey',p_row.encrypted_key,'operationKind',p_row.operation_kind,'expectedKeyId',p_row.expected_key_id,'state',p_row.state,'workspaceRef',p_row.workspace_ref)
$$;
revoke all on function private.repolight_managed_json_v1(private.repolight_managed_connections) from public,anon,authenticated,service_role;

create function private.validate_repolight_managed_candidate_v1(p_teacher_id uuid,p_candidate jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if p_teacher_id is null or p_candidate is null or jsonb_typeof(p_candidate)<>'object'
 or p_candidate->>'teacherId' is distinct from p_teacher_id::text or p_candidate->>'state' is distinct from 'pending'
 or (select count(*) from jsonb_object_keys(p_candidate))<>13
 or not(p_candidate ?& array['teacherId','tenantRef','operationRef','keyId','secretHash','connectionRef','apiOrigin','installationRef','encryptedKey','operationKind','expectedKeyId','state','workspaceRef'])
 or jsonb_typeof(p_candidate->'encryptedKey') is distinct from 'object'
 then raise exception using errcode='22023',message='repolight_managed_invalid_storage';end if;
end $$;
revoke all on function private.validate_repolight_managed_candidate_v1(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.insert_repolight_managed_candidate_v1(p_teacher_id uuid,p_candidate jsonb)
returns private.repolight_managed_connections language sql set search_path='' as $$
 insert into private.repolight_managed_connections(teacher_id,tenant_ref,operation_ref,key_id,secret_hash,connection_ref,api_origin,installation_ref,encrypted_key,operation_kind,expected_key_id,workspace_ref)
 values(p_teacher_id,p_candidate->>'tenantRef',(p_candidate->>'operationRef')::uuid,(p_candidate->>'keyId')::uuid,p_candidate->>'secretHash',p_candidate->>'connectionRef',p_candidate->>'apiOrigin',p_candidate->>'installationRef',p_candidate->'encryptedKey',p_candidate->>'operationKind',(p_candidate->>'expectedKeyId')::uuid,p_candidate->>'workspaceRef') returning *
$$;
revoke all on function private.insert_repolight_managed_candidate_v1(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.read_repolight_managed_connection_v1(p_teacher_id uuid,p_connection_ref text default null)
returns jsonb language sql security definer set search_path='' as $$
 select private.repolight_managed_json_v1(r) from private.repolight_managed_connections r
 where r.teacher_id=p_teacher_id and (p_connection_ref is null and r.state in('pending','ready') or r.connection_ref=p_connection_ref)
 order by (r.state='pending') desc,r.created_at desc limit 1
$$;
revoke all on function public.read_repolight_managed_connection_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.read_repolight_managed_connection_v1(uuid,text) to service_role;

create function public.prepare_repolight_managed_connection_v1(p_teacher_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.repolight_managed_connections; access jsonb;
begin
 -- Lock order: settings -> account-plan-subject -> effective-feature -> owner.
 access:=public.get_repolight_analysis_access_v1(p_teacher_id);
 if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 perform pg_advisory_xact_lock(hashtextextended('repolight-managed-owner:'||p_teacher_id::text,297));
 access:=public.get_repolight_analysis_access_v1(p_teacher_id);
 if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 select * into r from private.repolight_managed_connections where teacher_id=p_teacher_id and state in('pending','ready') order by (state='pending') desc limit 1 for update;
 if found then return private.repolight_managed_json_v1(r);end if;
 perform private.validate_repolight_managed_candidate_v1(p_teacher_id,p_candidate);
 if p_candidate->>'operationKind' is distinct from 'provision' or p_candidate->'workspaceRef' is distinct from 'null'::jsonb or p_candidate->'expectedKeyId' is distinct from 'null'::jsonb
 then raise exception using errcode='22023',message='repolight_managed_invalid_storage';end if;
 perform pg_advisory_xact_lock(hashtextextended('repolight-managed-tenant:'||(p_candidate->>'tenantRef'),297));
 if exists(select 1 from private.repolight_managed_connections where tenant_ref=p_candidate->>'tenantRef' and teacher_id<>p_teacher_id)
 then raise exception using errcode='22023',message='repolight_managed_tenant_conflict';end if;
 access:=public.get_repolight_analysis_access_v1(p_teacher_id);
 if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 r:=private.insert_repolight_managed_candidate_v1(p_teacher_id,p_candidate);
 return private.repolight_managed_json_v1(r);
end $$;
revoke all on function public.prepare_repolight_managed_connection_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_repolight_managed_connection_v1(uuid,jsonb) to service_role;

create function public.prepare_repolight_managed_rotation_v1(p_teacher_id uuid,p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.repolight_managed_connections;
begin
 -- Credential recovery authorizes no analysis. Service caller must authorize
 -- owner maintenance before calling; expired accounts can recover erasure.
 perform pg_advisory_xact_lock(hashtextextended('repolight-managed-owner:'||p_teacher_id::text,297));
 select * into r from private.repolight_managed_connections where teacher_id=p_teacher_id and state='pending' for update;
 if found then return private.repolight_managed_json_v1(r);end if;
 select * into r from private.repolight_managed_connections where teacher_id=p_teacher_id and state='ready' for update;
 if not found then raise exception using errcode='P0002',message='repolight_managed_missing';end if;
 perform private.validate_repolight_managed_candidate_v1(p_teacher_id,p_candidate);
 if p_candidate->>'operationKind' is distinct from 'rotate' or p_candidate->>'expectedKeyId' is distinct from r.key_id::text
 or p_candidate->>'tenantRef' is distinct from r.tenant_ref or p_candidate->>'workspaceRef' is distinct from r.workspace_ref
 or p_candidate->>'apiOrigin' is distinct from r.api_origin or p_candidate->>'installationRef' is distinct from r.installation_ref
 then raise exception using errcode='22023',message='repolight_managed_binding_mismatch';end if;
 r:=private.insert_repolight_managed_candidate_v1(p_teacher_id,p_candidate);
 return private.repolight_managed_json_v1(r);
end $$;
revoke all on function public.prepare_repolight_managed_rotation_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_repolight_managed_rotation_v1(uuid,jsonb) to service_role;

create function public.activate_repolight_managed_connection_v1(p_teacher_id uuid,p_expected jsonb,p_workspace_ref text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.repolight_managed_connections; access jsonb; expected jsonb;
begin
 -- Provision locks entitlements before owner locks. Rotation only locks owner;
 -- it grants no analysis permission and never changes plan state.
 if p_expected->>'operationKind'='provision' then
  access:=public.get_repolight_analysis_access_v1(p_teacher_id);
  if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('repolight-managed-owner:'||p_teacher_id::text,297));
 select * into r from private.repolight_managed_connections where teacher_id=p_teacher_id and operation_ref=(p_expected->>'operationRef')::uuid for update;
 if not found or r.state='retired' then raise exception using errcode='P0002',message='repolight_managed_missing';end if;
 expected:=private.repolight_managed_json_v1(r)||jsonb_build_object('state','pending','workspaceRef',case when r.operation_kind='rotate' then r.workspace_ref else null end);
 if p_expected is distinct from expected or p_workspace_ref is null or p_workspace_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
 or (r.workspace_ref is not null and r.workspace_ref is distinct from p_workspace_ref)
 then raise exception using errcode='22023',message='repolight_managed_binding_mismatch';end if;
 if r.operation_kind='provision' then
  access:=public.get_repolight_analysis_access_v1(p_teacher_id);
  if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 end if;
 -- Two teachers must never share a managed workspace, including retired keys.
 -- All activations take owner then workspace locks; no path locks another owner.
 perform pg_advisory_xact_lock(hashtextextended('repolight-managed-workspace:'||p_workspace_ref,297));
 if exists(select 1 from private.repolight_managed_connections where workspace_ref=p_workspace_ref and teacher_id<>p_teacher_id)
 then raise exception using errcode='22023',message='repolight_managed_workspace_conflict';end if;
 if r.operation_kind='provision' then
  access:=public.get_repolight_analysis_access_v1(p_teacher_id);
  if (access->>'allowed')::boolean is distinct from true then raise exception using errcode='42501',message='repolight_managed_ineligible';end if;
 end if;
 if r.state='pending' then
  if r.operation_kind='rotate' then
   update private.repolight_managed_connections set state='retired' where teacher_id=p_teacher_id and state='ready' and key_id=r.expected_key_id;
   if not found then raise exception using errcode='40001',message='repolight_managed_rotation_changed';end if;
  end if;
  update private.repolight_managed_connections set state='ready',workspace_ref=p_workspace_ref,ready_at=clock_timestamp() where operation_ref=r.operation_ref returning * into r;
 end if;
 return private.repolight_managed_json_v1(r);
end $$;
revoke all on function public.activate_repolight_managed_connection_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.activate_repolight_managed_connection_v1(uuid,jsonb,text) to service_role;
commit;
