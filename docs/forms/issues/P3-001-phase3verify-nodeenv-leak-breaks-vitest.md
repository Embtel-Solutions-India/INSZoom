### [P3-001] `phase3:verify`'s frontend test invocation inherited a production `NODE_ENV`, breaking vitest's jsdom Blob setup
- Date: 2026-08-25
- Area / file(s): `Backend/src/scripts/phase3Verify.js` (`runFrontendComponentTests`)
- Category: ci-invariant
- Symptom: `npm run phase3:verify` reported all 12 `USCISFormRenderer.test.jsx` tests failing with
  `TypeError: Blob is not a constructor`, even though the exact same test file passed 12/12 when run
  directly via `npx vitest run` from the frontend directory.
- Reproduction: `cd Backend && npm run phase3:verify` (fails); `cd INSZoom/frontend && npx vitest run
  src/components/uscis/USCISFormRenderer.test.jsx` (passes). The only difference between the two
  invocations is the parent process's environment.
- Root cause: `phase3Verify.js` calls `require("dotenv").config()` at the top of the script (to load
  `Backend/.env` for its own DB/storage-path defaults). `Backend/.env` sets `NODE_ENV=production`.
  `execFileSync`'s default behavior is to inherit the parent process's `process.env` into the child
  unless an explicit `env` option overrides it - so the frontend's vitest child process inherited
  `NODE_ENV=production` from the backend script that spawned it. Vitest's jsdom/happy-dom test
  environment setup behaves differently under a production `NODE_ENV` in a way that leaves the
  global `Blob` constructor unset (not fully root-caused further - out of scope to trace into
  vitest's own internals for a one-line fix).
- Causing action: introduced this session, in `phase3Verify.js`'s first draft (§I.6) - caught before
  merge by running the actual gate end-to-end rather than trusting the standalone
  `npx vitest run ...` check done earlier in the same session.
- Impact: would have made `phase3:verify` permanently report the frontend gate as failing, even
  though the frontend tests and component code were both correct - a false-negative CI signal that
  would have blocked or confused every future run of this gate.
- Phase-3 handling: fixed in phase. `runFrontendComponentTests()` now passes an explicit
  `env: { ...process.env, NODE_ENV: "test" }` to the child process instead of relying on inherited
  environment.
- Status: resolved
- Planned fix phase: n/a (fixed here). Note for later phases: any script that both loads a backend
  `.env` file AND spawns a frontend Node/Vite child process should set `NODE_ENV` explicitly for
  that child rather than relying on inheritance - this exact interaction could recur in
  `phase4Verify.js` or later if the same pattern (dotenv load + child_process spawn into
  `INSZoom/frontend`) is copied without carrying this fix forward.
