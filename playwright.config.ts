import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser, the real widget bundle, the real API.
 *
 * Everything else in this repository tests a layer in isolation. This is the
 * only check that answers "does the thing a customer pastes into their page
 * actually work", and the only one that can catch the failures that live in the
 * seams -- a shadow root that renders but cannot be focused, a widget that mounts
 * before the API is up, a page whose landmark is not where the widget thinks.
 *
 * `webServer` starts all six processes, so `npx playwright test` is the whole
 * command and CI does not need orchestration around it. Nothing it starts is
 * reused by default: an occupied port is a loud failure rather than a suite
 * quietly run against something else. `PW_REUSE_API=1` opts the API back into
 * reuse for a developer who is iterating on it and knows what is on the port --
 * see the note at that entry for what reusing the wrong one costs.
 */
const API_PORT = Number(process.env.API_PORT ?? 8787);
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 4173);
const REACT_PORT = Number(process.env.REACT_PORT ?? 4174);
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 4175);
const MARKETING_PORT = Number(process.env.MARKETING_PORT ?? 4176);
const LAB_PORT = Number(process.env.LAB_PORT ?? 4180);

export default defineConfig({
  testDir: './tests/e2e',
  // The API keeps process-local rate-limit buckets, so tests that share an
  // address share a budget. Fully parallel workers would let one test's requests
  // spend another's allowance and produce a 429 that reads as a broken widget.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    // `localhost`, not `127.0.0.1`: the demo page's embed snippet points the
    // widget at `http://localhost:8787`, and a page reached at one hostname
    // making cross-origin calls to another is the production shape being tested.
    // Using 127.0.0.1 here would quietly turn those calls same-site.
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // A data directory of its own, so an e2e run cannot write into the
      // developer's `.data` or into whatever the smoke test used.
      command: 'npx tsx apps/api/src/main.ts',
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: {
        PORT: String(API_PORT),
        SUNNY_DATA_DIR: '.data-e2e',
        LOG_LEVEL: 'warn',
        // The limiter is per address in memory, and a test run is one address
        // making every request in the suite: five servers, dozens of page loads,
        // most of them mounting a widget that opens a session. At the shipped
        // defaults the run spends a whole minute's allowance and the last
        // widget test to run gets a 429 -- a failure that says nothing about the
        // widget and everything about the harness.
        //
        // Raised here rather than worked around in the tests, because the tests
        // are then free to load a page as often as they need to, and the limiter
        // keeps its own coverage in `apps/api/test` where the threshold is the
        // subject rather than an obstacle.
        SUNNY_RL_SESSION_LIMIT: '10000',
        SUNNY_RL_CHAT_LIMIT: '10000',
        SUNNY_RL_LEADS_LIMIT: '10000',
        SUNNY_RL_QUALIFICATION_LIMIT: '10000',
      },
      // Opt-in, and the reason is a failure that was measured rather than
      // imagined. This entry used to reuse whatever was on the port, which
      // includes a developer's own `npm run dev:api` -- started with the
      // *shipped* rate limits, where this one raises all of them to 10000. The
      // suite opens more than 30 widget sessions in a minute, the shipped
      // limiter allows 30 per 60s, and the last widget test to run then gets a
      // 429 that the page renders as a panel with no option cards:
      //
      //     `still has the options after the panel is closed and opened again`
      //     Expected: 2  Received: 0
      //
      // Measured directly: 30 `POST /v1/widget/session` answered 200, the 31st
      // answered `429 rate_limited` with `retry-after: 44`. That also explains
      // why the failing pair differed between runs -- which test starves depends
      // on how much of the allowance the tests before it spent -- and it is the
      // reason a suite that looked flaky was failing for a reason outside the
      // code. Set `PW_REUSE_API=1` to take the old behaviour back deliberately.
      reuseExistingServer: process.env.PW_REUSE_API === '1',
      timeout: 60_000,
    },
    {
      // The widget bundle is rebuilt as part of starting the server that serves
      // it. Without that, a run after a source change tests the previous bundle
      // and reports success for code that no longer exists -- a stale artefact
      // reads exactly like a passing test.
      command: `npm run build:widget && npx tsx apps/widget-demo/serve.ts --port ${DEMO_PORT}`,
      url: `http://127.0.0.1:${DEMO_PORT}/`,
      env: { PORT: String(DEMO_PORT) },
      // Not reusable, unlike the API. A developer may reasonably have the API
      // running already, and it serves their source. These two serve a *built*
      // artefact, so an already-running one is by definition a different build,
      // and reusing it would undo the rebuild above. An occupied port is then a
      // loud failure, which is the right outcome.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The React host fixture: the same widget, in a page React owns.
      command:
        `npm run build:widget && npm run build -w @sunny/widget-demo-react && ` +
        `npx tsx apps/widget-demo-react/serve.ts --port ${REACT_PORT}`,
      url: `http://127.0.0.1:${REACT_PORT}/`,
      env: { PORT: String(REACT_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The Next.js host fixture. `next start` serves a production build, which
      // is the thing an integrator's site actually runs -- a dev server hides
      // hydration and hoisting behaviour behind different defaults.
      command:
        `npm run build:widget && npm run build -w @sunny/widget-demo-next && ` +
        `npm run start -w @sunny/widget-demo-next`,
      url: `http://127.0.0.1:${NEXT_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // The marketing site, as a production build like the fixture above.
      //
      // It is a product surface rather than a host fixture, but it is started
      // here for the same reason: it is the only page that mounts the widget
      // *and* drives the character directly, so it is where an accessibility
      // regression in either would be caught.
      command:
        `npm run build:widget && npm run build -w @sunny/marketing && ` +
        `npm run start -w @sunny/marketing`,
      url: `http://127.0.0.1:${MARKETING_PORT}/`,
      // The site reads its API address at build time, so it must be told the
      // port the API server above is actually on.
      env: {
        NEXT_PUBLIC_SUNNY_API_URL: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // The character lab, rebuilt first for the same reason as the widget: it
      // serves a committed bundle, and a stale artefact reads exactly like a
      // passing test. It is the only surface where the animation catalogue is
      // something a person can click, so it is where "every catalogued moment is
      // playable" stops being a claim in a document and becomes a browser check.
      command: `npm run build:lab && npx tsx apps/character-lab/serve.ts --port ${LAB_PORT}`,
      url: `http://127.0.0.1:${LAB_PORT}/`,
      env: { PORT: String(LAB_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
