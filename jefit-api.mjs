import { JEFIT_ORIGIN, SignInRequiredError } from "./browser-session.mjs";

export function createJefitApi(context) {
  async function get(route, label, { timeout = 12_000, optional = false } = {}) {
    let response;
    try {
      response = await context.request.get(JEFIT_ORIGIN + route, {
        maxRedirects: 0,
        timeout
      });
    } catch {
      if (optional) return null;
      throw new Error("Could not reach JEFIT for " + label + ". Check your connection and retry.");
    }

    try {
      const status = response.status();
      if (status === 401 || (status === 403 && route === "/api/v2/user")) {
        throw new SignInRequiredError();
      }
      if (status >= 300 && status < 400) {
        const location = response.headers().location;
        const redirect = location && URL.canParse(location, JEFIT_ORIGIN)
          ? new URL(location, JEFIT_ORIGIN) : null;
        if (redirect?.origin === JEFIT_ORIGIN && /^\/(?:login|signin|sign-in)(?:\/|$)/i.test(redirect.pathname)) {
          throw new SignInRequiredError();
        }
      }
      if (!response.ok()) {
        if (optional) return null;
        throw new Error("JEFIT " + label + " failed (HTTP " + status + ").");
      }
      const body = await response.json().catch(() => null);
      if (!body || !Object.hasOwn(body, "data")) {
        if (optional) return null;
        throw new Error("JEFIT returned an unexpected response for " + label + ".");
      }
      return body.data;
    } finally {
      await response.dispose().catch(() => {});
    }
  }

  return {
    async getAccountId() {
      const account = await get("/api/v2/user", "account lookup");
      if (account === null) throw new SignInRequiredError();
      if (!/^[1-9]\d*$/.test(String(account?.id))) {
        throw new Error("JEFIT returned an invalid account ID.");
      }
      return String(account.id);
    },

    getSessions(accountId, start, end) {
      const query = new URLSearchParams({ startDate: String(start), endDate: String(end) });
      return get("/api/v2/users/" + encodeURIComponent(accountId) + "/sessions?" + query, "workout lookup");
    },

    async getExerciseName(id, timeout) {
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
      const exercise = await get("/api/v2/exercises/" + id, "exercise lookup", { timeout, optional: true });
      return typeof exercise?.name === "string" ? exercise.name.trim() || null : null;
    }
  };
}
