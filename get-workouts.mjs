import { parseArgs } from "node:util";
import { getWorkoutsInRange, validateRange } from "./workout-reader.mjs";
import { runWorkoutCommand } from "./workout-cli.mjs";

try {
  const { values } = parseArgs({
    options: { start: { type: "string" }, end: { type: "string" } }
  });
  if (!values.start || !values.end) {
    throw new Error("Usage: npm run workouts -- --start YYYY-MM-DD --end YYYY-MM-DD");
  }
  const range = validateRange(values.start, values.end);
  const result = await runWorkoutCommand(api => getWorkoutsInRange(api, range));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
