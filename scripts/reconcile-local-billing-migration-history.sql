-- One-time LOCAL metadata reconciliation. Never runs migration bodies or touches
-- application data. Applying this requires separate exact owner authorization.
-- The shell wrapper defaults to a read-only preview; it supplies apply_approved.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table supabase_migrations.schema_migrations in exclusive mode;
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations)<>216
    or exists(select 1 from generate_series(1,216) n
      where not exists(select 1 from supabase_migrations.schema_migrations where version=lpad(n::text,3,'0')))
    or (select count(*) from supabase_migrations.schema_migrations where
      (version='214' and name='subscription_lifecycle' and md5(statements::text)='3b3053c1892f04a27653940345bcd49f')
      or (version='215' and name='subscription_lifecycle_validation' and md5(statements::text)='faed114e14a45d71eafcc3f549e3db0d')
      or (version='216' and name='subscription_lifecycle_warning_cleanup' and md5(statements::text)='722eac07ff15fa9d36db0001eadb3576'))<>3 then
    raise exception 'Local migration history differs from the reviewed collision state; stopping';
  end if;
  raise notice 'Verified exact local billing history: proposed version moves 214->215, 215->216, 216->217';
end $$;
\if :apply_approved
-- Descending updates avoid primary-key collisions. Names, recorded statements
-- and all other metadata columns remain intact in the same transaction.
update supabase_migrations.schema_migrations set version='217' where version='216';
update supabase_migrations.schema_migrations set version='216' where version='215';
update supabase_migrations.schema_migrations set version='215' where version='214';
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations)<>216
    or exists(select 1 from supabase_migrations.schema_migrations where version='214')
    or (select count(*) from supabase_migrations.schema_migrations where
      (version='215' and name='subscription_lifecycle' and md5(statements::text)='3b3053c1892f04a27653940345bcd49f')
      or (version='216' and name='subscription_lifecycle_validation' and md5(statements::text)='faed114e14a45d71eafcc3f549e3db0d')
      or (version='217' and name='subscription_lifecycle_warning_cleanup' and md5(statements::text)='722eac07ff15fa9d36db0001eadb3576'))<>3 then
    raise exception 'History reconciliation failed its preservation checks';
  end if;
end $$;
commit;
\else
rollback;
\endif
