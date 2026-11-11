import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createBrowserSession, SignInRequiredError } from "./browser-session.mjs";
import { createJefitApi } from "./jefit-api.mjs";
import { getLatestWorkout, getWorkoutsInRange, validateRange } from "./workout-reader.mjs";

function session(id, timestamp, exercise, options = {}) {
  return {
    id,
    date: Date.parse(timestamp) / 1000,
    edit_time: Date.parse("2026-11-14T00:00:00Z") / 1000,
    unit_system: "metric",
    total_weight: 0,
    workout_time: 60,
    logs: [{
      exercise_id: exercise,
      record_type: "reps",
      record: 8,
      log_sets: [{ index: 0, type: "default", reps: 8, weight: 0 }]
    }],
    ...options
  };
}

test("one range query keeps same-volume sessions separate and uses actual dates in the selected timezone", async () => {
  const calls = [];
  const api = {
    getAccountId: async () => "234",
    async getSessions(...args) {
      calls.push(args);
      return [
        session(1, "2026-11-10T16:00:00Z", "s_squat"),
        session(2, "2026-11-11T01:00:00Z", "u_custom"),
        session(3, "2026-11-11T16:00:00Z", "s_press")
      ];
    },
    getExerciseName: async id => id === "s_squat" ? "Squat" : null
  };
  const result = await getWorkoutsInRange(api, validateRange("2026-11-11", "2026-11-11"), "Asia/Shanghai");
  assert.deepEqual(calls, [["234", Date.parse("2026-11-10T00:00:00Z") / 1000, Date.parse("2026-11-13T00:00:00Z") / 1000]]);
  assert.deepEqual(result.workouts.map(w => [w.session_id, w.date, w.exercises[0].exercise_id]), [
    [1, "2026-11-11", "s_squat"],
    [2, "2026-11-11", "u_custom"]
  ]);
  assert.equal(result.workouts[0].exercises[0].name, "Squat");
  assert.equal(result.workouts[0].volume_kg, 0);
  assert.deepEqual(result.workouts[0].exercises[0].sets[0], {
    set: 1, type: "default", weight: 0, reps: 8, interval: null
  });
  assert.equal(result.workouts[1].exercises[0].name, null);
  assert.equal(result.warnings.length, 1);
});

test("latest uses the timestamp and falls back to earlier history", async () => {
  const earlier = session(9, "2026-06-06T05:00:00Z", "s_squat");
  const later = session(1, "2026-06-06T06:00:00Z", "s_press");
  let requests = 0;
  const api = {
    getAccountId: async () => "555",
    getSessions: async () => ++requests === 1 ? [] : [later, earlier],
    getExerciseName: async () => "Press"
  };
  const { workout } = await getLatestWorkout(api, "UTC", new Date("2026-11-11T12:00:00Z"));
  assert.equal(requests, 2);
  assert.equal(workout.session_id, 1);
  assert.equal(workout.exercises[0].name, "Press");
});

test("set weights use the exercise unit while session volume and records keep their recorded values", async () => {
  const row = session(1, "2025-05-12T12:00:00Z", "s_press", { total_weight: 2450 });
  const metricLog = {
    ...row.logs[0],
    record_type: "weight_and_reps",
    record: 120,
    log_sets: [
      { index: 0, weight: 220.4623, reps: 10 },
      { index: 1, weight: 5.5116, reps: 6 },
      { index: 2, weight: null, reps: 8 }
    ]
  };
  const imperialLog = {
    ...metricLog,
    exercise_id: "s_row",
    unit_system: "imperial",
    record: 150,
    log_sets: [{ index: 0, weight: 135, reps: 8 }]
  };
  row.logs = [metricLog, imperialLog, { ...row.logs[0], exercise_id: "s_pullup" }];
  const api = {
    getAccountId: async () => "555",
    getSessions: async () => [row],
    getExerciseName: async id => id
  };
  const range = validateRange("2025-05-12", "2025-05-12");
  const { workouts: [workout] } = await getWorkoutsInRange(api, range, "UTC");
  const [metric, imperial, bodyweight] = workout.exercises;
  assert.deepEqual([workout.volume, workout.volume_unit, workout.volume_kg], [2450, "kg", 2450]);
  assert.deepEqual(metric.sets.map(set => set.weight), [100, 2.5, null]);
  assert.deepEqual([metric.weight_unit, metric.record, metric.record_unit], ["kg", 120, "kg"]);
  assert.deepEqual([imperial.sets[0].weight, imperial.weight_unit, imperial.record, imperial.record_unit], [135, "lb", 150, "lb"]);
  assert.deepEqual([bodyweight.record, bodyweight.record_unit], [8, null]);
  assert.match(workout.details, /Set 1 · 100 kg · 10 reps/);
  assert.match(workout.details, /Set 1 · 135 lb · 8 reps/);
});

