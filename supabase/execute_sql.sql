-- Read-only SQL executor for Phase 2.
-- This function accepts a SQL string and executes it if it is a SELECT.

create or replace function public.execute_sql(sql text)
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
begin
  if sql is null or length(trim(sql)) = 0 then
    raise exception 'SQL is required';
  end if;

  sql := regexp_replace(sql, ';\s*$', '');

  if lower(ltrim(sql)) not like 'select %' then
    raise exception 'Only SELECT statements are allowed';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', sql)
    into result;

  return result;
end;
$$;

revoke all on function public.execute_sql(text) from public;

grant execute on function public.execute_sql(text) to anon, authenticated;
