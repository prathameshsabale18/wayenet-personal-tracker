import { createClient } from "@supabase/supabase-js";

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const cloudConfigured = Boolean(projectUrl && publicAnonKey);

export const supabase = cloudConfigured
  ? createClient(projectUrl, publicAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null;

function getClient() {
  if (!supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadCloudProductState(userId) {
  const client = getClient();
  const tables = [
    ["settings", client.from("tracker_settings").select("*").eq("user_id", userId).maybeSingle()],
    ["goals", client.from("tracker_goals").select("*").eq("user_id", userId).order("position")],
    ["routines", client.from("tracker_routines").select("*").eq("user_id", userId).order("schedule_type").order("position")],
    ["dailyTasks", client.from("tracker_daily_tasks").select("*").eq("user_id", userId).order("created_at")],
    ["backlog", client.from("tracker_backlog_tasks").select("*").eq("user_id", userId).order("due_date")],
    ["behaviorRules", client.from("tracker_behavior_rules").select("*").eq("user_id", userId).order("position")],
    ["history", client.from("tracker_daily_history").select("*").eq("user_id", userId).order("activity_date")],
    ["activityLog", client.from("tracker_activity_events").select("*").eq("user_id", userId).order("occurred_at", { ascending: false })],
  ];
  const results = await Promise.all(tables.map(([, request]) => request));
  for (let index = 0; index < results.length; index += 1) {
    if (results[index].error) throw results[index].error;
  }
  const rows = Object.fromEntries(tables.map(([name], index) => [name, results[index].data]));
  const settings = rows.settings;
  const hasNormalizedData = Boolean(settings) || Object.entries(rows).some(([name, value]) => name !== "settings" && value?.length);

  if (!hasNormalizedData) {
    const { data: legacy, error } = await client
      .from("tracker_state")
      .select("payload")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!legacy?.payload) return null;
    await saveCloudProductState(userId, legacy.payload);
    return legacy.payload;
  }

  const weekdayRoutine = rows.routines.filter(row => row.schedule_type === "weekday").map(row => ({
    id: row.routine_id,
    start: row.start_time,
    end: row.end_time,
    label: row.label,
    actions: row.actions || []
  }));
  const weekendRoutine = rows.routines.filter(row => row.schedule_type === "weekend").map(row => ({
    id: row.routine_id,
    start: row.start_time,
    end: row.end_time,
    label: row.label,
    actions: row.actions || []
  }));
  const history = Object.fromEntries(rows.history.map(row => [row.activity_date, {
    ...row.details,
    date: row.activity_date,
    completed: row.completed_tasks,
    total: row.total_tasks,
    percent: row.completion_percent,
    disciplineDone: row.completed_rules,
    disciplineTotal: row.total_rules,
    backlogDone: row.completed_backlog,
    backlogTotal: row.total_backlog,
  }]));

  return {
    appData: {
      goals: rows.goals.map(row => row.title),
      weekdayRoutine,
      weekendRoutine,
      routineSchedule: weekdayRoutine,
      dailyTasks: rows.dailyTasks.map(row => ({
        ...row.metadata,
        id: row.task_id,
        text: row.title,
        done: row.done,
        category: row.category,
        routineId: row.routine_id,
        punishment: row.punishment,
        createdAt: new Date(row.created_at).getTime()
      })),
      backlog: rows.backlog.map(row => ({
        ...row.metadata,
        id: row.task_id,
        text: row.title,
        dueDate: row.due_date,
        done: row.done,
        category: row.category,
        routineId: row.routine_id,
        punishment: row.punishment,
        sourceTaskId: row.source_task_id,
        carriedAt: row.carried_at ? new Date(row.carried_at).getTime() : null,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null
      })),
      behaviorRules: rows.behaviorRules.map(row => ({ id: row.rule_id, text: row.title, done: row.done })),
      behaviorReviewDate: settings?.current_day && history[settings.current_day]?.disciplineReviewed ? settings.current_day : null,
      remindersSent: settings?.reminders_sent || [],
      alarms: settings?.alarms || [],
      distractions: settings?.distractions || []
    },
    routineVersion: settings?.routine_version || 3,
    dayKey: settings?.current_day,
    history,
    activityLog: rows.activityLog.map(row => ({
      id: row.event_id,
      at: row.occurred_at,
      day: row.activity_date,
      kind: row.kind,
      title: row.title,
      details: row.details
    })),
    streak: settings?.streak || 0,
    lastCompletedDay: settings?.last_completed_day || null,
  };
}

export async function saveCloudProductState(userId, payload) {
  if (!payload || !userId) throw new Error("A signed-in user and tracker snapshot are required.");
  const client = getClient();
  const { data, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (data.session?.user?.id !== userId) throw new Error("The signed-in account does not match the tracker owner.");
  const { error } = await client.rpc("save_tracker_snapshot", { p_snapshot: payload });
  if (error) throw error;
}
