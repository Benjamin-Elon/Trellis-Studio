# Inventories and The Grand Exchange

<!-- NEW: Implementation record for the approved complete-release plan. -->

This feature is **in progress and is not a releasable implementation of the complete
plan**. The Inventories editor and allocation changes have working paths; the
Exchange domain core has unit coverage. Exchange transport, member-facing workflows
and the complete release qualification remain unfinished.

## October 31 repair pass

<!-- CHANGE: Latest approved behavior supersedes the earlier interview's CSA correction and consent rules. -->

CSA uses expected harvest only. There is no actual-yield correction or Produce
inventory. Operators may change future program and enrollment terms without a
member countersignature; member requests still need operator approval. Operator
announcements default on and may be suppressed without removing the private
revision and quote history. The first confirmed collection freezes the whole
pickup, including the other members' allocations.

The audited regression cases now cover stage-specific sowing requirements,
immutable Home Equipment comparison bases and repeated saves, enrollment identity
collisions, capacity reductions, rejected renderer-authored distributions,
idempotent program closure, and silent unchanged projections. The core's
`csa.update` operation stores prospective term versions and original quotes.
`csa.revise` now accepts only notification preferences and obtains expected supply
from a trusted projection callback. These remain domain operations until the
qualified coordinator adapter is connected.

New sowing effects retain their original plant-count, germination-rate and stage
evidence. Auditing old effects does not rewrite actual stock: ambiguous historical
requirements are flagged, and their quantities remain protected until reconciled.
An authenticated historical-evidence reconciliation command remains unfinished.

The frozen coordinator campaign `qualification-1793466975447` was started after
the repair pass, then stopped when exact-source verification detected a concurrent
change to `plugins/Trellis_Syncthing.js`. Its partial measurements do not qualify
the coordinator or authorize peer/community milestones. A new campaign requires
the runtime sources to remain unchanged for its full duration.

`qualification-1793467376703` passed the zero-edit workload; all timing and archive
checks at 100 edits also passed, but a reported machine suspension invalidated that
workload. The benchmark now owns an idle-sleep blocker during each Electron process
and still rejects a real suspension. Its smoke run and all eight qualification
checker tests passed.

The replacement campaign `qualification-1793469686345` passed its zero- and
100-edit workloads. Exact-source verification then detected another chat's change
to `main/trellis-collaboration-store.js` during the 1,000-edit workload, so the
campaign was stopped and its evidence retained. Qualification is now explicitly
deferred at the user's request while other runtime work continues. Peer/community
milestones and the complete release remain gated.

Inventory reads now display unknown protection and available quantities when an
older published crop cannot be mapped. They retain editable current stock and
show the mapping warning instead of reporting zero protected needs or leaving a
half-rendered dialog. Strict requirements used by accounting still reject the
unmapped plan.

## Implemented paths

- `Inventories ▾` replaces Equipment in the editor. Its Equipment provider retains
  the existing editor, graph API, operational attributes, task selections and
  workload integration. Home uses the same editor with authenticated snapshots.
  Definition changes from Home become reference-review proposals; they are not
  accepted by the Equipment save operation.
- The Seeds editor uses one garden attribute, `trellis_seeds_json`. Balances use
  whole seed counts and accepted portable crop/variety identities. Grams and packets
  retain an estimated seeds-per-unit conversion. Negative balances remain visible.
- The shared seed core derives sowing effects from source planting links and stable
  scheduler task keys. Only `direct_sowing` and `seedling_starting` consume seeds;
  transplanting and other tasks anchored on sowing do not. A task may explicitly
  correct its actual quantity with `trellis_seed_quantity`.
- Native task changes and seed effects share an undo edit. Managed saves independently
  derive and validate their effects through the accepted collaboration transaction.
  Stock initialization baselines historical completed tasks. Reopening reverses an
  active deduction, and recompletion reapplies it. Repeated operation delivery and
  restart do not create a second deduction.
- Protected needs include published `plan_year_json` records, excluding the separate
  draft attribute. Completed tasks release their planned requirement. A correction
  changes actual stock without releasing another sowing's protected requirement.
- Garden duplication resets stock and all Exchange bindings, and baselines copied
  completed tasks before new work occurs. Template snapshots carry seed definitions
  and conversions without balances or agreement records. Restoring the original
  garden retains its stored state.
