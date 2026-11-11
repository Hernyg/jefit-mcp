import { getLatestWorkout } from "./workout-reader.mjs";
import { runWorkoutCommand } from "./workout-cli.mjs";

try {
  const { workout, warnings } = await runWorkoutCommand(getLatestWorkout);
  if (workout) {
    console.log("Latest JEFIT workout — " + workout.date + "\n");
    console.log(workout.details);
  } else {
    console.log("No workouts found.");
  }
  for (const warning of warnings) console.error(warning);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
