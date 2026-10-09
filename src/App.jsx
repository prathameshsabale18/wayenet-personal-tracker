import React, { useState, useEffect } from "react";
import { clearProductState, loadProductState } from "./database";
import { cloudConfigured, loadCloudProductState, saveCloudProductState, supabase } from "./cloudDatabase";
import "./App.css";

// ==========================================
// 1. LOCAL PRODUCT PERSISTENCE
// ==========================================
const ROUTINE_VERSION = 5;

function getDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getScheduledBlock(schedule, currentMinutes) {
  return schedule.find(block => {
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    return end <= start
      ? currentMinutes >= start || currentMinutes < end
      : currentMinutes >= start && currentMinutes < end;
  }) || null;
}

function getInitialProductState(defaultState) {
  return {
    appData: normalizeAppData(defaultState),
    routineVersion: ROUTINE_VERSION,
    dayKey: getDayKey(),
    history: {},
    activityLog: [],
    streak: 0,
    lastCompletedDay: null
  };
}

// ==========================================
// 2. DEFAULT SYSTEM DATA & PHILOSOPHY
// ==========================================
const DETECTIVE_QUOTES = [
  { quote: "Life's barely long enough to get good at one thing. So be careful what you get good at.", ref: "COHLE // DEDUCTION" },
  { quote: "It's not who I am underneath, but what I do that defines me.", ref: "BATMAN // RESOLVE" },
  { quote: "Time is a flat circle. Everything you skip will punish you again.", ref: "CYCLE // AUDIT" },
  { quote: "The world only makes sense if you force it to.", ref: "VIGILANCE // DIRECTIVE" }
];

const DAILY_SCHEDULE = [
  { start: "00:30", end: "06:30", label: "SLEEP", actions: ["Sleep."] },
  { start: "06:30", end: "06:45", label: "WAKE UP + PRAYER", actions: ["Wake up and pray."] },
  { start: "06:45", end: "08:00", label: "WORKOUT", actions: ["Complete the planned workout."] },
  { start: "08:00", end: "08:30", label: "BATH + BREAKFAST", actions: ["Bathe and eat breakfast."] },
  { start: "08:30", end: "09:30", label: "PAGEFIX — SERIOUS WORK", actions: ["Focused PageFix work."] },
  { start: "09:30", end: "10:00", label: "PYTHON CLASS PREPARATION", actions: ["Prepare for Python class."] },
  { start: "10:00", end: "12:00", label: "PYTHON CLASS", actions: ["Attend Python class."] },
  { start: "12:00", end: "12:30", label: "LUNCH", actions: ["Have lunch."] },
  { start: "12:30", end: "18:00", label: "FLEXIBLE BUFFER", actions: ["Prioritize family business; otherwise work on academics, Python practice, or pending work."] },
  { start: "18:00", end: "20:00", label: "PAGEFIX — SALES & OUTREACH", actions: ["Focus on PageFix sales and outreach."] },
  { start: "20:00", end: "20:30", label: "DINNER", actions: ["Have dinner."] },
  { start: "20:30", end: "22:30", label: "PAGEFIX — CLIENT WORK & DELIVERY", actions: ["Complete PageFix client work and delivery."] },
  { start: "22:30", end: "00:00", label: "PENDING WORK, NEXT-DAY PLANNING & WIND-DOWN", actions: ["Finish pending work, plan tomorrow, and wind down."] },
  { start: "00:00", end: "00:30", label: "GET READY FOR SLEEP", actions: ["Get ready for sleep."] }
];

const SUGGESTION_LIBRARY = [
  { category: "MONEY", text: "Find 5 qualified PageFix prospects and record their biggest problem." },
  { category: "MONEY", text: "Follow up with every potential client whose follow-up is due." },
  { category: "MONEY", text: "Send 5 personalized outreach messages." },
  { category: "MONEY", text: "Improve one part of your offer to make its value clearer." },
  { category: "MONEY", text: "Spend 20 minutes removing one bottleneck in your sales process." },
  { category: "MONEY", text: "Review your expenses and identify one unnecessary cost." },
  { category: "MONEY", text: "Create one portfolio asset that helps convert prospects." },
  { category: "MONEY", text: "Review your pipeline and define the next action for every warm lead." },
  { category: "CAREER", text: "Complete 5 Python problems without looking at solutions." },
  { category: "CAREER", text: "Build one small feature in your current technical project." },
  { category: "CAREER", text: "Spend 20 minutes revising a difficult Python concept." },
  { category: "ACADEMICS", text: "Finish one pending topic or assignment before starting something new." },
  { category: "ACADEMICS", text: "Complete 10 practice questions from a weak topic." },
  { category: "BODY", text: "Complete your scheduled training without unnecessary distractions." },
  { category: "BODY", text: "Practice MMA footwork or shadowboxing for 15 minutes when appropriate." },
  { category: "BODY", text: "Record your strength progress or weekly physique measurements." },
  { category: "BODY", text: "Complete 15 minutes of mobility on a recovery day." },
  { category: "FASTING", text: "Finish your last meal by 7 PM when practical." },
  { category: "FASTING", text: "Avoid unplanned late-night snacking after your final meal." },
  { category: "FASTING", text: "Maintain a consistent overnight eating window without compromising recovery." },
  { category: "DISCIPLINE", text: "Keep your phone away during the next focused work block." },
  { category: "DISCIPLINE", text: "Complete your most avoided important task before optional work." },
  { category: "DISCIPLINE", text: "Prepare tomorrow's top 3 priorities before ending the day." },
  { category: "DISCIPLINE", text: "Remove one distraction from your work environment." },
  { category: "SPIRITUALITY", text: "Read Hanuman Chalisa with attention rather than rushing through it." },
  { category: "SPIRITUALITY", text: "Spend 10 minutes in prayer or meditation." },
  { category: "SPIRITUALITY", text: "Perform one useful act of service without expecting a reward." },
  { category: "FAMILY BUSINESS", text: "Resolve one pending family-business task if any exists." },
  { category: "FAMILY BUSINESS", text: "Organize one invoice, record, or operational process if needed." },
  { category: "FINANCE", text: "Record today's income and expenses accurately." },
  { category: "FINANCE", text: "Calculate the remaining savings needed for your next purchase." },
  { category: "REVIEW", text: "Identify the biggest waste of time from today and eliminate it tomorrow." },
  { category: "REVIEW", text: "Review this week's results and choose one measurable improvement." }
];

const DEFAULT_STATE = {
  goals: [],
  weekdayRoutine: DAILY_SCHEDULE,
  weekendRoutine: DAILY_SCHEDULE,
  routineSchedule: DAILY_SCHEDULE,
  dailyTasks: [],
  backlog: [],
  remindersSent: [],
  nonNegotiables: [],
  behaviorRules: [
    { id: "br-social", text: "NO MAIN SOCIAL MEDIA ON PHONE — ONLY FOR POSTING / WORK", done: false },
    { id: "br-caffeine", text: "NO TEA / COFFEE IN THE MORNING", done: false },
    { id: "br-porn", text: "NO PORNOGRAPHY / NO FAP", done: false },
    { id: "br-movies", text: "NO MOVIES ON WEEKDAYS — WEEKENDS ONLY", done: false }
  ],
  alarms: [],
  distractions: []
};

