# Saving redesign validation

Current qualification requires one repetition per scenario and five samples per measured operation, accepted using the average of the three slowest samples (5,000 ms for saves; 100 ms for pointer feedback). There are two protocol-5 save workloads and one full-editor workload. Protocol 4 support is removed under the assumption that no protocol-4 gardens exist. The separate pilot is retired. Current results are recorded below; the historical evidence section retains earlier sources and requirements without treating them as current qualification. <!-- CHANGE -->

## Current cleanup validation <!-- CHANGE -->

Qualification cleanup removes singleton protocol/repetition loops, the unused renderer protocol assignment, and obsolete application-entry mutability. Save qualification retains the fresh and 10,000-edit loop. Report fields, commands, thresholds, protocol-4 and pilot rejection guards, source inventories, and archive audits are unchanged. Autosave evidence now requires version-1 `autosaveTiming` records and explicit matching summary/run modes; unversioned arrays and inferred modes are rejected. Both split and all-real modes remain supported. <!-- CHANGE -->

The focused cleanup run passed 196 tests, with one opt-in stress test skipped and no failures (`.test-artifacts/qualification-cleanup-focused.log`). Coverage includes qualification and resume guards, both timing modes, obsolete/missing/contradictory metadata, raw sample statistics, missing/duplicate/unsupported workloads, frozen sources, current-state persistence, reference policies, background saving, protocol rejection, and packaging. Changed runners/helpers also passed syntax checks and the scoped diff check. <!-- CHANGE -->

Fresh serial qualification passed against unchanged cleaned runtime sources. The save campaign is `.test-artifacts/coordinator-sync/qualification-1793837521402/summary.json`; the full-editor campaign is `.test-artifacts/saving-redesign/interactions-1793837866231/summary.json`. <!-- CHANGE -->

| Workload | Highest three-slowest mean | Limit | Result | <!-- CHANGE -->
| --- | ---: | ---: | --- | <!-- CHANGE -->
| Fresh garden saves | 4,297.07 ms | 5,000 ms | Passed | <!-- CHANGE -->
| 10,000-edit garden saves | 2,530.63 ms | 5,000 ms | Passed | <!-- CHANGE -->
| Full-editor pointer feedback | 69.00 ms | 100 ms | Passed | <!-- CHANGE -->

Both save workloads retained five samples for each of seven operations, one real autosave wait, four controlled preparations, zero execution-clock advances, and zero archive scans or historical reads. The editor retained all five feedback samples, verified focus and a rendered target on an 88-circle Dill planting, and recorded zero pointer/selection mutations, rejections, or frame timeouts. Undo/redo, reopen, portable export, and Save As passed. One feedback sample was 135.8 ms; the three-slowest mean was 69 ms and met the specified acceptance rule without dropping the outlier. <!-- CHANGE -->

The combined checker accepted both source-bound suites. Actual resume independently revalidated and reused both save workloads; its report is `.test-artifacts/coordinator-sync/qualification-1793837987824/summary.json`. Earlier qualification artifacts remain unchanged historical evidence and do not certify the cleaned helpers. This cleanup does not enable gated collaboration capabilities or claim a green repository-wide suite; the earlier broader Syncthing failures are recorded below. <!-- CHANGE -->

## Earlier five-sample validation <!-- CHANGE -->

The following results precede cleanup and retain their original measurements and report paths. <!-- CHANGE -->

The focused run passed 335 tests, with one opt-in test skipped and no failures. It covers qualification guards, autosave clocks, frozen sources, protocol-4 rejection, current-state persistence, references, activity, permissions, library operations, seed effects, and managed editor fixtures. The log is `.test-artifacts/qualification-five-focused.log`. Editor fixtures now load reference/transaction dependencies and reconstruct protocol-5 object transactions. Duplicate full-document receipts reset policy delivery so a retry receives complete accepted policy, matching compact-transaction retries. <!-- CHANGE -->

Both protocol-5 save workloads passed with five raw samples for each of seven operations (70 measurements total). Each retains one real autosave quiet wait, four controlled preparations, zero execution-clock advances, and zero archive scans or historical reads. The raw reports and exact frozen inventory are in `.test-artifacts/coordinator-sync/qualification-1793815476817/summary.json`. <!-- CHANGE -->

| Workload | Highest three-slowest mean | Limit | Result | <!-- CHANGE -->
| --- | ---: | ---: | --- | <!-- CHANGE -->
| Fresh garden saves | 3,163.00 ms | 5,000 ms | Passed | <!-- CHANGE -->
| 10,000-edit garden saves | 3,289.13 ms | 5,000 ms | Passed | <!-- CHANGE -->
| Full-editor pointer feedback | 23.83 ms | 100 ms | Passed | <!-- CHANGE -->

The full-editor campaign is `.test-artifacts/saving-redesign/interactions-1793815795574/summary.json`. It retains all five feedback samples, a verified focused pointer target on an 88-circle Dill planting, zero pointer or selection mutations, zero rejection attempts, and zero frame timeouts. Undo/redo restored content; reopen, native portable XML export, and Save As preserved the modified Unicode draft and required reference definitions. <!-- CHANGE -->

