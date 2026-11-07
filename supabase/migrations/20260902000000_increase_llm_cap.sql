-- Increase LLM token daily cap for development and production workloads
create or replace function public.consume_llm_tokens(_tokens integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_current int;
  v_cap constant int := 10000000; -- 10 million tokens daily cap
  v_marca text;
  v_job_id uuid;
  v_job public.jobs%rowtype;
  v_hoje date := public.ai_today();
begin
  if auth.uid() is null then
    return false;
  end if;
  if _tokens is null or _tokens <= 0 or _tokens > 1000000 then
    raise exception 'invalid token count';
  end if;

  -- A marca `app.automation_job` é colocada pela ponte, dentro da transação de
  -- cada consulta da automação. Ela só vale se apontar pra um trabalho DE
  -- VERDADE, RODANDO, cujo dono é EXATAMENTE quem está pedindo.
  v_marca := nullif(current_setting('app.automation_job', true), '');
  if v_marca is not null then
    begin
      v_job_id := v_marca::uuid;
    exception when others then
      v_job_id := null;
    end;
  end if;

  if v_job_id is not null then
    select * into v_job from public.jobs where id = v_job_id;
    if found and v_job.status = 'running' and v_job.run_as = auth.uid() then
      insert into public.automation_usage (organization_id, day, tokens_used)
      values (v_job.organization_id, v_hoje, _tokens)
      on conflict (organization_id, day) do update
        set tokens_used = automation_usage.tokens_used + excluded.tokens_used
      returning tokens_used into v_current;
      return v_current <= public.automation_daily_cap();
    end if;
  end if;

  insert into public.llm_usage (user_id, day, tokens_used)
  values (auth.uid(), v_hoje, _tokens)
  on conflict (user_id, day) do update
    set tokens_used = llm_usage.tokens_used + excluded.tokens_used
  returning tokens_used into v_current;

  return v_current <= v_cap;
end;
$$;

revoke execute on function public.consume_llm_tokens(integer) from public, anon;
grant execute on function public.consume_llm_tokens(integer) to authenticated;