function normalizeAppData(data, resetRoutine = false) {
  const base = DEFAULT_STATE;
  return {
    ...base,
    ...data,
    goals: [],
    weekdayRoutine: resetRoutine ? DAILY_SCHEDULE : Array.isArray(data?.weekdayRoutine) ? data.weekdayRoutine : DAILY_SCHEDULE,
    weekendRoutine: resetRoutine ? DAILY_SCHEDULE : Array.isArray(data?.weekendRoutine) ? data.weekendRoutine : DAILY_SCHEDULE,
    routineSchedule: resetRoutine ? DAILY_SCHEDULE : Array.isArray(data?.weekdayRoutine) ? data.weekdayRoutine : DAILY_SCHEDULE,
    dailyTasks: Array.isArray(data?.dailyTasks) ? data.dailyTasks.map(task => ({
      ...task,
      category: task.category || "goal",
      punishment: task.punishment || "Complete the escalating accountability consequence while this task is open."
    })) : [],
    backlog: Array.isArray(data?.backlog) ? data.backlog.map(task => {
      const savedCarryTime = typeof task.carriedAt === "number" ? task.carriedAt : Date.parse(task.carriedAt);
      return {
        ...task,
        carriedAt: savedCarryTime || (task.dueDate ? new Date(`${task.dueDate}T00:00:00`).getTime() : Date.now())
      };
    }) : [],
    remindersSent: Array.isArray(data?.remindersSent) ? data.remindersSent : [],
    nonNegotiables: [],
    alarms: [],
    behaviorRules: Array.isArray(data?.behaviorRules)
      ? base.behaviorRules.map(rule => ({
          ...rule,
          done: Boolean(data.behaviorRules.find(saved => saved.id === rule.id)?.done)
        }))
      : base.behaviorRules,
    behaviorReviewDate: data?.behaviorReviewDate || null,
    distractions: Array.isArray(data?.distractions) ? data.distractions : []
  };
}

function getBacklogConsequence(task, now = Date.now()) {
  const carriedAt = Number(task.carriedAt) || now;
  const elapsedMs = Math.max(0, now - carriedAt);
  const level = Math.floor(elapsedMs / 86_400_000);
  const nextEscalationAt = carriedAt + (level + 1) * 86_400_000;
  return {
    level,
    physicalMinutes: Math.min(10 + level * 5, 30),
    mentalMinutes: Math.min(10 + level * 10, 60),
    hoursUntilEscalation: Math.max(1, Math.ceil((nextEscalationAt - now) / 3_600_000))
  };
}