- Year plans persist version 3 with numeric `channelPriorityLevels`: household 1,
  CSA 2 and each sales channel 3 by default. The allocation core fills levels in
  ascending order and divides equal-level shortages proportionally. Summaries and
  exports use numeric levels. Explicit serialization removes obsolete demand-line
  priorities without mutating the live draft.
- Separate garden grants expose seed trading and routine CSA management. Existing
  editing presets do not imply either grant. CSA publication remains restricted
  to the garden owner or an administrator. Exchange authority on a document-level
  grant cannot become authority over every garden.
- The rate service infers common currency defaults from the existing city country,
  caches Frankfurter pair rates with provider date and retrieval time, coalesces
  concurrent requests and retains stale dated estimates offline. It never sends
  agreement amounts to the provider or changes their original currencies.

## Domain core, not yet connected transport

The pure Exchange state machine covers offers and wants, two-party trade approval,
pending reservation validation, exact-variety and explicitly approved substitutions,
partial fulfillment, handover/receipt idempotency, cancellation boundaries and
continued private coordination after membership loss.

Its CSA transitions cover publication authority, base-share capacities, share-size
quotes, prospective operator revisions and member requests, dated cancellations, collection
reporting and confirmation, immutable completed distributions and program closure.
The allocation core generates prospective plan-based baskets from supplied yield
projections, rounds plants per member and rotates shortages using seasonal service
history. Capacity targets and accepted enrollments are separate inputs.

These tests use injected permission and durable-receipt verifiers. They do **not**
prove remote stock reservation, real private-channel access or coordinator recovery.
The Exchange screen currently exposes its tabs and reports this incomplete state;
it does not offer working discovery, publication, enrollment or messaging flows.

## Remaining integration

1. Finish and qualify the coordinator synchronization replacement described in
   [coordinator-sync.md](coordinator-sync.md). Do not enable the old community
   journal or introduce an Exchange replay engine alongside it.
2. Add typed coordinator inventory operations for reserve, release, handover and
   mapped receipt. Each must recheck the original authenticated principal's current
   garden authority, serialize against sowing/protection changes, bind a stable
   operation ID to its immutable content and return a durable signed receipt.
3. Implement community-scoped discovery and encrypted agreement channels in that
   same coordinator architecture. A private garden's source authorization must be
   coordinator-attested without disclosing its canvas. Participant claims alone
   cannot prove authority over a source garden.
4. Wire the narrow main-process `createExchangeService` coordinator adapter:
   `qualified`, `readExchange`, `commitExchange`, `refreshExchange` and
   `onExchangeStatus`. Read results must already be filtered for the authenticated
   session. Commands must derive identity from that session and distinguish queued,
   delivered, awaiting-validation, accepted and resolved states. Receipt evidence
   belongs to the coordinator, not renderer payloads.
5. Connect the full discovery, offer/request, barter, enrollment, amendment,
   distribution and private-thread interfaces. Add a durable activity inbox, read
   cursors, badges and optional desktop notifications. Add currency setup and
   publication previews, including older yearly plans.
6. Connect saved scheduled-planting yields and channel allocations to automatic
   future CSA revisions; preserve completed distributions, notify affected members
   and detect operator garden-access loss. Do not introduce a Produce inventory.
7. Complete real multi-peer, offline, membership-loss, private-channel, restart,
   competing-acceptance and coordinator-recovery tests. Then run the documented
   complete-release qualification against the exact final sources.

`createExchangeService` fails closed while the shared production capability flags
are unavailable or the qualified coordinator adapter is absent. A renderer flag
cannot open this gate. Nothing in this implementation constitutes authorization to
ship a partial release or bypass qualification.

## Validation locations

The new suites are `trellis-inventories`, `trellis-inventories-dom`,
`trellis-inventories-electron`, `trellis-seed-effects`, `trellis-exchange-core`,
`trellis-exchange-rates` and `trellis-exchange-service` under `test/`. Additional
integration cases live in the existing Year Planner, Users, permissions, Garden
library and startup suites. The Electron helper captures inventory screenshots
under `.test-artifacts/inventories`.

The upstream rate API and caching contract is documented at
[Frankfurter](https://frankfurter.dev/). Its values are display estimates; settlement
and payment processing remain outside Trellis.
