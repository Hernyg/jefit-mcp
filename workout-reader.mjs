import { z } from "zod";

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const MAX_WORKOUTS = 100;
const MAX_OUTPUT_BYTES = 250_000;
const NAME_BATCH_SIZE = 8;
const NAME_LOOKUP_MS = 15_000;
const KILOGRAMS_PER_POUND = 0.45359237;

const identifier = z.union([z.string().min(1), z.number().int()]);
const nullableNumber = z.number().nullish();
const rawSet = z.object({
  index: z.number().int(),
  type: z.string().nullish(),
  weight: nullableNumber,
  reps: nullableNumber,
  interval: nullableNumber
});
const rawLog = z.object({
  exercise_id: identifier,
  record_type: z.string().nullish(),
  record: nullableNumber,
  unit_system: z.string().nullish(),
  log_sets: z.array(rawSet)
});
const rawSession = z.object({
  id: identifier,
  date: z.number().int().refine(value => Number.isFinite(new Date(value * 1000).valueOf())),
  total_weight: nullableNumber,
  total_time: nullableNumber,
  workout_time: nullableNumber,
  unit_system: z.string().nullish(),
  logs: z.array(rawLog)
});

const exerciseSchema = z.object({
  exercise_id: identifier,
  name: z.string().nullable(),
  unit_system: z.string().nullable(),
  weight_unit: z.enum(["kg", "lb"]).describe("Unit of every set's weight. Metric sets are in kilograms."),
  record_type: z.string().nullable(),
  record: z.number().nullable(),
  record_unit: z.enum(["kg", "lb"]).nullable(),
  sets: z.array(z.object({
    set: z.number().int(),
    type: z.string().nullable(),
    weight: z.number().nullable(),
    reps: z.number().nullable(),
    interval: z.number().nullable()
  }))
});

export const workoutSchema = z.object({
  date: z.string(),
  timestamp: z.string(),
  session_id: identifier,
  unit_system: z.string().nullable(),
  volume: z.number().nullable(),
  volume_unit: z.enum(["kg", "lb"]).nullable(),
  volume_kg: z.number().nullable(),
  training_time: z.string().nullable(),
  total_time_seconds: z.number().nullable(),
  workout_time_seconds: z.number().nullable(),
  exercises: z.array(exerciseSchema),
  details: z.string()
});

function parseDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    throw new Error(label + " must use YYYY-MM-DD format.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(label + " is not a valid calendar date.");
  }
  return date.valueOf();
}

export function validateRange(startDate, endDate) {
  const start = parseDate(startDate, "Start date");
  const end = parseDate(endDate, "End date");
  if (start > end) throw new Error("Start date must be on or before end date.");
  if (end - start >= MAX_DAYS * DAY_MS) {
    throw new Error("Choose a date range of " + MAX_DAYS + " days or fewer.");
  }
  return { startDate, endDate, start, end };
}

function dateFormatter(timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    });
    return date => {
      const parts = formatter.formatToParts(date);
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return values.year.padStart(4, "0") + "-" + values.month + "-" + values.day;
    };
  } catch {
    throw new Error("JEFIT_TIME_ZONE must be a valid timezone, for example Asia/Shanghai.");
  }
}

function parseSessions(data) {
  const result = z.array(rawSession).safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error("JEFIT returned unexpected workout data at " + (issue.path.join(".") || "sessions") + ".");
  }
  const sessions = new Map();
  for (const session of result.data) {
    const key = String(session.id);
    const previous = sessions.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(session)) {
      throw new Error("JEFIT returned conflicting records for the same session ID. Retry the request.");
    }
    sessions.set(key, session);
  }
  return [...sessions.values()];
}

function duration(seconds) {
  if (seconds == null) return null;
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60]
    .map(part => String(part).padStart(2, "0")).join(":");
}

function weightUnit(unitSystem) {
  if (unitSystem === "metric") return "kg";
  if (unitSystem === "imperial") return "lb";
  return null;
}

function displayWeight(value, unit) {
  return unit ? value + " " + unit : String(value);
}

function workoutDetails(date, volume, volumeUnit, trainingTime, exercises) {
  const lines = ["Training Summary", date];
  if (volume != null) lines.push("Volume " + displayWeight(volume, volumeUnit));
  if (trainingTime) lines.push("Training " + trainingTime);
  for (const exercise of exercises) {
    lines.push("", exercise.name ?? "Exercise " + exercise.exercise_id);
    for (const set of exercise.sets) {
      const values = [];
      if (set.weight != null) values.push(displayWeight(set.weight, exercise.weight_unit));
      if (set.reps != null) values.push(set.reps + " reps");
      if (set.interval != null) values.push("interval " + set.interval);
      lines.push("Set " + set.set + (values.length ? " · " + values.join(" · ") : ""));
    }
    if (exercise.record != null && exercise.record_type) {
      lines.push("Record (" + exercise.record_type + "): " + displayWeight(exercise.record, exercise.record_unit));
    }
  }
  return lines.join("\n");
}

