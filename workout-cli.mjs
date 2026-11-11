import { createInterface } from "node:readline/promises";
import { createBrowserSession, SignInRequiredError } from "./browser-session.mjs";
import { createJefitApi } from "./jefit-api.mjs";

export async function runWorkoutCommand(operation) {
  const browser = createBrowserSession();
  const read = () => browser.read(context => operation(createJefitApi(context)));
  try {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof SignInRequiredError) || !process.stdin.isTTY || !process.stderr.isTTY) {
        throw error;
      }
      const terminal = createInterface({ input: process.stdin, output: process.stderr });
      let answer;
      try {
        answer = await terminal.question("Sign in to JEFIT to read your workouts. Open the sign-in window? [Y/n] ");
      } finally {
        terminal.close();
      }
      if (!/^(?:y|yes)?$/i.test(answer.trim())) throw error;
      const { closed } = await browser.login();
      console.error("Sign in to JEFIT in the browser window, then close it.");
      await closed;
      return await read();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