The combined checker accepted both suites against the exact unchanged current runtime sources. An actual `--resume` run independently revalidated and reused both save workloads without launching new measurements; its report is `.test-artifacts/coordinator-sync/qualification-1793815908041/summary.json`. Earlier ten-sample campaign `qualification-1793814059477` was stopped when the user changed the protocol/sample policy and is not current release evidence. <!-- CHANGE -->

The broader Syncthing file recorded 43 passes and 20 failures, all reaching the existing closed `peerProposals` capability gate; details are in `.test-artifacts/protocol5-syncthing-check.log`. These changes do not enable later collaboration capabilities or claim a green repository-wide suite. <!-- CHANGE -->

## Historical evidence <!-- CHANGE -->

The combined release is implemented but is not released. Final save-performance qualification is running in the isolated worktree at C:/Users/user/.codex/worktrees/saving-release-candidate/Trellis for Drawio/drawio-desktop. The original checkout remains available for other work; edits there cannot change the captured candidate. The candidate copy records its base revision and copied-file hashes in .test-artifacts/saving-redesign/candidate-capture.json. <!-- NEW -->

The cursor-following rejection originated in succession visibility restoration: setOutlineOnlyVisibleDeep and restoreBaselineTGDeep called model style setters during presentation refresh. Rejection and rollback caused repeated writes. Those paths now update rendered styles and ordering. Parent/child dependency groups, partial-acceptance baselines, newer typing, and duplicate receipts have permanent regressions. The original incident project, trash entry, and recovery files were not restored, converted, or edited. <!-- NEW -->

The isolated candidate passed 627 focused tests covering saving, references, permissions, actor fencing, recovery, dependency groups, export, roadmap invalidation, and qualification guards. After adding the foreground-editor measurement requirement, all 13 interaction-evidence tests passed. Logs are in .test-artifacts/saving-redesign/candidate-focused.log and focus-gate.log. <!-- NEW -->

All six full-application interaction workloads passed against unchanged candidate sources. Each created a bed and Dill planting with 88 circles and the approximately 1.9 MB reference catalog, verified a visible circle target and editor focus, and retained all 30 feedback samples. They reported zero hover content transactions, rejection attempts, selection mutations, or frame timeouts. Undo/redo restored content. Portable XML export and Save As preserved Unicode draft content, required definitions, source path, and modified state. <!-- NEW -->

| Protocol | Campaign 1 p95 | Campaign 2 p95 | Campaign 3 p95 | <!-- NEW -->
| --- | ---: | ---: | ---: | <!-- NEW -->
| 4 | 24.5 ms | 17.9 ms | 23.5 ms | <!-- NEW -->
| 5 | 17.3 ms | 84.8 ms | 17.3 ms | <!-- NEW -->

Interaction evidence: .test-artifacts/saving-redesign/interactions-1793640453833/summary.json. Earlier inactive-window measurements included frame-presentation timeouts and remain retained as failed evidence. The foreground requirement changes the stated test condition; it does not omit initial samples or relax the 100 ms target. <!-- NEW -->

The resumed serial save campaign is .test-artifacts/coordinator-sync/qualification-1793644563619/summary.json. Its verified endpoint evidence was retained from qualification-1793640863038; the intermediate runs remain extra evidence. The user approved reducing qualification to 12 workloads: both protocols, three campaigns, 0/10,000 archived edits, and 30 samples for each operation. The already completed 100- and 1,000-edit workloads are retained as extra evidence. Endpoint evidence is independently revalidated before reuse in the resumed campaign. The real twenty-second autosave quiet period is measured separately. A partial campaign does not qualify the release. The combined checker must confirm both evidence inventories match the exact candidate sources. <!-- NEW -->

Earlier integrated startup passed five native launches with unchanged sources in the original checkout. Evidence is .test-artifacts/responsive-startup/1793585201618/ there. Startup will be checked against the final isolated candidate after the serial timing campaign. Native reruns also passed settings focus, creation, rich-text/alert exports, sandbox/network enforcement, protected-content export, Browse, first-open, and scoped-refresh rollback. <!-- NEW -->

The earlier repository-wide run recorded 3,105 passes, 85 failures, one cancellation, and 10 skips; it is not a green full suite. Its retained original-checkout report is .test-artifacts/saving-redesign/full-suite-current.json. The 29 legacy Syncthing failure names match the frozen baseline. Other failures include legacy collaboration expectations, intentionally closed community capabilities, and obsolete fixtures. Relevant native launch failures and corrected fixtures passed focused reruns. Detailed earlier evidence is preserved in pre-candidate-validation.md beside the candidate artifacts and in the original checkout's logs. <!-- NEW -->

Existing gardens keep their format. No automatic migration or reference garbage collection is introduced. Collaboration capability gates remain closed. No user recovery data is discarded. No build is published or installed by these checks. <!-- NEW -->

The reduced qualification and resume guards passed all 34 tests. They reject missing fresh-project cases, duplicate workloads, altered source inventories, and reused success flags whose raw samples fail the gate. No runtime source changed for the matrix reduction. <!-- NEW -->
