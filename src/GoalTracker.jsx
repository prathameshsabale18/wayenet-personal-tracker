import React, { useEffect, useMemo, useState } from "react";
import { loadProductState, saveProductState } from "./database";
import { cloudConfigured, loadCloudProductState, saveCloudProductState, supabase } from "./cloudDatabase";
import "./GoalTracker.css";

const DATA_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUNISHMENT = "Finish this overdue task before adding optional tasks.";

function makeId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`;
}

function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyState() {
  return {
    schemaVersion: DATA_VERSION,
    currentDay: dayKey(),
    goals: [],
    habits: [],
    tasks: [],
    dailyHistory: [],
    activityLog: [],
    punishmentRule: DEFAULT_PUNISHMENT
  };
}

function normalizeState(value) {
  if (value?.schemaVersion !== DATA_VERSION) return emptyState();
  return {
    ...emptyState(),
    ...value,
    goals: Array.isArray(value.goals) ? value.goals : [],
    habits: Array.isArray(value.habits) ? value.habits : [],
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    dailyHistory: Array.isArray(value.dailyHistory) ? value.dailyHistory : [],
    activityLog: Array.isArray(value.activityLog) ? value.activityLog : []
  };
}

function priorityRank(priority) {
  return ({ high: 0, medium: 1, low: 2 })[priority] ?? 1;
}

function timeRemaining(dueAt, now) {
  const seconds = Math.max(0, Math.ceil((dueAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function GoalTracker() {
  const [data, setData] = useState(emptyState);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [session, setSession] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(cloudConfigured ? "CONNECTING" : "LOCAL ONLY");
  const [cloudError, setCloudError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [activePage, setActivePage] = useState("home");
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalNextAction, setGoalNextAction] = useState("");
  const [goalPriority, setGoalPriority] = useState("medium");
  const [habitDraft, setHabitDraft] = useState("");
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [editingGoalAction, setEditingGoalAction] = useState("");

  const appendEvent = (previous, kind, title, details = "", at = Date.now()) => [{
    id: `event-${at}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(at).toISOString(),
    date: dayKey(new Date(at)),
    kind,
    title,
    details
  }, ...previous];

  const hydrateCloudAccount = async (nextSession, localFallback = data) => {
    setCloudReady(false);
    setCloudStatus("LOADING");
    setCloudError("");
    try {
      const remote = await loadCloudProductState(nextSession.user.id);
      let nextData;
      if (remote === null) {
        nextData = normalizeState(localFallback);
      } else {
        // The schema version change is the requested full reset of the old tracker data.
        nextData = normalizeState(remote);
      }
      setData(nextData);
      setSession(nextSession);
      setCloudReady(true);
      setCloudStatus("SYNCED");
      setAccountOpen(false);
      setAuthMessage("");
    } catch (error) {
      setCloudError(error.message || "Could not load the cloud tracker.");
      setCloudStatus("CLOUD ERROR");
      setCloudReady(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const local = await loadProductState();
      if (cancelled) return;
      const nextData = normalizeState(local);
      setData(nextData);
      setDatabaseReady(true);
      if (!cloudConfigured || !supabase) {
        setCloudReady(true);
        setCloudStatus("LOCAL ONLY");
        return;
      }
      try {
        const { data: authData, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (cancelled) return;
        if (authData.session) await hydrateCloudAccount(authData.session, nextData);
        else {
          setCloudReady(true);
          setCloudStatus("LOCAL ONLY");
        }
      } catch (error) {
        if (cancelled) return;
        setCloudError(error.message || "Could not connect to Supabase.");
        setCloudStatus("CLOUD ERROR");
        setCloudReady(true);
      }
    };
    initialize().catch(error => {
      if (cancelled) return;
      setCloudError(error.message || "Could not load local tracker data.");
      setDatabaseReady(true);
      setCloudReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!databaseReady) return;
    saveProductState(data).catch(error => console.error("Local tracker save failed:", error));
    if (!cloudConfigured || !session || !cloudReady) return;
    const timer = setTimeout(() => {
      setCloudStatus("SAVING");
      saveCloudProductState(session.user.id, data)
        .then(() => { setCloudError(""); setCloudStatus("SYNCED"); })
        .catch(error => { setCloudError(error.message || "Cloud save failed."); setCloudStatus("CLOUD ERROR"); });
    }, 500);
    return () => clearTimeout(timer);
  }, [data, databaseReady, session, cloudReady]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!databaseReady) return;
    const expiring = data.tasks.filter(task => task.status === "open" && task.dueAt <= now);
    if (!expiring.length) return;
    const expiredIds = new Set(expiring.map(task => task.id));
    setData(previous => ({
      ...previous,
      tasks: previous.tasks.map(task => expiredIds.has(task.id) && task.status === "open"
        ? { ...task, status: "overdue", overdueAt: now }
        : task),
      activityLog: expiring.reduce((events, task) => appendEvent(events, "task_overdue", `Backlog: ${task.title}`, `24 hours elapsed. Punishment: ${task.punishment}`, now), previous.activityLog)
    }));
  }, [data.tasks, databaseReady, now]);

  useEffect(() => {
    if (!databaseReady || data.currentDay === dayKey(new Date(now))) return;
    const closedDate = data.currentDay;
    const closedEvents = data.activityLog.filter(event => event.date === closedDate);
    const snapshot = {
      date: closedDate,
      tasksAdded: closedEvents.filter(event => event.kind === "task_created").length,
      tasksCompleted: closedEvents.filter(event => event.kind === "task_completed").length,
      habitsChecked: closedEvents.filter(event => event.kind === "habit_checked").length,
      habitCount: data.habits.length
    };
    setData(previous => ({
      ...previous,
      currentDay: dayKey(new Date(now)),
      dailyHistory: [snapshot, ...previous.dailyHistory.filter(item => item.date !== closedDate)],
      activityLog: appendEvent(previous.activityLog, "day_closed", `Day recorded: ${closedDate}`, `${snapshot.tasksCompleted} tasks completed; ${snapshot.habitsChecked} habit check-ins.`, now)
    }));
  }, [databaseReady, data.currentDay, data.activityLog, data.habits.length, now]);

  const activeGoals = data.goals.filter(goal => goal.status === "active");
  const openTasks = data.tasks.filter(task => task.status === "open");
  const backlog = data.tasks.filter(task => task.status === "overdue");
  const completedTasks = data.tasks.filter(task => task.status === "completed");
  const today = dayKey(new Date(now));
  const todaysHabitsChecked = data.habits.filter(habit => habit.checkIns.includes(today)).length;
  const suggestedGoals = useMemo(() => data.goals.filter(goal => goal.status === "active")
    .filter(goal => goal.nextAction.trim() && !data.tasks.some(task => task.goalId === goal.id && task.createdDay === today && task.status !== "removed"))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)), [data.goals, data.tasks, today]);
  const recentHistory = useMemo(() => {
    const completedByDate = {};
    const checkedByDate = {};
    data.activityLog.forEach(event => {
      if (event.kind === "task_completed") completedByDate[event.date] = (completedByDate[event.date] || 0) + 1;
      if (event.kind === "habit_checked") checkedByDate[event.date] = (checkedByDate[event.date] || 0) + 1;
    });
    const snapshots = [...data.dailyHistory];
    if (!snapshots.some(item => item.date === today)) snapshots.unshift({
      date: today,
      tasksAdded: data.tasks.filter(task => task.createdDay === today).length,
      tasksCompleted: completedByDate[today] || 0,
      habitsChecked: checkedByDate[today] || 0,
      habitCount: data.habits.length
    });
    return snapshots.slice(0, 14).reverse();
  }, [data.activityLog, data.dailyHistory, data.habits.length, data.tasks, today]);

  const updateData = change => setData(previous => change(previous));

  const addGoal = event => {
    event.preventDefault();
    if (!goalTitle.trim() || !goalNextAction.trim()) return;
    const goal = {
      id: makeId("goal"),
      title: goalTitle.trim(),
      nextAction: goalNextAction.trim(),
      priority: goalPriority,
      status: "active",
      createdAt: Date.now()
    };
    updateData(previous => ({
      ...previous,
      goals: [goal, ...previous.goals],
      activityLog: appendEvent(previous.activityLog, "goal_created", `Goal added: ${goal.title}`, `First action: ${goal.nextAction}`)
    }));
    setGoalTitle("");
    setGoalNextAction("");
    setGoalPriority("medium");
  };

  const saveEditedGoalAction = goalId => {
    const goal = data.goals.find(item => item.id === goalId);
    const action = editingGoalAction.trim();
    if (!goal || !action || action === goal.nextAction) { setEditingGoalId(null); return; }
    updateData(previous => ({
      ...previous,
      goals: previous.goals.map(item => item.id === goalId ? { ...item, nextAction: action } : item),
      activityLog: appendEvent(previous.activityLog, "goal_action_updated", `Next action updated: ${goal.title}`, action)
    }));
    setEditingGoalId(null);
  };

  const toggleGoal = goal => updateData(previous => ({
    ...previous,
    goals: previous.goals.map(item => item.id === goal.id ? { ...item, status: item.status === "active" ? "completed" : "active", completedAt: item.status === "active" ? Date.now() : null } : item),
    activityLog: appendEvent(previous.activityLog, goal.status === "active" ? "goal_completed" : "goal_reopened", `${goal.status === "active" ? "Goal completed" : "Goal reopened"}: ${goal.title}`)
  }));

  const deleteGoal = goal => {
    if (!window.confirm(`Delete goal “${goal.title}”? Its past task records will remain.`)) return;
    updateData(previous => ({
      ...previous,
      goals: previous.goals.filter(item => item.id !== goal.id),
      activityLog: appendEvent(previous.activityLog, "goal_deleted", `Goal deleted: ${goal.title}`, "Linked task history retained")
    }));
  };

  const addHabit = event => {
    event.preventDefault();
    if (!habitDraft.trim()) return;
    const habit = { id: makeId("habit"), title: habitDraft.trim(), checkIns: [], createdAt: Date.now(), active: true };
    updateData(previous => ({
      ...previous,
      habits: [habit, ...previous.habits],
      activityLog: appendEvent(previous.activityLog, "habit_created", `Habit added: ${habit.title}`)
    }));
    setHabitDraft("");
  };

  const toggleHabit = habit => {
    const checked = habit.checkIns.includes(today);
    updateData(previous => ({
      ...previous,
      habits: previous.habits.map(item => item.id === habit.id
        ? { ...item, checkIns: checked ? item.checkIns.filter(date => date !== today) : [...item.checkIns, today] }
        : item),
      activityLog: appendEvent(previous.activityLog, checked ? "habit_unchecked" : "habit_checked", `${checked ? "Unchecked" : "Checked"}: ${habit.title}`)
    }));
  };

  const deleteHabit = habit => {
    updateData(previous => ({
      ...previous,
      habits: previous.habits.filter(item => item.id !== habit.id),
      activityLog: appendEvent(previous.activityLog, "habit_deleted", `Habit removed: ${habit.title}`, "Past check-ins remain in the activity log")
    }));
  };

  const createTaskFromGoal = goal => {
    if (data.tasks.some(task => task.goalId === goal.id && task.createdDay === today && task.status !== "removed")) return;
    const timestamp = Date.now();
    const task = {
      id: makeId("task"),
      title: goal.nextAction,
      goalId: goal.id,
      goalTitle: goal.title,
      status: "open",
      createdAt: timestamp,
      createdDay: today,
      dueAt: timestamp + DAY_MS,
      punishment: data.punishmentRule.trim() || DEFAULT_PUNISHMENT,
      completedAt: null
    };
    updateData(previous => ({
      ...previous,
      tasks: [task, ...previous.tasks],
      activityLog: appendEvent(previous.activityLog, "task_created", `Task added: ${task.title}`, `From goal: ${goal.title}. Due in 24 hours. Punishment: ${task.punishment}`, timestamp)
    }));
  };

  const completeTask = task => updateData(previous => ({
    ...previous,
    tasks: previous.tasks.map(item => item.id === task.id ? { ...item, status: "completed", completedAt: Date.now() } : item),
    activityLog: appendEvent(previous.activityLog, "task_completed", `Task completed: ${task.title}`, `Goal: ${task.goalTitle}${task.status === "overdue" ? ". Backlog cleared." : ""}`)
  }));

  const addHabitByGoal = goal => {
    if (data.habits.some(habit => habit.title.toLowerCase() === goal.title.toLowerCase())) return;
    const habit = { id: makeId("habit"), title: goal.title, goalId: goal.id, checkIns: [], createdAt: Date.now(), active: true };
    updateData(previous => ({
      ...previous,
      habits: [habit, ...previous.habits],
      activityLog: appendEvent(previous.activityLog, "habit_created", `Habit linked to goal: ${habit.title}`)
    }));
  };

  const resetAllRecords = () => {
    if (!window.confirm("Reset all goals, habits, tasks, backlog, and progress records on this device and your signed-in cloud account? This cannot be undone.")) return;
    const reset = emptyState();
    if (session) reset.activityLog = appendEvent([], "database_reset", "Tracker database reset");
    setData(reset);
  };

  const handleAuthSubmit = async event => {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setCloudError("");
    setAuthMessage("");
    try {
      const credentials = { email: authEmail.trim(), password: authPassword };
      const response = authMode === "signup"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
      if (response.error) throw response.error;
      if (response.data.session) await hydrateCloudAccount(response.data.session);
      else setAuthMessage("Account created. Confirm your email, then sign in to turn on cloud sync.");
    } catch (error) {
      setCloudError(error.message || "Account request failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setCloudError(error.message || "Could not sign out.");
    else {
      setSession(null);
      setCloudReady(true);
      setCloudStatus("LOCAL ONLY");
    }
  };

  const exportRecords = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waynenet-records-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderTask = task => (
    <article className="task-card" key={task.id}>
      <div className="task-card-main">
        <div className="task-card-title">{task.title}</div>
        <div className="task-card-goal">GOAL · {task.goalTitle}</div>
      </div>
      <div className="task-card-meta">
        {task.status === "open" ? <><span className="task-countdown">{timeRemaining(task.dueAt, now)}</span><small>DUE IN</small></> : <><span className="task-overdue">OVERDUE</span><small>{formatDateTime(task.overdueAt || task.dueAt)}</small></>}
        <button className="button-primary button-small" onClick={() => completeTask(task)}>COMPLETE</button>
      </div>
    </article>
  );

  const pageTabs = [
    ["home", "HOME"], ["goals", "GOALS"], ["habits", "HABITS"], ["backlog", `BACKLOG${backlog.length ? ` · ${backlog.length}` : ""}`], ["records", "RECORDS"]
  ];

  return (
    <main className="goal-app-shell">
      <header className="goal-header">
        <div className="goal-brand"><span className="goal-mark" /><div><div className="goal-brand-name">WAYNENET</div><div className="goal-brand-subtitle">GOALS · HABITS · DAILY ACTION</div></div></div>
        <div className="goal-header-actions">
          <span className={`sync-indicator ${cloudStatus === "SYNCED" ? "sync-live" : ""}`}><i />{cloudStatus}</span>
          {session ? <button className="button-quiet" onClick={signOut}>{session.user.email} · SIGN OUT</button> : cloudConfigured && <button className="button-quiet" onClick={() => setAccountOpen(!accountOpen)}>CONNECT CLOUD</button>}
        </div>
      </header>

      {accountOpen && <section className="account-panel">
        <div className="section-heading"><div><span className="eyebrow">OPTIONAL BACKUP</span><h2>{authMode === "signin" ? "Connect your account" : "Create an account"}</h2></div><button className="button-quiet" onClick={() => setAccountOpen(false)}>CLOSE</button></div>
        <p className="muted-copy">The tracker works on this device without an account. Sign in to sync goals and records with Supabase.</p>
        <form className="account-form" onSubmit={handleAuthSubmit}>
          <input type="email" autoComplete="email" placeholder="Email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} required />
          <input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} placeholder="Password (at least 8 characters)" value={authPassword} onChange={event => setAuthPassword(event.target.value)} required />
          <button className="button-primary" disabled={authBusy}>{authBusy ? "CONNECTING…" : authMode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}</button>
        </form>
        {cloudError && <p className="notice-error">{cloudError}</p>}{authMessage && <p className="notice-success">{authMessage}</p>}
        <button className="button-quiet" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setCloudError(""); setAuthMessage(""); }}>{authMode === "signin" ? "NEED AN ACCOUNT? CREATE ONE" : "ALREADY HAVE AN ACCOUNT? SIGN IN"}</button>
      </section>}

      {cloudError && !accountOpen && <div className="notice-error cloud-notice">Cloud sync: {cloudError}</div>}

      <nav className="goal-nav" aria-label="Main navigation">
        {pageTabs.map(([key, label]) => <button key={key} className={activePage === key ? "selected" : ""} onClick={() => setActivePage(key)}>{label}</button>)}
      </nav>

      {activePage === "home" && <div className="page-stack">
        <section className="welcome-row">
          <div><span className="eyebrow">{new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span><h1>Make progress on what matters.</h1><p>One clear action from your goals, one day at a time.</p></div>
          <div className="today-score"><strong>{completedTasks.filter(task => task.completedAt && dayKey(new Date(task.completedAt)) === today).length}</strong><span>TASKS DONE TODAY</span><small>{todaysHabitsChecked}/{data.habits.length} habits checked</small></div>
        </section>

        <section className="content-panel suggestions-panel">
          <div className="section-heading"><div><span className="eyebrow">BASED ONLY ON YOUR ACTIVE GOALS</span><h2>Daily task suggestions</h2></div><span className="count-chip">{suggestedGoals.length} READY</span></div>
          {suggestedGoals.length ? <div className="suggestion-list">{suggestedGoals.map(goal => <article className="suggestion-card" key={goal.id}>
            <div className="suggestion-priority">{goal.priority.toUpperCase()} PRIORITY</div><div className="suggestion-goal">{goal.title}</div><p>{goal.nextAction}</p>
            <button className="button-primary" onClick={() => createTaskFromGoal(goal)}>ADD THIS TASK · 24H WINDOW</button>
          </article>)}</div> : <div className="empty-state"><strong>No goal actions ready to suggest.</strong><span>Add an active goal with a specific next action. Suggestions are generated only from those goal actions.</span><button className="button-secondary" onClick={() => setActivePage("goals")}>ADD A GOAL</button></div>}
          <label className="punishment-setting"><span>IF A TASK ISN’T COMPLETED WITHIN 24 HOURS, ASSIGN THIS PUNISHMENT</span><input value={data.punishmentRule} onChange={event => updateData(previous => ({ ...previous, punishmentRule: event.target.value }))} maxLength={180} /></label>
        </section>

        <section className="content-panel">
          <div className="section-heading"><div><span className="eyebrow">24-HOUR COMPLETION WINDOW</span><h2>Daily tasks</h2></div><span className="count-chip">{openTasks.length} OPEN</span></div>
          {openTasks.length ? <div className="task-list">{openTasks.map(renderTask)}</div> : <div className="empty-state compact"><span>No open tasks. Add one from a goal suggestion.</span></div>}
        </section>

        <section className="content-panel backlog-preview">
          <div className="section-heading"><div><span className="eyebrow">24 HOURS ELAPSED</span><h2>Backlog</h2></div><button className="button-quiet" onClick={() => setActivePage("backlog")}>VIEW ALL · {backlog.length}</button></div>
          {backlog.length ? backlog.slice(0, 3).map(task => <div className="backlog-preview-row" key={task.id}><span>{task.title}</span><small>{task.punishment}</small></div>) : <p className="muted-copy">Nothing overdue. Tasks enter this list automatically 24 hours after creation.</p>}
        </section>
      </div>}

      {activePage === "goals" && <div className="page-stack">
        <section className="page-intro"><span className="eyebrow">DIRECTION → NEXT ACTION</span><h1>Your goals</h1><p>Every goal needs a concrete next action. Only those actions can appear as daily task suggestions.</p></section>
        <section className="content-panel">
          <div className="section-heading"><div><span className="eyebrow">DEFINE WHAT MATTERS</span><h2>Add a goal</h2></div></div>
          <form className="goal-form" onSubmit={addGoal}>
            <label>GOAL<input value={goalTitle} onChange={event => setGoalTitle(event.target.value)} placeholder="What do you want to achieve?" maxLength={100} required /></label>
            <label>FIRST / NEXT ACTION<input value={goalNextAction} onChange={event => setGoalNextAction(event.target.value)} placeholder="A task you can complete in one sitting" maxLength={160} required /></label>
            <label>PRIORITY<select value={goalPriority} onChange={event => setGoalPriority(event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <button className="button-primary">SAVE GOAL</button>
          </form>
        </section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">YOUR DIRECTION</span><h2>Active goals · {activeGoals.length}</h2></div><span className="count-chip">{data.goals.filter(goal => goal.status === "completed").length} COMPLETE</span></div>
          {data.goals.length ? <div className="goal-list">{data.goals.map(goal => <article className={`goal-card ${goal.status === "completed" ? "goal-completed" : ""}`} key={goal.id}>
            <div className="goal-card-top"><span className={`priority-dot priority-${goal.priority}`} /> <span className="goal-card-priority">{goal.priority} priority</span><span className="goal-card-status">{goal.status}</span></div>
            <h3>{goal.title}</h3>
            {editingGoalId === goal.id ? <div className="edit-action-row"><input value={editingGoalAction} onChange={event => setEditingGoalAction(event.target.value)} autoFocus /><button className="button-primary button-small" onClick={() => saveEditedGoalAction(goal.id)}>SAVE</button></div> : <p className="goal-next-action"><span>NEXT ACTION</span>{goal.nextAction}</p>}
            <div className="goal-card-actions"><button className="button-secondary" onClick={() => toggleGoal(goal)}>{goal.status === "active" ? "MARK COMPLETE" : "REOPEN GOAL"}</button><button className="button-quiet" onClick={() => { setEditingGoalId(goal.id); setEditingGoalAction(goal.nextAction); }}>EDIT NEXT ACTION</button>{goal.status === "active" && !data.habits.some(habit => habit.goalId === goal.id) && <button className="button-quiet" onClick={() => addHabitByGoal(goal)}>TRACK AS HABIT</button>}<button className="button-danger" onClick={() => deleteGoal(goal)}>DELETE</button></div>
          </article>)}</div> : <div className="empty-state"><strong>No goals yet.</strong><span>Add a goal and its next action to generate your first daily suggestion.</span></div>}
        </section>
      </div>}

      {activePage === "habits" && <div className="page-stack">
        <section className="page-intro"><span className="eyebrow">CONSISTENCY, RECORDED DAILY</span><h1>Your habits</h1><p>Check a habit once each day. Daily check-ins become part of your progress history.</p></section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">BUILD YOUR TRACKER</span><h2>Add a habit</h2></div></div><form className="inline-form" onSubmit={addHabit}><input value={habitDraft} onChange={event => setHabitDraft(event.target.value)} placeholder="e.g. Read for 20 minutes" maxLength={100} required /><button className="button-primary">ADD HABIT</button></form></section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">TODAY · {todaysHabitsChecked}/{data.habits.length}</span><h2>Daily check-in</h2></div></div>
          {data.habits.length ? <div className="habit-list">{data.habits.map(habit => <article className={`habit-row ${habit.checkIns.includes(today) ? "habit-checked" : ""}`} key={habit.id}><button className="habit-check" aria-label={`${habit.checkIns.includes(today) ? "Uncheck" : "Check"} ${habit.title}`} onClick={() => toggleHabit(habit)}>{habit.checkIns.includes(today) ? "✓" : ""}</button><div className="habit-info"><strong>{habit.title}</strong><span>{habit.checkIns.length} total check-ins{habit.goalId ? " · linked to a goal" : ""}</span></div><button className="button-danger" onClick={() => deleteHabit(habit)}>REMOVE</button></article>)}</div> : <div className="empty-state compact"><span>No habits yet. Add one here or turn an active goal into a habit.</span></div>}
        </section>
      </div>}

      {activePage === "backlog" && <div className="page-stack"><section className="page-intro"><span className="eyebrow">AUTOMATIC · NO MIDNIGHT RESET</span><h1>24-hour backlog</h1><p>An open task moves here as soon as 24 hours pass. Its assigned punishment stays attached until you complete it.</p></section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">OVERDUE TASKS</span><h2>Needs completion · {backlog.length}</h2></div></div>{backlog.length ? <div className="task-list">{backlog.map(renderTask)}</div> : <div className="empty-state compact"><span>No overdue tasks.</span></div>}</section>
      </div>}

      {activePage === "records" && <div className="page-stack"><section className="page-intro records-title-row"><div><span className="eyebrow">ALL GOAL, HABIT & TASK EVENTS</span><h1>Progress records</h1><p>Every change is timestamped and saved with your tracker.</p></div><button className="button-secondary" onClick={exportRecords}>EXPORT JSON</button></section>
        <section className="records-summary"><div><strong>{data.goals.length}</strong><span>GOALS</span></div><div><strong>{data.habits.length}</strong><span>HABITS</span></div><div><strong>{completedTasks.length}</strong><span>TASKS COMPLETED</span></div><div><strong>{backlog.length}</strong><span>OPEN BACKLOG</span></div></section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">RECENT DAILY TOTALS</span><h2>Progress trend · 14 days</h2></div></div><div className="history-chart-grid">{recentHistory.map(item => <div className="history-chart-day" key={item.date} title={`${item.date}: ${item.tasksCompleted} tasks completed, ${item.habitsChecked} habits checked`}><span>{item.tasksCompleted}</span><div className="history-bar-track"><i style={{ height: `${Math.min(100, Math.max(3, item.tasksCompleted * 20))}%` }} /></div><small>{item.date.slice(5)}</small></div>)}</div><div className="history-legend"><span>Daily tasks completed</span><span>Habit check-ins are in each day’s record</span></div></section>
        <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">LATEST FIRST</span><h2>Activity ledger · {data.activityLog.length}</h2></div><button className="button-danger" onClick={resetAllRecords}>RESET ALL RECORDS</button></div>
          {data.activityLog.length ? <div className="activity-list">{data.activityLog.map(event => <article className="activity-row" key={event.id}><time>{formatDateTime(event.at)}</time><div><strong>{event.title}</strong>{event.details && <p>{event.details}</p>}</div><span>{event.kind.replaceAll("_", " ")}</span></article>)}</div> : <div className="empty-state compact"><span>Records will appear here as you add goals, check habits, and complete tasks.</span></div>}
        </section>
      </div>}

      <footer className="goal-footer"><span>{databaseReady ? "SAVED ON THIS DEVICE" : "LOADING YOUR TRACKER…"}</span><span>{session ? "CLOUD BACKUP ACTIVE" : "LOCAL TRACKER · ACCOUNT OPTIONAL"}</span></footer>
    </main>
  );
}
