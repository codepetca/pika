import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
const migration='supabase/migrations/277_contextual_classroom_owner_list_reorder.sql'
describe('classroom list reorder source contracts (not PostgreSQL execution)',()=>{
 it('is one bounded service-only atomic definer with strict array/actor checks',()=>{
  const sql=readFileSync(migration,'utf8')
  expect(sql.match(/create function /gi)).toHaveLength(1)
  for(const token of ['p_actor_id uuid,p_classroom_ids uuid[]','security definer',"set search_path = ''","set lock_timeout = '1s'","set statement_timeout = '8s'",'cardinality(p_classroom_ids)>4096','array_ndims','array_lower','id is null','count(distinct id)','from public,anon,authenticated','to service_role'])expect(sql).toContain(token)
  expect(sql.indexOf('u.id=p_actor_id')).toBeLessThan(sql.indexOf('perform public.lock_effective_feature_entitlement_v1'))
  expect(sql).not.toMatch(/assert_classroom_creation_allowed|set_effective_feature_entitlement|role\s*=\s*'teacher'|\blimit\s+1000/i)
 })
 it('uses subject→sorted owned operations→NOWAIT class/revision rows, then complete-set recheck and effects',()=>{
  const sql=readFileSync(migration,'utf8')
  const subject=sql.indexOf('perform public.lock_effective_feature_entitlement_v1'),operation=sql.indexOf('if not public.classroom_purge_try_lock'),row=sql.indexOf('where c.id=v_id for update nowait'),revision=sql.indexOf('where r.classroom_id=v_id for update nowait'),recheck=sql.indexOf('if v_current is distinct from v_ids'),update=sql.indexOf('update public.classrooms c set')
  expect(subject).toBeLessThan(operation);expect(operation).toBeLessThan(row);expect(row).toBeLessThan(revision);expect(revision).toBeLessThan(recheck);expect(recheck).toBeLessThan(update)
  for(const token of ['array_agg(c.id order by c.id)','v_count<>cardinality(v_ids)','v_actual is distinct from v_expected_rows','v_actual is distinct from v_expected_revisions',"'revision',r.revision+1",'transaction_timestamp()','guard_classroom_purge_lifecycle','cold_classroom_purge_fences','pika.identity_mapping','pika.student_purge_finalize'])expect(sql).toContain(token)
 })
 it('retains genuine timestamp/archive revision and position-only Blueprint semantics from predecessors',()=>{
  expect(readFileSync('supabase/migrations/006_create_classrooms.sql','utf8')).toContain('BEFORE UPDATE ON classrooms')
  expect(readFileSync('supabase/migrations/095_scope_classroom_archive_restore_context.sql','utf8')).toContain('set revision = revision + 1, updated_at = now()')
  const source=readFileSync('supabase/migrations/112_versioned_course_blueprint_identity.sql','utf8').split('create or replace function public.bump_classroom_blueprint_source_revision()')[1].split('$$;')[0]
  expect(source).toContain('new.course_overview_markdown is distinct from old.course_overview_markdown');expect(source).not.toContain('position')
 })
 it('rollback source exercises real service RPC,1001classes, denied/midbatch/fence/repeated semantics and complete graph equality',()=>{
  const sql=readFileSync('scripts/check-contextual-classroom-list-reorder.sql','utf8')
  for(const token of ["current_user<>'service_role'",'public.reorder_classrooms_for_owner_v1','generate_series(1,1001)','<>1001','generate_series(1,4097)','array[[x,y]]','pg_catalog.pg_my_temp_schema()','pg_catalog.aclexplode','List reorder whole public/private graph differs','savepoint midbatch_failure','synthetic_list_midbatch_failure','savepoint postcondition_failure','savepoint stale_set','savepoint hot_fence','enabled=false,quota_limit=0','rollback to fixture','automatic Free/Pal/full graph rollback differs'])expect(sql).toContain(token)
  expect(sql).not.toContain('grant usage on schema pg_temp to service_role')
  expect(sql).toMatch(/rollback;\s*select pg_catalog.json_build_object[\s\S]*classroom-list-reorder-rollback-contract-v1/)
 })
})
