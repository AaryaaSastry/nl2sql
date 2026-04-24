-- Read-only SQL executor for Universal DB MCP.
-- This function accepts a SQL string and executes it if it is a SELECT statement.

CREATE OR REPLACE FUNCTION public.execute_sql(sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  IF sql IS NULL OR length(trim(sql)) = 0 THEN
    RAISE EXCEPTION 'SQL is required';
  END IF;

  -- Security: Basic check to ensure only SELECT statements are run
  IF lower(ltrim(sql)) NOT LIKE 'select %' THEN
    RAISE EXCEPTION 'Only SELECT statements are allowed';
  END IF;

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', sql)
    INTO result;

  RETURN result;
END;
$$;

-- Permissions management
REVOKE ALL ON FUNCTION public.execute_sql(text) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_sql(text) TO anon, authenticated, service_role;
