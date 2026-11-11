import { createBrowserSession } from "./browser-session.mjs";

const browser = createBrowserSession();
try {
  const { closed } = await browser.login();
  console.log("Sign in to JEFIT in the browser window, then close it. The connector will reuse that session.");
  await closed;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
