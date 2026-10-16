# Issue #3: synthetic browser regression — pre-review handoff

Scope: local snapshot frontend + loopback synthetic mock; branch `programmer/issue3-weekend-check`, HEAD `8526fd9e5115b03f09269b902ed12a58f9277968`, parent/base and `origin/main` `7d0554ea50cda87cabe801981aaa7ab6bf641a3a`. Test and evidence only; no application source, dependency, lockfile, or config changes. No production or real backend write. Earlier evidence in `docs/ISSUE3_WEEKEND_SYNTHETIC_BROWSER.md` covers separate Saturday/Sunday visual probes, not this CRUD regression.

## Final run and results

The prior run's exact invocation (from worktree root) was:

`CFIN_PROBE_SCRATCH=C:/Users/Otrade/AppData/Local/hermes/profiles/programmer/cache/scratch/issue3-weekend-check node server-snapshot/frontend/test/issue-3-regression-browser.cjs > docs/ISSUE3_BROWSER_EVIDENCE/run.log 2>&1`

Prior worker reported exit 0. The preserved raw `run.log` ends `PORT_RELEASE` true for mock/debug ports 52861/52862 and `RUN_STATUS {"passed":true,"discoverOnly":false}`. `evidence.json` records the fixture date 2026-10-17 (Saturday), Asia/Novosibirsk browser timezone, 3 pointer hit tests (including unscrolled and scrolled coordinate clicks), October→November→reload month retention (60 November cells), two new entries in a weekend income cell (41.25 + 13.75, badge 2), change of only the first to 51.25 (total 65.00), close/reopen showing both, distinct income/expense styling, selected-cell and sticky/scroll geometry, and baseline-vs-final unchanged unrelated synthetic records/month. The mock test date is fixed by `CFIN_MOCK_TODAY`; browser Date is overridden within the isolated headless Chrome profile, not at host level.

Evidence index (all under this directory): `evidence.json` (machine-readable full state), `run.log` (raw stdout/stderr), `01-weekend-today.png` (combined state), `02-first-entry.png`, `03-two-entries-count.png`, `04-edited-first-only.png`, `05-selected-scrolled-sticky.png`, `06-reopened.png`. `SHA256SUMS.txt` lists SHA-256 of those artifacts and the two test scripts. Each PNG was reported by `file docs/ISSUE3_BROWSER_EVIDENCE/*.png` as a readable PNG image 1424×805 RGB, non-interlaced. This checks format/header, not visual correctness or full pixel decode; Reviewer must visually inspect the six PNGs and independently rerun if possible. Visual acceptance is UNVERIFIED pending that inspection.

`discovery.log` and `probe.log` are exploratory/partial harness runs, **not** final acceptance results: discovery records `RUN_STATUS passed:false, discoverOnly:true`; probe stops after first creation even though its local `RUN_STATUS passed:true` (it did not exercise the full regression). Prior worker reported exploratory harness failures; these logs must not be conflated with final full `run.log` PASS. The final log's early `MODAL_DISCOVERY` contains stale rows immediately after switching cells, while subsequent `FIRST_CREATE`, `TWO_ENTRIES`, `EDIT_ONLY_FIRST`, `REOPEN_PERSISTENCE` and `AFTER_AND_BASELINE_COMPARISON` reflect the correct target date and isolation. Review should consider this timing observation; no app source was modified.

## Final independent checks (this handoff)

Run separately from worktree root, each exit 0:

- `node --check server-snapshot/frontend/test/issue-3-regression-browser.cjs` — no stdout, PASS.
- `node --check server-snapshot/frontend/test/issue-3-mock-server.cjs` — no stdout, PASS.
- `git diff --check` — no stdout, PASS.
- `git diff -- server-snapshot/frontend/test/issue-3-mock-server.cjs` — only optional fixed-date fixture change in mock (tracked diff).
- `file docs/ISSUE3_BROWSER_EVIDENCE/*.png` — six PNG headers as indexed above.
- `sha256sum docs/ISSUE3_BROWSER_EVIDENCE/*.png docs/ISSUE3_BROWSER_EVIDENCE/evidence.json docs/ISSUE3_BROWSER_EVIDENCE/run.log server-snapshot/frontend/test/issue-3-regression-browser.cjs server-snapshot/frontend/test/issue-3-mock-server.cjs` — hashes in `SHA256SUMS.txt`.
- `git status --porcelain=v1 --untracked-files=all`, `git diff --cached --name-only`, `git diff --name-only`, `git ls-files --others --ignored --exclude-standard docs/ISSUE3_BROWSER_EVIDENCE` — no staged changes; tracked modification limited to mock test; new browser test, PNGs, JSON, this report/manifest under allowed test/docs. Three logs are git-ignored.

Prior run reported `npm run build --prefix C:/Users/Otrade/AppData/Local/hermes/profiles/programmer/cache/scratch/issue3-weekend-check/frontend` PASS on ephemeral snapshot copy; not rerun here. No further browser run was made by this handoff; preserve original `run.log`/`evidence.json`/PNGs bytes.

## Reproduction for Reviewer

From this worktree at the same HEAD, prepare an **ephemeral copy** of `server-snapshot/frontend` under a fresh absolute scratch directory outside the repo; reference locally available dependencies read-only, without a network install, and run `npm run build --prefix <scratch>/frontend` so `<scratch>/frontend/dist` exists. Copy current `server-snapshot/frontend/test/issue-3-mock-server.cjs` to `<scratch>/frontend/test/issue-3-mock-server.cjs` (the browser harness launches this copy). With locally installed Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`, execute `CFIN_PROBE_SCRATCH=<scratch> node server-snapshot/frontend/test/issue-3-regression-browser.cjs` from worktree root. It creates fresh loopback mock/debug ports and an isolated browser profile; it writes to this evidence directory, so **do not rerun against the preserved evidence**: make a separate review worktree/copy or archive the current evidence first and write new output to an independently designated location. Avoid network/production endpoints and real credentials. Inspect run status, port releases, JSON, and PNGs independently.

## Retention and limits

`run.log` is ignored by Git and is available to Reviewer at `D:/Hermes/CFin-issue3-weekend-check/docs/ISSUE3_BROWSER_EVIDENCE/run.log` now. For a future Owner-authorized post-review commit, explicitly review and `git add -f docs/ISSUE3_BROWSER_EVIDENCE/run.log` **only** for this raw evidence log; ordinary add will omit it. Do not stage `probe.log` or `discovery.log` by default: they are partial exploratory material and not final acceptance evidence. No staging/commit/push occurred in this handoff. This PASS is frontend + synthetic mock only: real API/DB persistence, production behavior, rollback, and full Issue #3 acceptance remain UNVERIFIED. No issue close, merge, or deploy implied.
