-- Legacy JSON snapshot retained as a one-time migration source and backup.
create table if not exists public.tracker_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

-- Small account-level settings; progress records live in the tables below.
create table if not exists public.tracker_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_day date not null default current_date,
  streak integer not null default 0 check (streak >= 0),
  last_completed_day date,
  routine_version integer not null default 5,
  reminders_sent text[] not null default '{}',
  alarms jsonb not null default '[]'::jsonb,
  distractions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tracker_goals (
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id text not null,
  title text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, goal_id)
);

create table if not exists public.tracker_routines (
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id text not null,
  schedule_type text not null check (schedule_type in ('weekday', 'weekend')),
  position integer not null default 0,
  start_time text not null,
  end_time text not null,
  label text not null,
  actions jsonb not null default '[]'::jsonb,
  primary key (user_id, schedule_type, routine_id)
);

create table if not exists public.tracker_daily_tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  task_date date not null,
  title text not null,
  done boolean not null default false,
  category text not null default 'goal',
  routine_id text,
  punishment text not null default '',
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, task_id)
);

create table if not exists public.tracker_backlog_tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id text not null,
  title text not null,
  due_date date,
  done boolean not null default false,
  category text not null default 'goal',
  routine_id text,
  punishment text not null default '',
  source_task_id text,
  carried_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (user_id, task_id)
);

create table if not exists public.tracker_behavior_rules (
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_id text not null,
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  primary key (user_id, rule_id)
);

create table if not exists public.tracker_daily_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  completed_tasks integer not null default 0,
  total_tasks integer not null default 0,
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  completed_rules integer not null default 0,
  total_rules integer not null default 0,
  completed_backlog integer not null default 0,
  total_backlog integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  primary key (user_id, activity_date)
);

create table if not exists public.tracker_activity_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  activity_date date not null,
  occurred_at timestamptz not null,
  kind text not null,
  title text not null,
  details text not null default '',
  primary key (user_id, event_id)
);

create index if not exists tracker_tasks_by_day on public.tracker_daily_tasks (user_id, task_date);
create index if not exists tracker_backlog_by_due_date on public.tracker_backlog_tasks (user_id, due_date);
create index if not exists tracker_history_by_date on public.tracker_daily_history (user_id, activity_date desc);
create index if not exists tracker_events_by_date on public.tracker_activity_events (user_id, activity_date desc, occurred_at desc);

