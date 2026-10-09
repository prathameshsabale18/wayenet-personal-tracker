# Supabase Cloud Setup

WAYNENET stores progress in separate, per-account PostgreSQL tables protected by row-level security. Tracker data is not saved locally after it has been imported to Supabase.

The tables are organized by record type:

- `tracker_goals`: saved goals used to generate daily suggestions.
- `tracker_routines`: weekday and weekend schedule blocks, used as task references only.
- `tracker_daily_tasks`: today's tasks and their completion status, including each task's optional `routine_id`.
- `tracker_backlog_tasks`: missed tasks and their resolution status.
- `tracker_behavior_rules`: the four current non-negotiable rules and their selected status for today.
- `tracker_daily_history`: one summary row per saved day, including whether the end-of-day rule review was saved.
- `tracker_activity_events`: the detailed event timeline.
- `tracker_settings`: current day, streak, reminders, and small app settings.

The app does not use a point system. The four non-negotiables are reviewed together at the end of the day and recorded separately from daily tasks. Routine completion is not scored or tracked. Daily suggestions are generated from saved goals and the current routine, with the choices rotating by date.

The old `tracker_state` JSON row is retained as a migration backup. On first sign-in after applying the new schema, the app imports that row into the tables above; future changes are saved to the separate tables.

To inspect the source activity timeline, run:

```sql
select activity_date, occurred_at, kind, title, details
from public.tracker_activity_events
order by occurred_at desc
limit 50;
```

## Supabase project

1. Create a Supabase project.
2. Open the SQL Editor and run the full, updated [`supabase/schema.sql`](supabase/schema.sql). This adds the organized tables and migration function while preserving the old `tracker_state` row.
3. In Authentication settings, keep public sign-ups disabled. In Authentication → Users, create your own user with your email and a password. The app has a sign-in form only; it cannot create accounts.
4. Confirm Email/Password authentication is enabled in the Auth providers settings.
5. In Project API settings, copy the Project URL and the public anon/publishable key. Never put the service-role key in frontend environment variables.

Supabase's built-in password sign-in identifies the account by email (or phone), not an arbitrary username. Use your account email in the app's Email field.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
3. Restart Vite and sign in with the email and password created above. The app migrates your old JSON row on first sign-in. Open the Records page and confirm the database status reads `SYNCED`.

`.env.local` is ignored by Git. Both variables and a valid account are required to open the tracker.

## Netlify

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Netlify environment variables for the deploy context, then trigger a fresh deploy. Sign in with the same account on each device to access its tracker row.

When the account has old JSON data, WAYNENET imports it into the organized tables and keeps the old row as a backup. All future progress changes are saved to the separate tables through an authenticated database function. The row-level policies in [`supabase/schema.sql`](supabase/schema.sql) limit each account to its own records.
