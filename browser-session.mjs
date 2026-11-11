import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

export const JEFIT_ORIGIN = "https://www.jefit.com";
const LOGIN_URL = JEFIT_ORIGIN + "/my-jefit";
const profileDir = path.resolve(process.env.JEFIT_PROFILE_DIR ??
  path.join(os.homedir(), ".jefit-mcp", "profile"));

export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in with jefit_login or npm run setup-login. Close the window after signing in, then retry.");
    this.name = "SignInRequiredError";
  }
}

async function launchBrowser(headless) {
  const options = { headless, timeout: 20_000 };
  if (process.env.JEFIT_CHROME_PATH) {
    options.executablePath = process.env.JEFIT_CHROME_PATH;
  } else if (process.platform === "win32") {
    options.channel = "chrome";
  }

  try {
    return await chromium.launchPersistentContext(profileDir, options);
  } catch (error) {
    if (/ProcessSingleton|profile.*(?:in use|lock)|Opening in existing browser session/i.test(error.message)) {
      throw new Error("The JEFIT browser profile is in use. Close the sign-in window or call jefit_close_browser in the other session.", { cause: error });
    }
    throw new Error("Could not start the JEFIT browser. Check that the configured browser is installed and that no other connector is using the profile.", { cause: error });
  }
}

export function createBrowserSession(launch = launchBrowser) {
  let context;
  let signingIn = false;
  let signInClosed;
  let queue = Promise.resolve();

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function open(headless) {
    const browserContext = await launch(headless);
    context = browserContext;
    signingIn = !headless;
    browserContext.once("close", () => {
      if (context === browserContext) {
        context = undefined;
        signingIn = false;
      }
    });
    return browserContext;
  }

  return {
    read(operation) {
      return serialize(async () => {
        if (signingIn) {
          throw new Error("The JEFIT sign-in window is open. Finish signing in, close the window, then retry.");
        }
        return operation(await (context ?? open(true)));
      });
    },

    login() {
      return serialize(async () => {
        if (signingIn) return { closed: signInClosed };
        await context?.close();
        const loginContext = await open(false);
        signInClosed = new Promise(resolve => loginContext.once("close", resolve));
        try {
          const page = loginContext.pages()[0] ?? await loginContext.newPage();
          await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
        } catch (error) {
          await loginContext.close().catch(() => {});
          throw new Error("Could not open the JEFIT sign-in page. Check your connection and retry.", { cause: error });
        }
        return { closed: signInClosed };
      });
    },

    close() {
      return serialize(async () => {
        await context?.close();
      });
    }
  };
}