-- Enable row-level security and grant only the authenticated app role access.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tracker_state', 'tracker_settings', 'tracker_goals', 'tracker_routines',
    'tracker_daily_tasks', 'tracker_backlog_tasks', 'tracker_behavior_rules',
    'tracker_daily_history', 'tracker_activity_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists account_owns_rows on public.%I', table_name);
    execute format(
      'create policy account_owns_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

-- One atomic save replaces the signed-in account's normalized snapshot.
create or replace function public.save_tracker_snapshot(p_snapshot jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  app jsonb := coalesce(p_snapshot->'appData', '{}'::jsonb);
  item record;
begin
  if owner_id is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(app) <> 'object' then
    raise exception 'Invalid tracker snapshot';
  end if;

  insert into public.tracker_settings (user_id, current_day, streak, last_completed_day, routine_version, reminders_sent, alarms, distractions, updated_at)
  values (
    owner_id,
    coalesce(nullif(p_snapshot->>'dayKey', '')::date, current_date),
    greatest(coalesce(nullif(p_snapshot->>'streak', '')::integer, 0), 0),
    nullif(p_snapshot->>'lastCompletedDay', '')::date,
    coalesce(nullif(p_snapshot->>'routineVersion', '')::integer, 3),
    array(select jsonb_array_elements_text(coalesce(app->'remindersSent', '[]'::jsonb))),
    coalesce(app->'alarms', '[]'::jsonb),
    coalesce(app->'distractions', '[]'::jsonb),
    now()
  )
  on conflict (user_id) do update set
    current_day = excluded.current_day,
    streak = excluded.streak,
    last_completed_day = excluded.last_completed_day,
    routine_version = excluded.routine_version,
    reminders_sent = excluded.reminders_sent,
    alarms = excluded.alarms,
    distractions = excluded.distractions,
    updated_at = now();

  delete from public.tracker_goals where user_id = owner_id;
  for item in select value, ordinality from jsonb_array_elements_text(coalesce(app->'goals', '[]'::jsonb)) with ordinality loop
    insert into public.tracker_goals (user_id, goal_id, title, position)
    values (owner_id, 'goal_' || item.ordinality::text, item.value, item.ordinality::integer);
  end loop;

  delete from public.tracker_routines where user_id = owner_id;
  for item in
    select schedule_type, value, ordinality
    from (
      select 'weekday'::text as schedule_type, value, ordinality from jsonb_array_elements(coalesce(app->'weekdayRoutine', '[]'::jsonb)) with ordinality
      union all
      select 'weekend'::text as schedule_type, value, ordinality from jsonb_array_elements(coalesce(app->'weekendRoutine', '[]'::jsonb)) with ordinality
    ) routines
  loop
    insert into public.tracker_routines (user_id, routine_id, schedule_type, position, start_time, end_time, label, actions)
    values (
      owner_id,
      coalesce(item.value->>'id', coalesce(item.value->>'start', '') || '|' || coalesce(item.value->>'end', '') || '|' || coalesce(item.value->>'label', '')),
      item.schedule_type,
      item.ordinality::integer,
      coalesce(item.value->>'start', ''),
      coalesce(item.value->>'end', ''),
      coalesce(item.value->>'label', ''),
      coalesce(item.value->'actions', '[]'::jsonb)
    );
  end loop;

  delete from public.tracker_daily_tasks where user_id = owner_id;
  for item in select value from jsonb_array_elements(coalesce(app->'dailyTasks', '[]'::jsonb)) loop
    insert into public.tracker_daily_tasks (user_id, task_id, task_date, title, done, category, routine_id, punishment, created_at, metadata)
    values (
      owner_id,
      item.value->>'id',
      coalesce(nullif(p_snapshot->>'dayKey', '')::date, current_date),
      coalesce(item.value->>'text', ''),
      coalesce(nullif(item.value->>'done', '')::boolean, false),
      coalesce(item.value->>'category', 'goal'),
      nullif(item.value->>'routineId', ''),
      coalesce(item.value->>'punishment', ''),
      coalesce(to_timestamp((nullif(item.value->>'createdAt', '')::numeric / 1000)::double precision), now()),
      item.value - array['id','text','done','category','routineId','punishment','createdAt']
    );
  end loop;

  delete from public.tracker_backlog_tasks where user_id = owner_id;
  for item in select value from jsonb_array_elements(coalesce(app->'backlog', '[]'::jsonb)) loop
    insert into public.tracker_backlog_tasks (user_id, task_id, title, due_date, done, category, routine_id, punishment, source_task_id, carried_at, resolved_at, metadata)
    values (
      owner_id,
      item.value->>'id',
      coalesce(item.value->>'text', ''),
      nullif(item.value->>'dueDate', '')::date,
      coalesce(nullif(item.value->>'done', '')::boolean, false),
      coalesce(item.value->>'category', 'goal'),
      nullif(item.value->>'routineId', ''),
      coalesce(item.value->>'punishment', ''),
      nullif(item.value->>'sourceTaskId', ''),
      to_timestamp((nullif(item.value->>'carriedAt', '')::numeric / 1000)::double precision),
      to_timestamp((nullif(item.value->>'resolvedAt', '')::numeric / 1000)::double precision),
      item.value - array['id','text','dueDate','done','category','routineId','punishment','sourceTaskId','carriedAt','resolvedAt']
    );
  end loop;

  delete from public.tracker_behavior_rules where user_id = owner_id;
  for item in select value, ordinality from jsonb_array_elements(coalesce(app->'behaviorRules', '[]'::jsonb)) with ordinality loop
    insert into public.tracker_behavior_rules (user_id, rule_id, title, done, position)
    values (owner_id, item.value->>'id', coalesce(item.value->>'text', ''), coalesce(nullif(item.value->>'done', '')::boolean, false), item.ordinality::integer);
  end loop;

  delete from public.tracker_daily_history where user_id = owner_id;
  for item in select key, value from jsonb_each(coalesce(p_snapshot->'history', '{}'::jsonb)) loop
    insert into public.tracker_daily_history (
      user_id, activity_date, completed_tasks, total_tasks, completion_percent,
      completed_rules, total_rules, completed_backlog, total_backlog, details
    )
    values (
      owner_id,
      item.key::date,
      coalesce(nullif(item.value->>'completed', '')::integer, 0),
      coalesce(nullif(item.value->>'total', '')::integer, 0),
      greatest(0, least(100, coalesce(nullif(item.value->>'percent', '')::integer, 0))),
      coalesce(nullif(item.value->>'disciplineDone', '')::integer, 0),
      coalesce(nullif(item.value->>'disciplineTotal', '')::integer, 0),
      coalesce(nullif(item.value->>'backlogDone', '')::integer, 0),
      coalesce(nullif(item.value->>'backlogTotal', '')::integer, 0),
      item.value - array['completed','total','percent','disciplineDone','disciplineTotal','backlogDone','backlogTotal','pointsEarned','routineDone','routineTotal']
    );
  end loop;

  delete from public.tracker_activity_events where user_id = owner_id;
  for item in select value from jsonb_array_elements(coalesce(p_snapshot->'activityLog', '[]'::jsonb)) loop
    if item.value->>'kind' not in ('routine_completed', 'routine_reopened', 'points_earned') then
      insert into public.tracker_activity_events (user_id, event_id, activity_date, occurred_at, kind, title, details)
      values (owner_id, item.value->>'id', coalesce(nullif(item.value->>'day', '')::date, current_date), coalesce(nullif(item.value->>'at', '')::timestamptz, now()), item.value->>'kind', coalesce(item.value->>'title', ''), coalesce(item.value->>'details', ''));
    end if;
  end loop;

end;
$$;

revoke all on function public.save_tracker_snapshot(jsonb) from public;
grant execute on function public.save_tracker_snapshot(jsonb) to authenticated;