test("valid empty accounts return empty results and malformed sessions fail explicitly", async () => {
  const api = { getAccountId: async () => "555", getSessions: async () => [] };
  const range = validateRange("2026-11-11", "2026-11-11");
  assert.equal((await getWorkoutsInRange(api, range, "UTC")).count, 0);
  assert.equal((await getLatestWorkout(api, "UTC")).workout, null);
  api.getSessions = async () => [{ id: 1 }];
  await assert.rejects(getWorkoutsInRange(api, range, "UTC"), /unexpected workout data/);
});

test("range validation rejects impossible, reversed, and oversized dates", () => {
  assert.throws(() => validateRange("2026-02-30", "2026-11-11"), /valid calendar date/);
  assert.throws(() => validateRange("2026-11-12", "2026-11-11"), /on or before/);
  assert.throws(() => validateRange("2025-01-01", "2026-01-03"), /366 days/);
});

function fakeResponse(status, data, headers = {}) {
  return {
    status: () => status,
    headers: () => headers,
    ok: () => status >= 200 && status < 300,
    json: async () => ({ data }),
    dispose: async () => {}
  };
}

test("account IDs are discovered from the session and API requests stay on the fixed HTTPS origin", async () => {
  const calls = [];
  let accountId = 123;
  const api = createJefitApi({
    request: {
      async get(url, options) {
        calls.push([url, options.maxRedirects]);
        return fakeResponse(200, url.endsWith("/api/v2/user") ? { id: accountId } : []);
      }
    }
  });
  const range = validateRange("2026-11-11", "2026-11-11");
  await getWorkoutsInRange(api, range, "UTC");
  accountId = 234;
  await getWorkoutsInRange(api, range, "UTC");
  assert.deepEqual(calls.map(([url]) => new URL(url).pathname), [
    "/api/v2/user", "/api/v2/users/123/sessions", "/api/v2/user", "/api/v2/users/234/sessions"
  ]);
  assert.ok(calls.every(([url, redirects]) => new URL(url).origin === "https://www.jefit.com" && redirects === 0));
});

test("missing sessions prompt for sign-in and network errors omit raw request headers", async () => {
  const request = { get: async () => fakeResponse(401) };
  const api = createJefitApi({ request });
  await assert.rejects(api.getAccountId(), SignInRequiredError);
  request.get = async () => fakeResponse(302, null, { location: "https://example.test/login" });
  await assert.rejects(api.getAccountId(), /HTTP 302/);
  request.get = async () => { throw new Error("Cookie: test-secret"); };
  await assert.rejects(api.getAccountId(), error =>
    /Could not reach JEFIT/.test(error.message) && !error.cause && !error.message.includes("test-secret"));
});

class FakeContext extends EventEmitter {
  pages() {
    return [{ goto: async url => assert.equal(url, "https://www.jefit.com/my-jefit") }];
  }

  async close() {
    this.emit("close");
  }
}

test("browser operations reuse one launch and close after queued reads", async () => {
  const launches = [];
  const browser = createBrowserSession(async headless => {
    launches.push(headless);
    return new FakeContext();
  });
  const events = [];
  const first = browser.read(async context => {
    context.once("close", () => events.push("closed"));
    events.push("first");
    await Promise.resolve();
  });
  const second = browser.read(async () => { events.push("second"); });
  const close = browser.close();
  await Promise.all([first, second, close]);
  assert.deepEqual(launches, [true]);
  assert.deepEqual(events, ["first", "second", "closed"]);
});

test("login releases the headless profile, reuses the sign-in window, and resumes reads after close", async () => {
  const launches = [];
  const browser = createBrowserSession(async headless => {
    const context = new FakeContext();
    launches.push({ headless, context });
    return context;
  });
  await browser.read(async () => {});
  const login = await browser.login();
  assert.equal((await browser.login()).closed, login.closed);
  await assert.rejects(browser.read(async () => {}), /sign-in window is open/);
  await launches[1].context.close();
  await login.closed;
  await browser.read(async () => {});
  await browser.close();
  assert.deepEqual(launches.map(entry => entry.headless), [true, false, true]);
});

test("MCP advertises scoped tools and rejects invalid ranges over stdio", async () => {
  const client = new Client({ name: "jefit-tests", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL("./browser-server.mjs", import.meta.url))]
    }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      "jefit_close_browser", "jefit_get_latest_workout", "jefit_get_workouts", "jefit_login"
    ]);
    assert.equal(tools.find(tool => tool.name === "jefit_get_workouts").annotations.readOnlyHint, true);
    const result = await client.callTool({
      name: "jefit_get_workouts",
      arguments: { start_date: "2026-02-30", end_date: "2026-11-11" }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /valid calendar date/);
  } finally {
    await client.close();
  }
});
