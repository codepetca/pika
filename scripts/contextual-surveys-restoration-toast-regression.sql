-- Standalone, NOT wired into any runner. Execute only with separate approval
-- against an isolated disposable PostgreSQL instance, never shared/production.
-- No product tables/functions/triggers are touched. Outer ROLLBACK removes all
-- temporary state; expected RED failures use subtransactions. Not yet executed.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='8s';
set local lock_timeout='1s';
set local plpgsql.check_asserts=on;
do $regression$
declare
 expected jsonb;captured jsonb;changed jsonb;toast_oid oid;chunks bigint;
 state_hash bytea;catalog_hash bytea;mode text;red_seen boolean;negative_seen boolean:=false;
begin
 assert to_regclass('pg_temp.survey_toast_regression_baseline') is null,'Regression namespace occupied';
 select jsonb_build_object('rows',jsonb_agg(jsonb_build_object('id',n,'value',md5(n::text)) order by n),
  'catalog',jsonb_build_object('nested',jsonb_build_array(null,true,1.25,'漢字',jsonb_build_object('key','value'))))
 into expected from generate_series(1,8192) n;
 create temporary table survey_toast_regression_baseline(state jsonb not null) on commit drop;
 alter table survey_toast_regression_baseline alter column state set storage external;
 insert into survey_toast_regression_baseline values(expected);
 select reltoastrelid into strict toast_oid from pg_class where oid='pg_temp.survey_toast_regression_baseline'::regclass;
 assert toast_oid<>0,'Regression has no TOAST relation';
 execute format('select count(*) from %s',toast_oid::regclass) into chunks;
 assert chunks>1,'Regression did not force out-of-line TOAST storage';
 -- Prior successful reads do not guarantee that a table-sourced variable owns
 -- the datum. Test both cancellation comparison and wire receipt hashing.
 foreach mode in array array['comparison','hash'] loop
  red_seen:=false;
  begin
   select state into strict captured from survey_toast_regression_baseline;
   assert captured=expected,'Pre-DROP full equality differs';
   perform sha256(convert_to(captured::text,'UTF8'));
   drop table survey_toast_regression_baseline;
   if mode='comparison' then
    assert captured=expected,'Post-DROP full equality differs';
   else
    perform sha256(convert_to(captured::text,'UTF8'));
   end if;
   raise exception 'Expected old-path TOAST failure was not observed';
  exception when others then
   if sqlstate<>'XX000' or sqlerrm<>format('could not open relation with OID %s',toast_oid) then raise;end if;
   red_seen:=true;
  end;
  assert red_seen and to_regclass('pg_temp.survey_toast_regression_baseline') is not null,'RED subtransaction did not restore baseline';
 end loop;
 -- Same projection as both corrected production proof generators.
 select (state::text)::jsonb into strict captured from survey_toast_regression_baseline;
 assert captured=expected,'Materialization changed full JSONB';
 state_hash:=sha256(convert_to(captured::text,'UTF8'));
 catalog_hash:=sha256(convert_to((captured->'catalog')::text,'UTF8'));
 drop table survey_toast_regression_baseline;
 assert captured=expected,'Materialized full equality after DROP differs';
 assert sha256(convert_to(captured::text,'UTF8'))=state_hash,'Materialized state hash differs';
 assert sha256(convert_to((captured->'catalog')::text,'UTF8'))=catalog_hash,'Materialized catalog hash differs';
 assert to_regclass('pg_temp.survey_toast_regression_baseline') is null,'GREEN baseline remains';
 changed:=jsonb_set(expected,'{catalog,changed}','true'::jsonb);
 begin
  assert changed=captured,'Deliberate unrelated catalog difference';
 exception when assert_failure then negative_seen:=true;
 end;
 assert negative_seen,'Full equality failed to reject changed catalog';
 raise notice 'Survey restoration TOAST RED comparison/hash and GREEN equality/hash checks passed';
end;$regression$;
rollback;