// ==========================================
// 3. MAIN COMPONENT
// ==========================================
export default function WaynenetApp() {
  const initialProductState = getInitialProductState(DEFAULT_STATE);

  // PRODUCT STATE
  const [appData, setAppData] = useState(initialProductState.appData);
  const [dayKey, setDayKey] = useState(initialProductState.dayKey);
  const [history, setHistory] = useState(initialProductState.history);
  const [activityLog, setActivityLog] = useState(initialProductState.activityLog || []);
  const [streak, setStreak] = useState(initialProductState.streak);
  const [lastCompletedDay, setLastCompletedDay] = useState(initialProductState.lastCompletedDay);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [session, setSession] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(cloudConfigured ? "CONNECTING" : "NOT CONFIGURED");
  const [cloudError, setCloudError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // ROUTINE EDITOR MODAL STATE
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newBlock, setNewBlock] = useState({ start: "", end: "", label: "", actions: "" });
  const [editingBlockIndex, setEditingBlockIndex] = useState(null);
  const [routineDay, setRoutineDay] = useState("weekday");

  // NAVIGATION & CLOCK STATES
  const [activeTab, setActiveTab] = useState("docket");
  const [currentTimeStr, setCurrentTimeStr] = useState(new Date().toLocaleTimeString());
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [activeWindowLabel, setActiveWindowLabel] = useState("WAITING");
  const [activeScheduleBlock, setActiveScheduleBlock] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  // FORM INPUT STATES
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("goal");
  const [dailyTaskPanel, setDailyTaskPanel] = useState("add");

  const applyProductState = (stored) => {
    if (!stored?.appData) return null;
    const needsRoutineReset = stored.routineVersion !== ROUTINE_VERSION;
    const oldActivity = Array.isArray(stored.activityLog) ? stored.activityLog : [];
    const historyHasProgress = Object.values(stored.history || {}).some(day => Number(day?.total) > 0 || Number(day?.disciplineDone) > 0 || Number(day?.backlogDone) > 0 || day?.disciplineReviewed);
    const hasStartedProgress = Boolean(stored.appData.dailyTasks?.some(task => task.done) || stored.appData.behaviorRules?.some(rule => rule.done) || stored.appData.backlog?.some(task => task.done) || historyHasProgress || oldActivity.some(entry => ["task_completed", "discipline_completed", "discipline_reviewed", "backlog_completed", "day_completed"].includes(entry.kind)));
    const hasCompletedDay = oldActivity.some(entry => entry.kind === "day_completed") || Object.values(stored.history || {}).some(day => Number(day?.total) > 0 && Number(day?.completed) >= Number(day.total));
    const savedHistory = needsRoutineReset || !hasStartedProgress ? {} : Object.fromEntries(Object.entries(stored.history || {}).map(([date, day]) => {
      const { routineDone, routineTotal, pointsEarned, ...cleanDay } = day || {};
      return [date, cleanDay];
    }));
    const normalized = {
      ...stored,
      appData: normalizeAppData(stored.appData, needsRoutineReset),
      routineVersion: ROUTINE_VERSION,
      history: savedHistory,
      activityLog: (hasStartedProgress ? oldActivity : []).filter(entry =>
        !["routine_completed", "routine_reopened", "points_earned"].includes(entry.kind)
      ),
      streak: needsRoutineReset || !hasCompletedDay ? 0 : Number(stored.streak) || 0,
      lastCompletedDay: needsRoutineReset || !hasCompletedDay ? null : stored.lastCompletedDay || null
    };
    setAppData(normalized.appData);
    setDayKey(normalized.dayKey || getDayKey());
    setHistory(normalized.history);
    setActivityLog(normalized.activityLog);
    setStreak(normalized.streak);
    setLastCompletedDay(normalized.lastCompletedDay);
    return normalized;
  };

  const connectAccount = async (nextSession) => {
    if (!nextSession?.user?.id) throw new Error("Sign-in did not return an account session.");
    const localState = await loadProductState();
    const localSnapshot = localState?.appData
      ? localState
      : { appData, routineVersion: ROUTINE_VERSION, dayKey, history, activityLog, streak, lastCompletedDay };
    const remoteState = await loadCloudProductState(nextSession.user.id);
    if (remoteState) {
      applyProductState(remoteState);
    } else {
      await saveCloudProductState(nextSession.user.id, localSnapshot);
      applyProductState(localSnapshot);
    }
    await clearProductState();
    setSession(nextSession);
    setCloudError("");
    setCloudStatus("SYNCED");
    setCloudReady(true);
    setDatabaseReady(true);
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (!cloudConfigured || !supabase) {
        setCloudStatus("NOT CONFIGURED");
        setCloudError("Set the Supabase project URL and publishable key, then restart the app.");
        return;
      }

      let nextSession;
      try {
        const current = await supabase.auth.getSession();
        if (current.error) throw current.error;
        nextSession = current.data.session;
        if (nextSession?.user?.is_anonymous) {
          await supabase.auth.signOut();
          nextSession = null;
        }
        if (!nextSession) {
          setCloudStatus("SIGN IN REQUIRED");
          return;
        }
        await connectAccount(nextSession);
      } catch (error) {
        if (cancelled) return;
        setSession(null);
        setCloudError(error.message || "Could not load this account's tracker data.");
        setCloudStatus("CLOUD ERROR");
        setCloudReady(false);
      }
    };

    initialize().catch(error => {
      if (cancelled) return;
      console.error("WAYNENET local database read error:", error);
      setCloudError(error.message || "Could not migrate existing tracker records to Supabase.");
      setCloudStatus("CLOUD ERROR");
      setCloudReady(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!supabase || authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      });
      if (error) throw error;
      await connectAccount(data.session);
      setAuthPassword("");
    } catch (error) {
      setAuthError(error.message || "Sign-in failed. Check your email and password.");
      setCloudStatus("SIGN IN FAILED");
    } finally {
      setAuthBusy(false);
    }
  };

  // Persist tracker state only in Supabase.
  useEffect(() => {
    if (!databaseReady || !session || !cloudReady) return;
    const snapshot = {
      appData,
      routineVersion: ROUTINE_VERSION,
      dayKey,
      history,
      activityLog,
      streak,
      lastCompletedDay
    };
    const saveTimer = setTimeout(() => {
      setCloudStatus("SAVING");
      saveCloudProductState(session.user.id, snapshot)
        .then(() => { setCloudError(""); setCloudStatus("SYNCED"); })
        .catch(error => { setCloudError(error.message || "Automatic cloud backup failed."); setCloudStatus("CLOUD ERROR"); });
    }, 500);
    return () => clearTimeout(saveTimer);
  }, [appData, dayKey, history, activityLog, streak, lastCompletedDay, databaseReady, session, cloudReady]);

  const recordProgress = (kind, title, details = "") => {
    const entry = {
      id: `progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      day: getDayKey(),
      kind,
      title,
      details
    };
    setActivityLog(previous => [entry, ...previous]);
  };

  const getRoutineBlockKey = block => block.id || `${block.start}|${block.end}|${block.label}`;
  const getRoutineLabel = routineId => [...appData.weekdayRoutine, ...appData.weekendRoutine]
    .find(block => getRoutineBlockKey(block) === routineId)?.label || routineId;
  const getTodayProgress = () => {
    const total = appData.dailyTasks.length;
    const completed = appData.dailyTasks.filter(task => task.done).length;
    return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
  };

  const getMissedDailyTasks = (data, dueDate) => data.dailyTasks
    .filter(task => !task.done)
    .map(task => ({
      ...task,
      id: `backlog-${task.id}-${dueDate}`,
      sourceTaskId: task.id,
      dueDate,
      done: false,
      carriedAt: Date.now(),
      punishment: task.punishment || "Complete the escalating accountability consequence while this task is open."
    }));

  const archiveCurrentDay = (currentDayKey, currentData, currentHistory) => {
    const completed = currentData.dailyTasks.filter(task => task.done).length;
    const total = currentData.dailyTasks.length;

    const progress = {
      date: currentDayKey,
      completed,
      total,
      percent: total ? Math.round((completed / total) * 100) : 0,
      dailyTasksCompleted: currentData.dailyTasks.filter(task => task.done).length,
      missedGoals: currentData.dailyTasks.filter(task => !task.done).map(task => task.text),
      auditStatus: currentData.dailyTasks.some(task => !task.done) ? "MISSED ITEMS RECORDED" : "CLEAR",
      disciplineDone: currentData.behaviorRules.filter(rule => rule.done).length,
      disciplineTotal: currentData.behaviorRules.length,
      disciplineRules: currentData.behaviorRules.map(rule => ({ id: rule.id, text: rule.text, done: Boolean(rule.done) })),
      disciplineReviewed: currentData.behaviorReviewDate === currentDayKey,
      taskList: currentData.dailyTasks.map(task => ({ text: task.text, done: Boolean(task.done), routineId: task.routineId || null })),
      backlogDone: currentData.backlog.filter(task => task.done && task.resolvedAt && getDayKey(new Date(task.resolvedAt)) === currentDayKey).length,
      backlogTotal: currentData.backlog.length,
      savedAt: Date.now()
    };

    return { ...currentHistory, [currentDayKey]: progress };
  };

  // DAILY CYCLE, LIVE ROUTINE, AND TIME-BASED REMINDERS
  useEffect(() => {
    const updateDashboard = () => {
      const now = new Date();
      const todayKey = getDayKey(now);
      const time = now.getHours() * 60 + now.getMinutes();
      setCurrentTimeStr(now.toLocaleTimeString());
      if (!databaseReady) return;

      if (todayKey !== dayKey) {
        recordProgress("day_archived", "Daily progress archived", `${dayKey}: ${appData.dailyTasks.filter(task => task.done).length}/${appData.dailyTasks.length} tasks completed.`);
        const updatedHistory = archiveCurrentDay(dayKey, appData, history);
        setHistory(updatedHistory);
        setAppData(prev => ({
          ...prev,
          dailyTasks: [],
          backlog: [...prev.backlog, ...getMissedDailyTasks(prev, todayKey)],
          remindersSent: prev.remindersSent.filter(reminder => reminder.startsWith(`${todayKey}:`)),
          behaviorRules: prev.behaviorRules.map(rule => ({ ...rule, done: false })),
          behaviorReviewDate: null,
          distractions: []
        }));
        setDayKey(todayKey);
      }

      const schedule = now.getDay() === 0 || now.getDay() === 6
        ? appData.weekendRoutine
        : appData.weekdayRoutine;
      const currentBlock = getScheduledBlock(schedule, time);
      setActiveScheduleBlock(currentBlock);
      setActiveWindowLabel(currentBlock
        ? `${currentBlock.start}–${currentBlock.end} // ${currentBlock.label}`
        : "NO SCHEDULED BLOCK");
      const startingBlocks = schedule.filter(block => timeToMinutes(block.start) === time);
      if (notificationPermission === "granted" && startingBlocks.length > 0) {
        const reminderId = `${todayKey}:routine:${time}`;
        if (!appData.remindersSent.includes(reminderId)) {
          new Notification(startingBlocks[0].label, {
            body: startingBlocks.flatMap(block => [block.label, ...(block.actions || [])]).join(" ")
          });
          setAppData(prev => ({ ...prev, remindersSent: [...prev.remindersSent, reminderId] }));
        }
      }

      if (notificationPermission === "granted") {
        appData.dailyTasks.forEach(task => {
          if (task.done || !task.deadline || time !== timeToMinutes(task.deadline)) return;
          const reminderId = `${todayKey}:goal:${task.id}`;
          if (appData.remindersSent.includes(reminderId)) return;
          new Notification(task.text, { body: `Scheduled for now. ${task.category === "microgoal" ? "Microgoal" : "Goal"}` });
          setAppData(prev => ({ ...prev, remindersSent: [...prev.remindersSent, reminderId] }));
        });
      }
    };

    updateDashboard();
    const timer = setInterval(updateDashboard, 1000);
    return () => clearInterval(timer);
  }, [dayKey, appData, history, notificationPermission, databaseReady]);

  // AUTOMATIC QUOTE ROTATION — 4.5 SECONDS
  useEffect(() => {
    const quoteTimer = setInterval(() => {
      setQuoteIdx(prev => (prev + 1) % DETECTIVE_QUOTES.length);
    }, 4500);
    return () => clearInterval(quoteTimer);
  }, []);

  // HANDLERS FOR TASK & ROUTINE UPDATES
  const toggleDailyTask = (id) => {
    const task = appData.dailyTasks.find(item => item.id === id);
    if (task) {
      recordProgress(task.done ? "task_reopened" : "task_completed", task.text, task.done ? "Marked incomplete" : "Completed");
    }
    setAppData(prev => ({ ...prev, dailyTasks: prev.dailyTasks.map(t => t.id === id ? { ...t, done: !t.done } : t) }));
  };

  const addTaskToTracker = (text, routineId = "") => {
    if (!text.trim()) return;
    const newTask = {
      id: `task_${Date.now()}`,
      text: text.trim(),
      deadline: "Anytime",
      category: newTaskCategory,
      routineId: routineId || null,
      punishment: "Complete the escalating accountability consequence while this task is open.",
      createdAt: Date.now(),
      done: false
    };
    recordProgress("task_added", newTask.text, routineId ? `Daily task added · routine reference: ${getRoutineLabel(routineId)}` : "Daily task added");
    setAppData(prev => ({ ...prev, dailyTasks: [...prev.dailyTasks, newTask] }));
    return newTask;
  };

  const addDailyTask = () => {
    const task = addTaskToTracker(newTaskText);
    if (!task) return;
    setNewTaskText("");
    setNewTaskCategory("goal");
  };

  const removeDailyTask = (id, e) => {
    e.stopPropagation();
    const task = appData.dailyTasks.find(item => item.id === id);
    if (task) recordProgress("task_removed", task.text, "Removed from today's tasks");
    setAppData(prev => ({ ...prev, dailyTasks: prev.dailyTasks.filter(t => t.id !== id) }));
  };

  const toggleBehaviorRule = (id) => {
    if (appData.behaviorReviewDate === dayKey) return;
    setAppData(prev => ({
      ...prev,
      behaviorRules: prev.behaviorRules.map(rule =>
        rule.id === id ? { ...rule, done: !rule.done } : rule
      )
    }));
  };

  const saveBehaviorReview = () => {
    if (appData.behaviorReviewDate === dayKey) return;
    const keptRules = appData.behaviorRules.filter(rule => rule.done);
    keptRules.forEach(rule => {
      recordProgress("discipline_completed", rule.text, "Kept for the full day; confirmed in end-of-day review.");
    });
    recordProgress("discipline_reviewed", "End-of-day rule review saved", `${keptRules.length}/${appData.behaviorRules.length} non-negotiables kept.`);
    setAppData(prev => ({ ...prev, behaviorReviewDate: dayKey }));
    setHistory(prev => ({
      ...prev,
      [dayKey]: {
        ...(prev[dayKey] || {}),
        date: dayKey,
        completed: todayProgress.completed,
        total: todayProgress.total,
        percent: todayProgress.percent,
        disciplineDone: keptRules.length,
        disciplineTotal: appData.behaviorRules.length,
        disciplineRules: appData.behaviorRules.map(rule => ({ ...rule, done: Boolean(rule.done) })),
        disciplineReviewed: true,
        backlogDone: completedBacklogCount,
        backlogTotal: appData.backlog.length,
        savedAt: Date.now()
      }
    }));
  };

  const getEditorSchedule = () => routineDay === "weekend" ? appData.weekendRoutine : appData.weekdayRoutine;

  const saveEditorSchedule = (schedule) => {
    const sorted = [...schedule].sort((a, b) => a.start.localeCompare(b.start));
    setAppData(prev => routineDay === "weekend"
      ? { ...prev, weekendRoutine: sorted }
      : { ...prev, weekdayRoutine: sorted, routineSchedule: sorted });
    recordProgress("routine_updated", `${routineDay === "weekend" ? "Weekend" : "Weekday"} routine updated`, `${sorted.length} routine blocks saved.`);
  };

  const handleSaveBlock = () => {
    if (!newBlock.label || !newBlock.start || !newBlock.end) return;
    const actionsArray = newBlock.actions.split("\n").map(a => a.trim()).filter(Boolean);
    const schedule = getEditorSchedule();
    const original = editingBlockIndex === null ? null : schedule[editingBlockIndex];
    const block = {
      id: original ? (original.id || getRoutineBlockKey(original)) : `routine_${Date.now()}`,
      start: newBlock.start,
      end: newBlock.end,
      label: newBlock.label.trim(),
      actions: actionsArray
    };
    const updated = editingBlockIndex === null
      ? [...schedule, block]
      : schedule.map((item, index) => index === editingBlockIndex ? block : item);
    saveEditorSchedule(updated);
    setNewBlock({ start: "", end: "", label: "", actions: "" });
    setEditingBlockIndex(null);
  };

  const handleEditBlock = (index) => {
    const block = getEditorSchedule()[index];
    setNewBlock({ start: block.start, end: block.end, label: block.label, actions: (block.actions || []).join("\n") });
    setEditingBlockIndex(index);
  };

  const handleDeleteBlock = (index) => {
    saveEditorSchedule(getEditorSchedule().filter((_, i) => i !== index));
    if (editingBlockIndex === index) {
      setEditingBlockIndex(null);
      setNewBlock({ start: "", end: "", label: "", actions: "" });
    }
  };

  const handleResetCycle = () => {
    if (window.confirm("START A FRESH DAILY CYCLE? TODAY'S CURRENT PROGRESS WILL BE ARCHIVED.")) {
      const todayKey = getDayKey();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowKey = getDayKey(tomorrow);
      recordProgress("cycle_reset", "Daily cycle reset", `Progress for ${todayKey} archived.`);
      setHistory(prev => archiveCurrentDay(todayKey, appData, prev));
      setAppData(prev => ({
        ...prev,
        dailyTasks: [],
        backlog: [...prev.backlog, ...getMissedDailyTasks(prev, tomorrowKey)],
        behaviorRules: prev.behaviorRules.map(rule => ({ ...rule, done: false })),
        behaviorReviewDate: null,
        distractions: []
      }));
    }
  };

  const handlePurgeAll = () => {
    if (window.confirm("PURGE ALL DAILY DOCKET TASKS?")) {
      recordProgress("tasks_purged", "Daily tasks cleared", `${appData.dailyTasks.length} tasks removed.`);
      setAppData(prev => ({ ...prev, dailyTasks: [], distractions: [] }));
    }
  };

  // DAILY AUDIT / RECOVERY COMPUTATION
  const todayClock = new Date();

  const openBacklog = appData.backlog.filter(task => !task.done);
  const totalPenalties = openBacklog.length;
  const todayProgress = getTodayProgress();
  const allCoreComplete = todayProgress.total > 0 && todayProgress.completed === todayProgress.total;
  const todaysRoutine = todayClock.getDay() === 0 || todayClock.getDay() === 6
    ? appData.weekendRoutine
    : appData.weekdayRoutine;
  const suggestionDaySeed = Math.floor(new Date(`${dayKey}T12:00:00`).getTime() / 86400000);
  const suggestionStart = suggestionDaySeed % SUGGESTION_LIBRARY.length;
  const dailySuggestions = Array.from({ length: 6 }, (_, index) =>
    SUGGESTION_LIBRARY[(suggestionStart + index) % SUGGESTION_LIBRARY.length]
  );
  const completedBacklogCount = appData.backlog.filter(task => task.done && task.resolvedAt && getDayKey(new Date(task.resolvedAt)) === dayKey).length;

  const hasTodayProgress = todayProgress.completed > 0 || completedBacklogCount > 0 || appData.behaviorReviewDate === dayKey;
  const progressDays = Object.values({
    ...history,
    ...(hasTodayProgress ? { [dayKey]: {
      ...(history[dayKey] || {}),
      date: dayKey,
      completed: todayProgress.completed,
      total: todayProgress.total,
      percent: todayProgress.percent,
      disciplineDone: appData.behaviorRules.filter(rule => rule.done).length,
      disciplineTotal: appData.behaviorRules.length,
      disciplineRules: appData.behaviorRules.map(rule => ({ id: rule.id, text: rule.text, done: Boolean(rule.done) })),
      disciplineReviewed: appData.behaviorReviewDate === dayKey,
      backlogDone: completedBacklogCount,
      backlogTotal: appData.backlog.length,
    } } : {})
  }).sort((a, b) => a.date.localeCompare(b.date));
  const recentDays = progressDays.slice(-14);
  const taskDays = recentDays.filter(day => Number(day.total) > 0);
  const reviewedDays = recentDays.filter(day => day.disciplineReviewed);
  const recentAverage = taskDays.length
    ? Math.round(taskDays.reduce((sum, day) => sum + (Number(day.percent) || 0), 0) / taskDays.length)
    : 0;
  const progressSuggestions = [
    ...(openBacklog.length ? [`Work on the oldest carried task first: “${openBacklog[0].text}”.`] : []),
    ...(todayProgress.total > 0 && todayProgress.completed < todayProgress.total ? [`Complete the ${todayProgress.total - todayProgress.completed} remaining daily task${todayProgress.total - todayProgress.completed === 1 ? "" : "s"} before adding more.`] : []),
    ...(taskDays.length >= 3 && recentAverage < 70 ? ["Recent completion is below 70%. Plan fewer tasks, then finish the highest priority item first."] : []),
    ...(taskDays.length >= 3 && recentAverage >= 85 ? ["Your recent completion is strong. Keep the routine steady and raise the challenge gradually."] : []),
    ...(appData.behaviorReviewDate !== dayKey ? ["When your day is finished, review the four non-negotiables to record which you kept."] : []),
    ...(!recentDays.length ? ["No progress history yet. Add daily tasks, then record completions as you go."] : [])
  ];

  const exportProgressRecords = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      activityLog,
      dailyHistory: progressDays,
      currentStreak: streak,
      currentTasks: appData.dailyTasks,
      backlogTasks: appData.backlog,
      disciplineRules: appData.behaviorRules
    };
    const file = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waynenet-progress-${getDayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleBacklogTask = (taskId) => {
    const task = appData.backlog.find(item => item.id === taskId);
    if (!task || task.done) return;
    recordProgress("backlog_completed", task.text, "Required carried task completed.");
    setAppData(prev => ({
      ...prev,
      backlog: prev.backlog.map(task => task.id === taskId
        ? { ...task, done: true, resolvedAt: Date.now() }
        : task)
    }));
  };

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    setNotificationPermission(await Notification.requestPermission());
  };

  // Update streak once per completed day.
  useEffect(() => {
    if (!databaseReady || !allCoreComplete || lastCompletedDay === dayKey) return;

    const previousDay = new Date();
    previousDay.setDate(previousDay.getDate() - 1);
    const previousKey = getDayKey(previousDay);
    const nextStreak = lastCompletedDay === previousKey ? streak + 1 : 1;

    setStreak(nextStreak);
    setLastCompletedDay(dayKey);
    recordProgress("day_completed", "All daily tasks completed", `Daily completion: ${todayProgress.completed}/${todayProgress.total}.`);
    setHistory(prev => ({
      ...prev,
      [dayKey]: {
        ...(prev[dayKey] || {}),
        date: dayKey,
        completed: todayProgress.completed,
        total: todayProgress.total,
        percent: 100,
        dailyTasksCompleted: appData.dailyTasks.filter(task => task.done).length,
        disciplineDone: appData.behaviorRules.filter(rule => rule.done).length,
        disciplineTotal: appData.behaviorRules.length,
        disciplineRules: appData.behaviorRules.map(rule => ({ id: rule.id, text: rule.text, done: Boolean(rule.done) })),
        taskList: appData.dailyTasks.map(task => ({ text: task.text, done: Boolean(task.done), routineId: task.routineId || null })),
        backlogDone: completedBacklogCount,
        backlogTotal: appData.backlog.length,
        savedAt: Date.now()
      }
    }));
  }, [allCoreComplete, dayKey, lastCompletedDay, streak, todayProgress.completed, todayProgress.total, appData.dailyTasks, databaseReady]);

  if (!cloudConfigured || !supabase || !cloudReady || !databaseReady || !session) {
    return (
      <div className="waynet-container cloud-access-page">
        <section className="hud-panel cloud-access-panel">
          <div className="hud-panel-title"><span>WAYNENET // DATABASE</span><span className="badge-red">{cloudStatus}</span></div>
          <h2>Private tracker sign in</h2>
          {!cloudConfigured || !supabase ? <p>{cloudError || "Set the Supabase project URL and publishable key, then restart the app."}</p> : <>
            <p>Sign in with the email and password for your account. Tracker records are saved to that account in Supabase.</p>
            <form onSubmit={handleSignIn} style={{ display: "grid", gap: "12px", marginTop: "20px" }}>
              <label style={{ display: "grid", gap: "6px", color: "#aaa", fontSize: "0.8rem" }}>
                EMAIL
                <input className="input-field" type="email" autoComplete="username" required value={authEmail} onChange={event => setAuthEmail(event.target.value)} />
              </label>
              <label style={{ display: "grid", gap: "6px", color: "#aaa", fontSize: "0.8rem" }}>
                PASSWORD
                <input className="input-field" type="password" autoComplete="current-password" required value={authPassword} onChange={event => setAuthPassword(event.target.value)} />
              </label>
              {(authError || cloudError) && <p role="alert" className="cloud-sync-error">{authError || cloudError}</p>}
              <button className="btn-add" type="submit" disabled={authBusy}>{authBusy ? "SIGNING IN…" : "SIGN IN"}</button>
            </form>
            <p style={{ marginTop: "14px", fontSize: "0.75rem", color: "#777" }}>There is no public sign-up. Create your account in Supabase Authentication first.</p>
          </>}
        </section>
      </div>
    );
  }

  // ==========================================
  // 4. PRODUCT INTERFACE
  // ==========================================
  // ==========================================
  return (
    <div className="waynet-container">
      <div className="wayrust-wrapper">
        
        {/* HEADER */}
        <div className="waynet-header">
          <div className="logo-brand">
            <svg className="logo-icon" viewBox="0 0 48 48" role="img" aria-label="Waynenet emblem">
              <circle className="logo-ring" cx="24" cy="24" r="21" />
              <path className="logo-mark" d="M8 17l9 3 7-6 7 6 9-3-4 13-8-5-4 9-4-9-8 5z" />
              <path className="logo-core" d="M24 18l2.1 4.2 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" />
            </svg>
            <div>
              <h1 className="waynet-title">WAYNENET</h1>
              <div className="waynet-sub">PERSONAL HABIT TRACKER // DAILY ROUTINE</div>
            </div>
          </div>
          <div className="waynet-clock">{currentTimeStr}</div>
        </div>

        {/* PHILOSOPHY BANNER */}
        <div 
          className="philosophy-banner" 
          onClick={() => setQuoteIdx((quoteIdx + 1) % DETECTIVE_QUOTES.length)}
          style={{ userSelect: "none" }}
        >
          <div className="philosophy-quote">"{DETECTIVE_QUOTES[quoteIdx].quote}"</div>
          <div className="philosophy-tag">{DETECTIVE_QUOTES[quoteIdx].ref}</div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="nav-bar">
          <button className={`nav-tab ${activeTab === 'docket' ? 'active' : ''}`} onClick={() => setActiveTab('docket')}>
            01 // TRACKER
          </button>
          <button className={`nav-tab ${activeTab === 'backlog' ? 'active' : ''}`} onClick={() => setActiveTab('backlog')}>
            02 // BACKLOG ({openBacklog.length})
          </button>
          <button className={`nav-tab ${activeTab === 'pagefix' ? 'active' : ''}`} onClick={() => setActiveTab('pagefix')}>
            03 // RECORDS
          </button>
        </div>

        {/* TAB 1: DOCKET */}
        {activeTab === 'docket' && (
          <div>
            <div className="hud-panel" style={{ marginBottom: "12px" }}>
              <div className="hud-panel-title">
                <span>00.1 // DAILY STATUS</span>
                <span className="badge-red">{todayProgress.percent}%</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                <div style={{ background: "#0b0b0b", border: "1px solid #222", padding: "12px", textAlign: "center" }}>
                  <div style={{ color: "var(--c-red)", fontSize: "1.2rem", fontWeight: "800" }}>{streak}</div>
                  <div style={{ color: "#777", fontSize: "0.65rem", marginTop: "4px" }}>TASK STREAK</div>
                </div>
                <div style={{ background: "#0b0b0b", border: "1px solid #222", padding: "12px", textAlign: "center" }}>
                  <div style={{ color: "var(--c-red)", fontSize: "1.2rem", fontWeight: "800" }}>{progressDays.length}</div>
                  <div style={{ color: "#777", fontSize: "0.65rem", marginTop: "4px" }}>DAYS SAVED</div>
                </div>
                <div style={{ background: "#0b0b0b", border: "1px solid #222", padding: "12px", textAlign: "center" }}>
                  <div style={{ color: "var(--c-red)", fontSize: "1.2rem", fontWeight: "800" }}>{todayProgress.completed}/{todayProgress.total}</div>
                  <div style={{ color: "#777", fontSize: "0.65rem", marginTop: "4px" }}>DAILY TASKS</div>
                </div>
              </div>
            </div>

            {/* ACTIVE FOCUS BANNER */}
            <div
              className="hud-panel active-focus-panel"
              style={{ borderColor: "var(--c-red)", backgroundColor: "#0e0303" }}
            >
              <div className="hud-panel-title">
                <span style={{ color: "var(--c-red)", fontWeight: "bold" }}>01.0 // ACTIVE FOCUS</span>
                <span className="badge-red">{activeScheduleBlock ? "SCHEDULED NOW" : "NO ACTIVE BLOCK"}</span>
              </div>

              <div style={{ padding: "8px 0" }}>
                <div style={{ fontSize: "0.72rem", color: "#777", letterSpacing: "0.8px", marginBottom: "10px" }}>
                  {activeWindowLabel}
                </div>

                {activeScheduleBlock ? (
                  <>
                    <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#fff" }}>
                      CURRENT ACTION:{" "}
                      <span style={{ color: "var(--c-red)" }}>
                        {activeScheduleBlock.label}
                      </span>
                    </div>

                    {activeScheduleBlock?.actions?.length > 0 && (
                      <div style={{ marginTop: "10px", color: "#aaa", fontSize: "0.78rem", lineHeight: "1.5" }}>
                        {activeScheduleBlock.actions.join(" ")}
                      </div>
                    )}

                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "16px", color: "#888", fontWeight: "600" }}>
                    No scheduled activity right now.
                  </div>
                )}
              </div>
            </div>

            <div className="hud-panel" style={{ display: "none" }}>
              <div className="hud-panel-title">
                <span>01.05 // TODAY'S ROUTINE</span>
                <button className="btn-toggle" onClick={() => {
                  setRoutineDay(todayClock.getDay() === 0 || todayClock.getDay() === 6 ? "weekend" : "weekday");
                  setIsEditModalOpen(true);
                }}>EDIT ROUTINE</button>
              </div>
              {todaysRoutine.map(block => (
                <div key={`${block.start}-${block.label}`} className="alarm-row" style={{ gridTemplateColumns: "95px minmax(0, 1fr)", padding: "9px 12px" }}>
                  <span className="alarm-time">{block.start}–{block.end}</span>
                  <span className="alarm-label">{block.label}</span>
                </div>
              ))}
            </div>

            {/* DAILY TASKS AND CURATED SUGGESTIONS */}
            <div className="hud-panel">
              <div className="hud-panel-title">
                <span>Daily Task</span>
                <span className="badge-red">{appData.dailyTasks.filter(t => t.done).length}/{appData.dailyTasks.length} DAILY · {openBacklog.length} REQUIRED BACKLOG</span>
              </div>
              <div style={{ display: "flex", gap: "8px", margin: "12px 0" }}>
                <button type="button" className={`btn-toggle ${dailyTaskPanel === "add" ? "active" : ""}`} onClick={() => setDailyTaskPanel("add")}>ADD TASK</button>
                <button type="button" className={`btn-toggle ${dailyTaskPanel === "suggestions" ? "active" : ""}`} onClick={() => setDailyTaskPanel("suggestions")}>SUGGESTIONS</button>
              </div>

              {dailyTaskPanel === "add" ? <div className="goal-form-grid">
                <input type="text" className="input-field" placeholder="Daily task or habit..." value={newTaskText} onChange={event => setNewTaskText(event.target.value)} />
                <button className="btn-add" onClick={addDailyTask}>+ ADD</button>
              </div> : <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ border: "1px solid #292929", background: "#090909", padding: "14px", display: "grid", gap: "5px" }}>
                  <span style={{ color: "#aaa", fontSize: "0.7rem", letterSpacing: "0.7px" }}>FIRST 90 DAYS · PAGEFIX REVENUE</span>
                  <strong style={{ color: "#f04444", fontSize: "1.2rem" }}>₹6 lakh collected revenue</strong>
                  <span style={{ color: "#777", fontSize: "0.72rem" }}>Aggressive 90-day target</span>
                </div>
                <div style={{ borderTop: "1px solid #252525", paddingTop: "12px", color: "#aaa", fontSize: "0.72rem" }}>TODAY'S TASK PICKS · 6 AT A TIME · ROTATES DAILY</div>
                {dailySuggestions.map(suggestion => <div className="suggestion-card" key={`${suggestion.category}-${suggestion.text}`}>
                  <p style={{ flex: 1, color: "#ddd", lineHeight: 1.5, margin: 0 }}><small style={{ display: "block", marginBottom: "4px", color: "#f04444", letterSpacing: "0.6px" }}>{suggestion.category}</small>{suggestion.text}</p>
                  <button type="button" className="btn-toggle" disabled={appData.dailyTasks.some(task => task.text === suggestion.text && !task.done)} onClick={() => addTaskToTracker(suggestion.text)}>{appData.dailyTasks.some(task => task.text === suggestion.text && !task.done) ? "ADDED" : "ADD"}</button>
                </div>)}
              </div>}

              {appData.dailyTasks.length === 0 && openBacklog.length === 0 ? (
                <div style={{ fontSize: "0.78rem", color: "#666", padding: "16px 0", textAlign: "center", fontStyle: "italic" }}>
                  NO ACTIVE TASKS // ADD YOUR FIRST OPERATIONAL TASK ABOVE
                </div>
              ) : (
                appData.dailyTasks.map(task => {
                  return (
                    <div key={task.id} className={`checklist-item ${task.done ? 'done' : ''}`} onClick={() => toggleDailyTask(task.id)}>
                      <span className={`checkbox ${task.done ? 'checked' : ''}`} />
                      <span style={{ flex: 1 }}>{task.text}</span>
                      {task.routineId && <small className="badge-red" title={getRoutineLabel(task.routineId)}>ROUTINE ID · {task.routineId}</small>}
                      <button 
                        onClick={(e) => removeDailyTask(task.id, e)} 
                        style={{ marginLeft: "10px", color: "var(--c-red)", background: "none", border: "none", cursor: "pointer", fontWeight: "bold" }}>
                        ✕
                      </button>
                    </div>
                  );
                })
              )}

              {openBacklog.length > 0 && <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #333" }}>
                <div className="hud-panel-title" style={{ marginBottom: "10px" }}>
                  <span>REQUIRED BACKLOG // COMPLETE TO CLEAR</span>
                  <span className="badge-red">{openBacklog.length} CARRIED</span>
                </div>
                <p className="progress-storage-note" style={{ margin: "0 0 10px" }}>These tasks stay here until completed. They cannot be removed or reset.</p>
                <div style={{ display: "grid", gap: "8px" }}>
                  {openBacklog.map(task => {
                    const consequence = getBacklogConsequence(task);
                    return <div key={task.id} className="checklist-item backlog-required-item">
                      <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                        <input type="checkbox" checked={task.done} onChange={() => toggleBacklogTask(task.id)} />
                        <span style={{ flex: 1 }}>{task.text}</span>
                      </label>
                      <small className="punishment-meta">OVERDUE · LEVEL {consequence.level} · ESCALATES IN {consequence.hoursUntilEscalation}H</small>
                      <small className="punishment-meta">PHYSICAL: {consequence.physicalMinutes} MIN COMFORTABLE-PACE WALK</small>
                      <small className="punishment-meta">MENTAL: {consequence.mentalMinutes} MIN REFLECTION + FOCUSED WORK ON THIS TASK</small>
                    </div>;
                  })}
                </div>
              </div>}
            </div>

            <div className="hud-panel">
              <div className="hud-panel-title">
                <span>01.05 // TODAY'S ROUTINE</span>
                <button className="btn-toggle" onClick={() => {
                  setRoutineDay(todayClock.getDay() === 0 || todayClock.getDay() === 6 ? "weekend" : "weekday");
                  setIsEditModalOpen(true);
                }}>EDIT ROUTINE</button>
              </div>
              {todaysRoutine.map(block => <div key={getRoutineBlockKey(block)} className="alarm-row" style={{ gridTemplateColumns: "95px minmax(0, 1fr)", padding: "9px 12px" }}>
                <span className="alarm-time">{block.start}–{block.end}</span>
                <span className="alarm-label">{block.label}</span>
              </div>)}
            </div>

            {/* BEHAVIORAL RULES */}
            <div className="hud-panel" style={{ borderColor: "#333", backgroundColor: "#0b0b0b" }}>
              <div className="hud-panel-title">
                <span>01.3 // END-OF-DAY RULE REVIEW</span>
                <span className="badge-red" style={{ background: "#111", color: "#aaa", border: "1px solid #333" }}>
                  {appData.behaviorReviewDate === dayKey ? "REVIEW SAVED" : `${appData.behaviorRules.filter(rule => rule.done).length}/${appData.behaviorRules.length} SELECTED`}
                </span>
              </div>
              <p className="progress-storage-note" style={{ margin: "0 0 12px" }}>At the end of the day, mark each rule you kept and save the review.</p>
              <div style={{ display: "grid", gap: "6px" }}>
                {appData.behaviorRules.map(rule => (
                  <div
                    key={rule.id}
                    onClick={() => toggleBehaviorRule(rule.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "11px 12px",
                      background: rule.done ? "#111" : "#080808",
                      border: `1px solid ${rule.done ? "#333" : "#1f1f1f"}`,
                      borderLeft: `3px solid ${rule.done ? "#555" : "#222"}`,
                      borderRadius: "4px",
                      cursor: appData.behaviorReviewDate === dayKey ? "default" : "pointer",
                      opacity: rule.done ? 0.8 : 1,
                      transition: "all 0.15s ease"
                    }}
                  >
                    <span
                      style={{
                        width: "15px",
                        height: "15px",
                        minWidth: "15px",
                        border: `1px solid ${rule.done ? "#777" : "#444"}`,
                        background: rule.done ? "#777" : "transparent",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#000",
                        fontSize: "10px",
                        fontWeight: "900"
                      }}
                    >
                      {rule.done ? "✓" : ""}
                    </span>

                    <span
                      style={{
                        flex: 1,
                        color: rule.done ? "#777" : "#aaa",
                        fontSize: "0.72rem",
                        fontWeight: "600",
                        textDecoration: rule.done ? "line-through" : "none"
                      }}
                    >
                      {rule.text}
                    </span>

                    <span
                      style={{
                        color: rule.done ? "#666" : "#555",
                        fontSize: "0.62rem",
                        letterSpacing: "0.5px"
                      }}
                    >
                      {appData.behaviorReviewDate === dayKey ? (rule.done ? "KEPT" : "NOT KEPT") : (rule.done ? "KEPT" : "CHECK AT DAY END")}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-toggle" style={{ marginTop: "12px" }} onClick={saveBehaviorReview} disabled={appData.behaviorReviewDate === dayKey}>
                {appData.behaviorReviewDate === dayKey ? "DAILY REVIEW SAVED" : "SAVE END-OF-DAY REVIEW"}
              </button>
            </div>
            
            <div className="action-grid">
              <button className="btn-action" onClick={handleResetCycle}>RESET CYCLE FOR TOMORROW</button>
              <button className="btn-action" onClick={handlePurgeAll}>PURGE DOCKET TASKS</button>
            </div>
          </div>
        )}

        {/* BACKLOG */}
        {activeTab === 'backlog' && (
          <div>
            <div className="hud-panel">
              <div className="hud-panel-title">
                <span>02 // REQUIRED BACKLOG</span>
                <span className="badge-red">{totalPenalties} OPEN</span>
              </div>

              {totalPenalties === 0 ? (
                <div className="punishment-card" style={{ borderColor: "#222" }}>
                  <div className="punishment-title" style={{ color: "var(--c-white)" }}>BACKLOG CLEAR</div>
                  <div className="punishment-desc">Unfinished daily tasks carry over at midnight and stay on the homepage until completed.</div>
                </div>
              ) : (
                <div>
                  {appData.backlog.map(task => (
                    <div key={task.id} className="punishment-card">
                      <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: task.done ? "default" : "pointer" }}>
                        <input type="checkbox" checked={task.done} disabled={task.done} onChange={() => toggleBacklogTask(task.id)} />
                        <span>
                          <span className="punishment-title">BACKLOG // {task.dueDate} [{task.category === "microgoal" ? "MICROGOAL" : "GOAL"}]</span>
                          <span className="punishment-desc">{task.text}</span>
                          {task.routineId && <span className="punishment-meta" title={getRoutineLabel(task.routineId)}>ROUTINE ID: {task.routineId}</span>}
                          {task.done ? <span className="punishment-meta">COMPLETED · {task.resolvedAt ? new Date(task.resolvedAt).toLocaleString() : "DONE"}</span> : (() => {
                            const consequence = getBacklogConsequence(task);
                            return <>
                              <span className="punishment-meta">OVERDUE · LEVEL {consequence.level} · NEXT ESCALATION IN {consequence.hoursUntilEscalation}H</span>
                              <span className="punishment-meta">PHYSICAL: {consequence.physicalMinutes} MIN COMFORTABLE-PACE WALK</span>
                              <span className="punishment-meta">MENTAL: {consequence.mentalMinutes} MIN REFLECTION + FOCUSED WORK ON THIS TASK</span>
                            </>;
                          })()}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'pagefix' && (
          <div className="progress-workspace">
            <section className="hud-panel progress-overview">
              <div className="hud-panel-title">
                <span>PROGRESS RECORDS // TRACKER</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="badge-red">{cloudStatus}</span>
                  <button className="btn-toggle" onClick={exportProgressRecords}>EXPORT ALL RECORDS</button>
                </div>
              </div>
              <p className="progress-storage-note">Progress records are saved in the connected database. Use Export All Records to keep a separate copy.</p>
              {cloudError && <p className="cloud-sync-error">Database sync issue: {cloudError}. Sign in again and check the tracker_state table and row policies.</p>}
            </section>

            <section className="hud-panel">
              <div className="hud-panel-title"><span>PROGRESS TRENDS // LAST 14 DAYS</span><span className="badge-red">TASKS + RULE REVIEWS</span></div>
              {recentDays.length ? (
                <div className="progress-chart-grid">
                  <div className="progress-chart-card">
                    <h3>Daily task completion</h3>
                    {taskDays.length ? <div className="progress-bars" role="img" aria-label="Daily task completion percentages for the last fourteen days">
                      {taskDays.map(day => (
                        <div className="progress-bar-column" key={`tasks-${day.date}`} title={`${day.date}: ${day.percent}% (${day.completed}/${day.total})`}>
                          <span>{day.percent}%</span><div className="progress-bar-track"><i style={{ height: `${Math.max(Number(day.percent) || 0, 3)}%` }} /></div><small>{day.date.slice(5)}</small>
                        </div>
                      ))}
                    </div> : <p className="progress-empty">Task trends appear after you start completing daily tasks.</p>}
                  </div>
                  <div className="progress-chart-card">
                    <h3>Non-negotiables kept</h3>
                    <div className="progress-bars" role="img" aria-label="Daily discipline rule completion for the last fourteen days">
                      {reviewedDays.length ? reviewedDays.map(day => {
                        const rate = day.disciplineTotal ? Math.round((day.disciplineDone || 0) / day.disciplineTotal * 100) : 0;
                        return <div className="progress-bar-column discipline-chart" key={`discipline-${day.date}`} title={`${day.date}: ${rate}% (${day.disciplineDone || 0}/${day.disciplineTotal || 0})`}>
                          <span>{rate}%</span><div className="progress-bar-track"><i style={{ height: `${Math.max(rate, 3)}%` }} /></div><small>{day.date.slice(5)}</small>
                        </div>;
                      }) : <p className="progress-empty">Rule adherence appears after you save an end-of-day review.</p>}
                    </div>
                  </div>
                </div>
              ) : <p className="progress-empty">Daily charts will appear as you use the tracker.</p>}
            </section>

            <section className="progress-two-column">
              <div className="hud-panel">
                <div className="hud-panel-title"><span>FOUR NON-NEGOTIABLES</span><span className="badge-red">FIXED DAILY RULES</span></div>
                <p className="progress-storage-note">These are reviewed together at day end. They are not ranked or treated as tasks.</p>
                {appData.behaviorRules.map((rule, index) => <div className="discipline-order-row" key={rule.id}>
                  <b>{String(index + 1).padStart(2, "0")}</b><span>{rule.text}</span><small>5 PTS IF KEPT</small>
                </div>)}
              </div>
              <div className="hud-panel">
                <div className="hud-panel-title"><span>COACH NOTES // SUGGESTIONS</span><span className="badge-red">BASED ON YOUR RECORD</span></div>
                <ol className="progress-suggestions">{progressSuggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ol>
              </div>
            </section>

            <section className="hud-panel">
              <div className="hud-panel-title"><span>DAILY PROGRESS HISTORY</span><span className="badge-red">{progressDays.length} DAYS</span></div>
              {progressDays.length ? <div className="progress-history-list">{[...progressDays].reverse().map(day => <div className="progress-history-row" key={day.date}>
                <time>{day.date}</time><span className="progress-history-meter"><i style={{ width: `${Math.max(Number(day.percent) || 0, 1)}%` }} /></span><b>{day.completed || 0}/{day.total || 0} · {day.percent || 0}%</b><small>TASKS · RULE REVIEW {day.disciplineReviewed ? `${day.disciplineDone || 0}/${day.disciplineTotal || appData.behaviorRules.length}` : "NOT SAVED"} · BACKLOG {day.backlogDone || 0}/{day.backlogTotal || 0}</small>
              </div>)}</div> : <p className="progress-empty">No archived days yet. Your current day is included as you make progress.</p>}
            </section>

            <section className="hud-panel">
              <div className="hud-panel-title"><span>ACTIVITY LEDGER // ALL RECORDS</span><span className="badge-red">{activityLog.length} EVENTS</span></div>
              {activityLog.length ? <div className="activity-ledger">{activityLog.map(entry => <article className="activity-ledger-row" key={entry.id}>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time><div><strong>{entry.title}</strong>{entry.details && <p>{entry.details}</p>}</div><span>{entry.kind.replaceAll("_", " ").toUpperCase()}</span>
              </article>)}</div> : <p className="progress-empty">Your activity ledger starts with the next task or discipline update.</p>}
            </section>
          </div>
        )}

        {/* ROUTINE EDITOR MODAL */}
        {isEditModalOpen && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "16px" }}>
            <div style={{ background: "#121212", border: "1px solid var(--c-red)", borderRadius: "8px", maxWidth: "500px", width: "100%", padding: "20px", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid #222", paddingBottom: "8px" }}>
                <span style={{ color: "#fff", fontWeight: "700", fontSize: "0.9rem" }}>ROUTINE EDITOR</span>
                <button onClick={() => setIsEditModalOpen(false)} style={{ background: "none", border: "none", color: "#888", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
              </div>

              <div>
                <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                  <button className={`btn-toggle ${routineDay === "weekday" ? "active" : ""}`} onClick={() => { setRoutineDay("weekday"); setEditingBlockIndex(null); setNewBlock({ start: "", end: "", label: "", actions: "" }); }}>WEEKDAYS</button>
                  <button className={`btn-toggle ${routineDay === "weekend" ? "active" : ""}`} onClick={() => { setRoutineDay("weekend"); setEditingBlockIndex(null); setNewBlock({ start: "", end: "", label: "", actions: "" }); }}>WEEKEND</button>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--c-red)", fontWeight: "bold", marginBottom: "10px" }}>{editingBlockIndex === null ? "ADD NEW ROUTINE BLOCK" : "EDIT ROUTINE BLOCK"}</div>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                  <input type="time" className="input-field" value={newBlock.start} onChange={e => setNewBlock({ ...newBlock, start: e.target.value })} />
                  <input type="time" className="input-field" value={newBlock.end} onChange={e => setNewBlock({ ...newBlock, end: e.target.value })} />
                </div>

                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Block Title (e.g., [TECH] DEVELOPMENT)" 
                  value={newBlock.label} 
                  onChange={e => setNewBlock({ ...newBlock, label: e.target.value })}
                  style={{ width: "100%", marginBottom: "8px" }}
                />

                <textarea 
                  className="input-field" 
                  placeholder="Action Items (One action per line)" 
                  rows={3} 
                  value={newBlock.actions} 
                  onChange={e => setNewBlock({ ...newBlock, actions: e.target.value })}
                  style={{ width: "100%", marginBottom: "8px", resize: "none" }}
                />

                <button className="btn-add" style={{ width: "100%", marginBottom: "16px" }} onClick={handleSaveBlock}>{editingBlockIndex === null ? "+ SAVE BLOCK TO ROUTINE" : "SAVE CHANGES"}</button>

                <div style={{ fontSize: "0.75rem", color: "#888", fontWeight: "bold", marginBottom: "8px" }}>EXISTING ROUTINE BLOCKS:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {getEditorSchedule().map((blk, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#000", padding: "8px 12px", borderRadius: "4px", border: "1px solid #222" }}>
                      <div>
                        <div style={{ fontSize: "0.78rem", color: "#fff", fontWeight: "bold" }}>{blk.label}</div>
                        <div style={{ fontSize: "0.68rem", color: "var(--c-red)" }}>{blk.start} - {blk.end}</div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => handleEditBlock(idx)} className="btn-toggle" style={{ padding: "4px 7px" }}>EDIT</button>
                        <button onClick={() => handleDeleteBlock(idx)} style={{ background: "none", border: "none", color: "var(--c-red)", cursor: "pointer", fontWeight: "bold" }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
