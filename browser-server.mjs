import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createBrowserSession } from "./browser-session.mjs";
import { createJefitApi } from "./jefit-api.mjs";
import { getLatestWorkout, getWorkoutsInRange, validateRange, workoutSchema } from "./workout-reader.mjs";

const server = new McpServer({ name: "jefit-browser", version: "1.1.0" });
const browser = createBrowserSession();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const warnings = z.array(z.string());

function result(data) {
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
}

server.registerTool("jefit_get_latest_workout", {
  description: "Read the latest JEFIT workout and its sets.",
  inputSchema: {},
  outputSchema: workoutSchema.partial().extend({ date: date.nullable(), details: z.string(), warnings }),
  annotations: { readOnlyHint: true }
}, async () => {
  const latest = await browser.read(context => getLatestWorkout(createJefitApi(context)));
  return result({
    ...(latest.workout ?? { date: null, details: "No workouts found." }),
    warnings: latest.warnings
  });
});

server.registerTool("jefit_get_workouts", {
  description: "Read JEFIT workouts over an inclusive range of up to 366 days.",
  inputSchema: { start_date: date, end_date: date },
  outputSchema: z.object({
    start_date: date,
    end_date: date,
    count: z.number().int().nonnegative(),
    workouts: z.array(workoutSchema),
    warnings
  }),
  annotations: { readOnlyHint: true }
}, async ({ start_date, end_date }) => {
  const range = validateRange(start_date, end_date);
  return result(await browser.read(context => getWorkoutsInRange(createJefitApi(context), range)));
});

server.registerTool("jefit_login", {
  description: "Open the JEFIT sign-in window.",
  inputSchema: {},
  annotations: { destructiveHint: false, idempotentHint: true }
}, async () => {
  await browser.login();
  return { content: [{ type: "text", text: "Sign in to JEFIT, close the window, then retry." }] };
});

server.registerTool("jefit_close_browser", {
  description: "Release the local browser profile.",
  inputSchema: {},
  annotations: { destructiveHint: false, idempotentHint: true }
}, async () => {
  await browser.close();
  return { content: [{ type: "text", text: "Browser closed." }] };
});

const closeBrowser = () => { void browser.close().catch(() => {}); };
server.server.onclose = closeBrowser;
process.stdin.once("end", closeBrowser);
await server.connect(new StdioServerTransport());
