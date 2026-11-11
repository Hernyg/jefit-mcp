# JEFIT MCP

Unofficial MCP server and CLI for reading workouts from a signed-in JEFIT account.

## Setup

Use Node.js 20 or later. Run `npm ci` from the repository. Windows uses Google Chrome. On Linux and macOS, run `npx playwright install chromium`.

Run `npm run setup-login` to sign in. Close the browser after signing in.

Configure your MCP client to run `node` with the absolute path to `browser-server.mjs` over stdio.

## Usage

| Tool | Purpose |
| --- | --- |
| `jefit_get_latest_workout` | Read the latest workout. |
| `jefit_get_workouts` | Read workouts in an inclusive date range. |
| `jefit_login` | Open the sign-in window. |
| `jefit_close_browser` | Release the browser profile. |

```sh
npm run latest
npm run workouts -- --start 2025-01-01 --end 2025-01-31
npm test
```

| Environment variable | Purpose |
| --- | --- |
| `JEFIT_PROFILE_DIR` | Profile directory. Defaults to `~/.jefit-mcp/profile`. |
| `JEFIT_TIME_ZONE` | Workout date timezone. Defaults to the system timezone. |
| `JEFIT_CHROME_PATH` | Browser executable override. |