function formatWorkout(session, date, names) {
  const volume = session.total_weight ?? null;
  const unitSystem = session.unit_system ?? null;
  const volumeUnit = weightUnit(unitSystem);
  const trainingTime = duration(session.workout_time);
  const exercises = session.logs.map(log => {
    const exerciseUnitSystem = log.unit_system ?? unitSystem;
    const exerciseUnit = weightUnit(exerciseUnitSystem);
    return {
      exercise_id: log.exercise_id,
      name: names.get(String(log.exercise_id)) ?? null,
      unit_system: exerciseUnitSystem,
      weight_unit: exerciseUnit ?? "lb",
      record_type: log.record_type ?? null,
      record: log.record ?? null,
      record_unit: log.record_type === "weight_and_reps" ? exerciseUnit : null,
      sets: log.log_sets.map(set => {
        let weight = set.weight ?? null;
        if (weight !== null && exerciseUnit === "kg") {
          weight = Number((weight * KILOGRAMS_PER_POUND).toFixed(2));
        }
        return {
          set: set.index + 1,
          type: set.type ?? null,
          weight,
          reps: set.reps ?? null,
          interval: set.interval ?? null
        };
      }).sort((a, b) => a.set - b.set)
    };
  });

  return {
    date,
    timestamp: new Date(session.date * 1000).toISOString(),
    session_id: session.id,
    unit_system: unitSystem,
    volume,
    volume_unit: volumeUnit,
    volume_kg: volumeUnit === "kg" ? volume : null,
    training_time: trainingTime,
    total_time_seconds: session.total_time ?? null,
    workout_time_seconds: session.workout_time ?? null,
    exercises,
    details: workoutDetails(date, volume, volumeUnit, trainingTime, exercises)
  };
}

async function formatWorkouts(api, sessions, formatDate) {
  if (sessions.length > MAX_WORKOUTS) {
    throw new Error("More than " + MAX_WORKOUTS + " workouts matched. Use smaller date ranges.");
  }
  const ids = [...new Set(sessions.flatMap(session => session.logs.map(log => String(log.exercise_id))))];
  const names = new Map();
  const deadline = Date.now() + NAME_LOOKUP_MS;
  for (let offset = 0; offset < ids.length && Date.now() < deadline; offset += NAME_BATCH_SIZE) {
    const remaining = deadline - Date.now();
    if (remaining < 1) break;
    await Promise.all(ids.slice(offset, offset + NAME_BATCH_SIZE).map(async id => {
      const name = await api.getExerciseName(id, Math.min(5_000, remaining));
      if (name) names.set(id, name);
    }));
  }

  const workouts = sessions.map(session => formatWorkout(session, formatDate(new Date(session.date * 1000)), names));
  if (Buffer.byteLength(JSON.stringify(workouts)) > MAX_OUTPUT_BYTES) {
    throw new Error("The workout result is too large. Use a smaller date range.");
  }
  const warnings = [];
  if (names.size < ids.length) {
    warnings.push("Some exercise names were unavailable from JEFIT. The exercise IDs and sets are included.");
  }
  return { workouts, warnings };
}

function sortSessions(a, b) {
  return a.date - b.date || String(a.id).localeCompare(String(b.id), "en", { numeric: true });
}

export async function getWorkoutsInRange(api, range, timeZone = process.env.JEFIT_TIME_ZONE) {
  const formatDate = dateFormatter(timeZone);
  const accountId = await api.getAccountId();
  const data = await api.getSessions(accountId, (range.start - DAY_MS) / 1000, (range.end + 2 * DAY_MS) / 1000);
  const sessions = parseSessions(data).filter(session => {
    const date = formatDate(new Date(session.date * 1000));
    return date >= range.startDate && date <= range.endDate;
  }).sort(sortSessions);
  const { workouts, warnings } = await formatWorkouts(api, sessions, formatDate);
  return { start_date: range.startDate, end_date: range.endDate, count: workouts.length, workouts, warnings };
}

export async function getLatestWorkout(api, timeZone = process.env.JEFIT_TIME_ZONE, now = new Date()) {
  const formatDate = dateFormatter(timeZone);
  const accountId = await api.getAccountId();
  const end = Math.floor(now.valueOf() / 1000);
  const recentStart = end - 31 * DAY_MS / 1000;
  const recent = parseSessions(await api.getSessions(accountId, recentStart, end))
    .filter(session => session.date <= end);
  const sessions = recent.length ? recent : parseSessions(await api.getSessions(accountId, 1, recentStart))
    .filter(session => session.date <= recentStart);
  const latest = sessions.sort(sortSessions).at(-1);
  if (!latest) return { workout: null, warnings: [] };
  const { workouts, warnings } = await formatWorkouts(api, [latest], formatDate);
  return { workout: workouts[0], warnings };
}
