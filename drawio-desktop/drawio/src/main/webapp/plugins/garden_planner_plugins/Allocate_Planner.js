Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();
    const MODE_ID = "allocate";
    const ALLOCATE_EVENT = "usl:allocatePlanRequested";
    const HUD_Z = 2000000000;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE: Allocate graph overlays share the Trellis layer contract.
    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ annotation: "trellis-graph-annotation-layer", connection: "trellis-graph-connection-layer", control: "trellis-graph-control-layer", controlTop: "trellis-graph-control-top-layer" }); // CHANGE
    const GRAPH_OVERLAY_LAYER_Z = Object.freeze({ annotation: GRAPH_OVERLAY_Z.ANNOTATION, connection: GRAPH_OVERLAY_Z.CONNECTION, control: GRAPH_OVERLAY_Z.CONTROL, controlTop: GRAPH_OVERLAY_Z.CONTROL_TOP }); // CHANGE
    const EPS = 0.0001;
    const STORE_PREFIX = "trellis.allocate.reviewSuppressed.";
    const DEBUG_STORAGE_KEY = "trellis.allocate.debug"; // CHANGE: gated diagnostics explain Allocate week selection without normal console noise.
    const SCHEDULE_CACHE_VERSION = "sow-week-cache-v1"; // CHANGE: session cache invalidates when Allocate scheduling semantics change.
    const BED_PROFILE_ATTRS = Object.freeze(["sun", "drainage", "fertility", "trellis", "season_extension", "protection", "wind", "bed_use"]); // CHANGE: cache signatures include only active bed conditions that affect lifecycle gates.

    function ensureInteractionModes() {
        window.Trellis = window.Trellis || {};
        if (window.Trellis.interactionModes) return window.Trellis.interactionModes;
        let active = null;
        window.Trellis.interactionModes = {
            request(mode, ownerId, hooks) {
                if (active && active.hooks && typeof active.hooks.close === "function") active.hooks.close({ reason: "replaced" });
                active = { mode: String(mode || ""), ownerId: String(ownerId || mode || ""), hooks: hooks || {} };
                return { mode: active.mode, ownerId: active.ownerId };
            },
            release(mode, ownerId) {
                if (!active || active.mode !== mode || active.ownerId !== ownerId) return false;
                active = null;
                return true;
            },
            closeActive(reason) {
                const previous = active;
                active = null;
                if (previous && previous.hooks && typeof previous.hooks.close === "function") previous.hooks.close({ reason: reason || "closed" });
                return !!previous;
            },
            getActive() { return active ? { mode: active.mode, ownerId: active.ownerId } : null; }
        };
        return window.Trellis.interactionModes;
    }

    function cellId(cell) {
        return String(cell && (cell.getId ? cell.getId() : cell.id) || "");
    }

    function getAttr(cell, key) {
        return cell && cell.getAttribute ? cell.getAttribute(key) : null;
    }

    function setText(node, text) {
        if (node) node.textContent = String(text == null ? "" : text);
    }

    function removeNode(node) {
        try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (_) { }
    }

    function formatKg(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= EPS) return "0 kg";
        return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + " kg";
    }

    function addDaysISO(iso, days) {
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
        if (!parts) return "";
        const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
        d.setUTCDate(d.getUTCDate() + Number(days || 0));
        return d.toISOString().slice(0, 10);
    }

    function compareISO(a, b) {
        return String(a || "").localeCompare(String(b || ""));
    }

    function weekEndISO(week) {
        return addDaysISO(week && week.start || "", 6);
    }

    function weekIndexForISO(coverage, iso) {
        const value = String(iso || "");
        if (!value) return null;
        const weeks = (coverage && coverage.weekSummaries || []).slice().sort((a, b) => Number(a.weekIndex) - Number(b.weekIndex));
        for (let i = 0; i < weeks.length; i++) {
            const start = String(weeks[i] && weeks[i].start || "");
            const nextStart = String(weeks[i + 1] && weeks[i + 1].start || "");
            if (start && compareISO(value, start) >= 0 && (!nextStart || compareISO(value, nextStart) < 0)) return Number(weeks[i].weekIndex);
        }
        return null;
    }

    function defer(fn, delay) {
        const runner = typeof setTimeout === "function" ? setTimeout : window && window.setTimeout;
        return runner ? runner(fn, delay || 0) : (fn(), null);
    }

    function cancelDeferred(id) {
        const cancel = typeof clearTimeout === "function" ? clearTimeout : window && window.clearTimeout;
        if (cancel && id != null) cancel(id);
    }

    function yieldToUi() {
        return new Promise(resolve => defer(resolve, 0));
    }

    function emptyActionSchedule() {
        return { actions: [], unresolved: [], actionableWeekIndices: [] };
    }

    function createScheduleProgress(phase, totalRows) {
        return {
            phase: phase || "idle",
            processedRows: 0,
            totalRows: Math.max(0, Number(totalRows) || 0),
            foundActions: 0,
            unresolvedCount: 0,
            cacheHits: 0,
            cacheMisses: 0,
            cancellations: 0,
            startedAt: Date.now ? Date.now() : 0,
            finishedAt: 0,
            error: ""
        };
    }

    function progressIsActive(progress) {
        const phase = String(progress && progress.phase || "");
        return phase === "loading" || phase === "refreshing" || phase === "scanning demand" || phase === "checking beds";
    }

    function scheduleProgressText(state) {
        const progress = state && state.scheduleProgress || null;
        if (!progress) return "";
        const phase = String(progress.phase || "");
        if (phase === "failed") return "Unable to find sow/start actions: " + (progress.error || "unknown error");
        if (phase === "complete" && progress.totalRows > 0 && progress.foundActions <= 0) return "No feasible sow/start actions found for unmet demand.";
        if (phase === "complete") return "Sow/start actions ready - " + plural(progress.foundActions, "action", "actions") + " found.";
        if (phase === "cancelled") return "Restarting sow/start action search...";
        if (phase === "loading") return "Loading Allocate...";
        if (phase === "refreshing") return "Refreshing recommendations...";
        if (phase === "scanning demand" || phase === "checking beds") {
            return "Finding sow/start actions... " + progress.processedRows + " of " + progress.totalRows + " demand rows - " + plural(progress.foundActions, "action", "actions") + " found.";
        }
        return "";
    }

    function noteCacheAccess(state, hit) {
        if (!state || !state.scheduleProgress) return;
        if (hit) state.scheduleProgress.cacheHits += 1;
        else state.scheduleProgress.cacheMisses += 1;
    }

    function resetScheduleCaches(state) {
        if (!state) return;
        state.lifecycleCache = new Map();
        state.bedResultCache = new Map();
    }

    function selectedWeekHasActions(state) {
        const schedule = state && state.actionSchedule || null;
        return actionRowsForWeek(schedule, state && state.weekIndex).length > 0;
    }

    function normAllocationMethodId(value) {
        return String(value || "").trim().toLowerCase();
    }

    const ALLOCATION_METHOD_CATEGORIES = Object.freeze({
        "transplant.indoor": "transplant",
        "transplant.outdoor": "transplant",
        "transplant.purchased": "transplant",
        "transplant.cutting": "transplant",
        "direct_sow.field": "direct_sow",
        "direct_sow.pre_germinated": "direct_sow",
        "direct_sow.plug": "direct_sow"
    }); // CHANGE: Allocate repairs concrete method/category context before calling lifecycle scheduling.

    function inferAllocationMethodCategory(methodId) {
        const normalized = normAllocationMethodId(methodId);
        return normalized.indexOf(".") > 0 ? normalized.split(".")[0] : "";
    }

    function resolveCropMethodContext(crop) {
        const methodId = normAllocationMethodId(crop && (crop.method || crop.methodId));
        const explicitCategory = normAllocationMethodId(crop && (crop.methodCategoryId || crop.method_category_id));
        const supportedCategory = ALLOCATION_METHOD_CATEGORIES[methodId] || "";
        const inferredCategory = supportedCategory || inferAllocationMethodCategory(methodId);
        if (!methodId) return { ok: false, reason: "invalid Year Plan method" };
        if (methodId.indexOf(".") < 0) return { ok: false, methodId, methodCategoryId: explicitCategory, reason: "Year Plan method must be a concrete method like direct_sow.field." }; // CHANGE: stop category-only legacy methods before scheduler.
        if (!supportedCategory) return { ok: false, methodId, methodCategoryId: explicitCategory || inferredCategory, reason: "Unsupported Year Plan method: " + methodId + "." }; // CHANGE
        return { ok: true, methodId, methodCategoryId: supportedCategory, repairedMethodCategoryId: explicitCategory && explicitCategory !== supportedCategory }; // CHANGE
    }

    function allocationLifecycleReason(reason) {
        const text = String(reason || "").trim();
        if (/methodCategoryId is required/i.test(text)) return "Year Plan method category is missing."; // CHANGE: expose scheduler contract failures as plan data issues.
        if (/does not belong to methodCategoryId/i.test(text)) return "Year Plan method/category mismatch: " + text;
        if (/Unsupported methodId/i.test(text)) return "Unsupported Year Plan method: " + text;
        return text || "No lifecycle.";
    }

    function localStorageSafe() {
        try { return window.localStorage || null; } catch (_) { return null; }
    }

    function allocateDebugEnabled() {
        const store = localStorageSafe();
        return !!(store && store.getItem(DEBUG_STORAGE_KEY) === "1");
    } // CHANGE: diagnostics are opt-in via localStorage.

    function reviewKey(draft) {
        const crop = draft && draft.crop || {};
        return STORE_PREFIX + [crop.plantId || "", crop.varietyId || "", crop.method || ""].join("|");
    }

    function isReviewSuppressed(draft) {
        const store = localStorageSafe();
        return !!(store && store.getItem(reviewKey(draft)) === "1");
    }

    function setReviewSuppressed(draft) {
        const store = localStorageSafe();
        if (store) store.setItem(reviewKey(draft), "1");
    }

    function graphOriginForCell(cell) {
        let x = 0;
        let y = 0;
        let cur = cell;
        while (cur) {
            const geo = cur.getGeometry && cur.getGeometry();
            if (geo) {
                x += Number(geo.x) || 0;
                y += Number(geo.y) || 0;
            }
            cur = model.getParent ? model.getParent(cur) : null;
        }
        return { x, y };
    }

    function ensureGraphOverlayContainer() {
        const host = graph.container;
        if (!host) return null;
        try {
            if (window.getComputedStyle && window.getComputedStyle(host).position === "static") host.style.position = "relative";
        } catch (_) { }
        return host;
    } // CHANGE: Allocate overlays now attach to the graph container like roadmap overlays.

    function ensureGraphOverlayHtmlLayer(layerKey) {
        const host = ensureGraphOverlayContainer();
        const key = GRAPH_OVERLAY_LAYER_CLASS[layerKey] ? layerKey : "control";
        const className = GRAPH_OVERLAY_LAYER_CLASS[key];
        if (!host || !className || !host.querySelector || !host.appendChild) return null;
        let layer = host.querySelector("." + className);
        if (!layer) {
            layer = document.createElement("div");
            layer.className = className;
            layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:" + GRAPH_OVERLAY_LAYER_Z[key] + ";";
            host.appendChild(layer);
        }
        return layer;
    } // CHANGE: reuse the shared graph-local HTML overlay layer pattern.

    function graphPointToContainer(x, y) {
        const container = graph.container || {};
        const view = graph.view || {};
        const scale = Number(view.scale) || 1;
        const tr = view.translate || { x: 0, y: 0 };
        return {
            left: (Number(x || 0) + Number(tr.x || 0)) * scale + Number(container.scrollLeft || 0),
            top: (Number(y || 0) + Number(tr.y || 0)) * scale + Number(container.scrollTop || 0),
            scale
        };
    } // CHANGE: graph-local overlays need container-relative coordinates, not viewport coordinates.

    function graphView() {
        return graph.getView && graph.getView() || graph.view || null;
    } // CHANGE: view listeners and visual bounds use the same graph view source.

    function stateHostBounds(cell, state, host) {
        if (!state) return null;
        const shapeNode = state.shape && state.shape.node ? state.shape.node : null;
        if (shapeNode && shapeNode.getBoundingClientRect && host && host.getBoundingClientRect) {
            const rect = shapeNode.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            if (rect && hostRect && rect.width > 0 && rect.height > 0) {
                return {
                    left: rect.left - hostRect.left + Number(host.scrollLeft || 0),
                    top: rect.top - hostRect.top + Number(host.scrollTop || 0),
                    width: rect.width,
                    height: rect.height,
                    scale: Number((graphView() || {}).scale) || 1
                };
            }
        }
        return {
            left: Number(state.x) || 0,
            top: Number(state.y) || 0,
            width: Math.max(1, Number(state.width) || 1),
            height: Math.max(1, Number(state.height) || 1),
            scale: Number((graphView() || {}).scale) || 1
        };
    } // CHANGE: bed badges anchor to the rendered mxGraph state, including zoom/pan.

    function cellVisualBounds(cell, host) {
        const shared = graph.__trellisTaskUi;
        if (shared && typeof shared.getCellVisualBounds === "function") {
            const bounds = shared.getCellVisualBounds(cell, host || graph.container);
            if (bounds) {
                return {
                    left: Number(bounds.x) || 0,
                    top: Number(bounds.y) || 0,
                    width: Math.max(1, Number(bounds.width) || 1),
                    height: Math.max(1, Number(bounds.height) || 1),
                    scale: Number((graphView() || {}).scale) || 1
                };
            }
        }
        const view = graphView();
        const state = view && typeof view.getState === "function" ? view.getState(cell) : null;
        return stateHostBounds(cell, state, host || graph.container);
    } // CHANGE: reuse shared visual bounds when present so rotated beds stay anchored.

    function cellContainerRect(cell, host) {
        const visual = cellVisualBounds(cell, host);
        if (visual) return visual;
        const geo = cell && cell.getGeometry ? cell.getGeometry() : null;
        const view = graphView() || {};
        const scale = Number(view.scale) || 1;
        const origin = graphOriginForCell(model.getParent ? model.getParent(cell) : null);
        const point = graphPointToContainer(origin.x + Number(geo && geo.x || 0), origin.y + Number(geo && geo.y || 0));
        return {
            left: point.left,
            top: point.top,
            width: Math.max(1, Number(geo && geo.width || 1) * scale),
            height: Math.max(1, Number(geo && geo.height || 1) * scale),
            scale
        };
    } // CHANGE: bed badges are positioned inside the graph overlay layer.

    function cellScreenRect(cell) {
        const geo = cell && cell.getGeometry ? cell.getGeometry() : null;
        const container = graph.container;
        const hostRect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : { left: 0, top: 0 };
        const view = graph.view || {};
        const scale = Number(view.scale) || 1;
        const tr = view.translate || { x: 0, y: 0 };
        const origin = graphOriginForCell(model.getParent ? model.getParent(cell) : null);
        return {
            left: hostRect.left + (origin.x + Number(geo && geo.x || 0) + Number(tr.x || 0)) * scale,
            top: hostRect.top + (origin.y + Number(geo && geo.y || 0) + Number(tr.y || 0)) * scale,
            width: Math.max(1, Number(geo && geo.width || 1) * scale),
            height: Math.max(1, Number(geo && geo.height || 1) * scale),
            scale
        };
    }

    function graphPointToScreen(x, y) {
        const container = graph.container;
        const hostRect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : { left: 0, top: 0 };
        const view = graph.view || {};
        const scale = Number(view.scale) || 1;
        const tr = view.translate || { x: 0, y: 0 };
        return {
            left: hostRect.left + (Number(x || 0) + Number(tr.x || 0)) * scale,
            top: hostRect.top + (Number(y || 0) + Number(tr.y || 0)) * scale,
            scale
        };
    } // CHANGE: uncommitted proposal geometry is already in graph coordinates.

    function lifecycleHarvestStart(lifecycle) {
        return lifecycle && lifecycle.attributePatch && lifecycle.attributePatch.harvest_start
            || lifecycle && lifecycle.result && lifecycle.result.timelines && lifecycle.result.timelines[0] && lifecycle.result.timelines[0].harvestStart
            || "";
    }

    function lifecycleHarvestEnd(lifecycle) {
        return lifecycle && lifecycle.attributePatch && lifecycle.attributePatch.harvest_end
            || lifecycle && lifecycle.result && lifecycle.result.timelines && lifecycle.result.timelines[0] && lifecycle.result.timelines[0].harvestEnd
            || "";
    }

    function methodBedEntryLabel(method) {
        return String(method || "").indexOf("transplant") >= 0 ? "Transplant" : "Sow";
    }

    function priorityRank(crop) {
        const p = String(crop && crop.priority || crop && crop.demandPriority || "").toLowerCase();
        if (p === "committed") return 0;
        if (p === "target") return 1;
        if (p === "optional") return 2;
        return 1;
    }

    function preferenceRank(crop) {
        const p = String(crop && crop.preference || "").toLowerCase();
        if (p === "high") return 0;
        if (p === "low") return 2;
        return 1;
    }

    function cropLabel(crop) {
        return [crop && crop.plant, crop && crop.variety].filter(Boolean).join(" - ") || String(crop && crop.id || "Crop");
    }

    function planCropById(plan, cropId) {
        return ((plan && plan.crops) || []).find(crop => String(crop.id) === String(cropId)) || null;
    }

    function opportunityContainsCrop(opportunityModel, cropId) {
        const id = String(cropId || "");
        return ["actionable", "unresolved", "satisfied"].some(key => ((opportunityModel && opportunityModel[key]) || []).some(crop => String(crop.cropId || crop.id || "") === id));
    }

    function weekCropShortage(coverage, weekIndex, cropId) {
        const week = (coverage && coverage.weekSummaries || []).find(item => item.weekIndex === weekIndex);
        const row = week && (week.cropShortages || []).find(item => String(item.cropId) === String(cropId));
        return Math.max(0, Number(row && row.shortKg) || 0);
    }

    function buildOpportunityModel(plan, coverage, options = {}) {
        const hasWeek = Number.isFinite(Number(options.weekIndex));
        const weekIndex = Number(options.weekIndex);
        const crops = (plan && plan.crops || []).map(crop => {
            const summary = (coverage.cropSummaries || []).find(item => String(item.cropId) === String(crop.id)) || {};
            const selectedWeekShortKg = hasWeek ? weekCropShortage(coverage, weekIndex, crop.id) : Number(summary.shortKg) || 0;
            return Object.assign({}, crop, {
                cropId: String(crop.id || ""),
                label: cropLabel(crop),
                targetKg: Number(summary.targetKg) || 0,
                shortKg: Number(summary.shortKg) || 0,
                selectedWeekShortKg,
                status: summary.status || "no_demand"
            });
        });
        const actionable = crops.filter(crop => (hasWeek ? crop.selectedWeekShortKg : crop.shortKg) > EPS && crop.plantId && crop.method && !isPerennialPlanCrop(crop));
        const unresolved = crops.filter(crop => (hasWeek ? crop.selectedWeekShortKg : crop.shortKg) > EPS && (!crop.plantId || !crop.method || isPerennialPlanCrop(crop))).map(crop => {
            const reason = isPerennialPlanCrop(crop) ? "new perennial allocation deferred" : (!crop.method ? "invalid Year Plan method" : "missing plant identity");
            return Object.assign({}, crop, { unresolvedReason: reason });
        });
        const satisfied = crops.filter(crop => crop.targetKg > EPS && (hasWeek ? crop.selectedWeekShortKg <= EPS : crop.shortKg <= EPS));
        actionable.sort((a, b) => {
            const pa = priorityRank(a) - priorityRank(b);
            if (pa) return pa;
            const urgency = Number(a.nextWindowDays ?? 9999) - Number(b.nextWindowDays ?? 9999);
            if (urgency) return urgency;
            const sa = (b.shortKg / Math.max(1, b.targetKg)) - (a.shortKg / Math.max(1, a.targetKg));
            if (Math.abs(sa) > EPS) return sa;
            const pr = preferenceRank(a) - preferenceRank(b);
            if (pr) return pr;
            const suitability = Number(b.selectedBedSuitability || 0) - Number(a.selectedBedSuitability || 0);
            if (suitability) return suitability;
            return a.label.localeCompare(b.label);
        });
        const actionableWeekIndices = (coverage.weekSummaries || []).filter(week => Number(week.shortKg) > EPS).map(week => week.weekIndex);
        return { actionable, unresolved, satisfied, actionableWeekIndices };
    }

    function isPerennialPlanCrop(crop) {
        return String(crop && crop.lifecycle || "").toLowerCase() === "perennial" || String(crop && crop.perennial || "") === "1";
    }

    function selectedWeek(state) {
        return (state.coverage.weekSummaries || []).find(week => week.weekIndex === state.weekIndex) || state.coverage.weekSummaries[0] || null;
    }

    function weekSummaryByIndex(coverage, weekIndex) {
        const index = Number(weekIndex);
        return (coverage && coverage.weekSummaries || []).find(week => Number(week.weekIndex) === index) || null;
    } // CHANGE: week dropdown needs stable labels for any shortage week, not only the selected week.

    function plural(count, singular, pluralLabel) {
        return count + " " + (count === 1 ? singular : pluralLabel);
    } // CHANGE: keep week status labels compact and consistent.

    function weekStatusText(model) {
        const actionable = (model && model.actionable || []).length;
        const unresolved = (model && model.unresolved || []).length;
        const parts = [];
        if (actionable) parts.push(plural(actionable, "actionable", "actionable"));
        if (unresolved) parts.push(plural(unresolved, "issue", "issues"));
        return parts.length ? parts.join(", ") : "covered";
    } // CHANGE: summarize why a shortage week is useful to visit.

    function actionRowsForWeek(schedule, weekIndex) {
        const index = Number(weekIndex);
        return (schedule && schedule.actions || []).filter(row => Number(row.actionWeekIndex) === index);
    }

    function actionWeekIndices(schedule) {
        return Array.from(new Set((schedule && schedule.actions || []).map(row => Number(row.actionWeekIndex)).filter(Number.isFinite))).sort((a, b) => a - b);
    }

    function cropWithAllocationTiming(crop, row) {
        return Object.assign({}, crop || row && row.crop || {}, {
            cropId: String(row && row.cropId || crop && crop.cropId || crop && crop.id || ""),
            label: String(row && row.label || cropLabel(crop || row && row.crop)),
            shortKg: Math.max(0, Number((row && row.futureDemandKg) ?? (row && row.shortKg)) || 0), // CHANGE: parenthesized nullish fallback parses during default startup.
            selectedWeekShortKg: Math.max(0, Number((row && row.futureDemandKg) ?? (row && row.shortKg)) || 0),
            allocationDemandWeekIndex: Number(row && row.demandWeekIndex),
            allocationDemandWeekIndices: (row && row.demandWeekIndices || []).slice(),
            allocationDemandStartISO: String(row && row.targetDemandStartISO || ""),
            allocationDemandEndISO: String(row && row.targetDemandEndISO || ""),
            allocationActionWeekIndex: Number(row && row.actionWeekIndex),
            allocationActionStartISO: String(row && row.actionStartISO || ""),
            allocationBedEntryISO: String(row && row.bedEntryISO || ""),
            selectedBedSuitability: Number(row && row.selectedBedSuitability || 0)
        });
    }

    function buildSowWeekOpportunityModel(state, weekIndex) {
        const index = Number(Number.isFinite(Number(weekIndex)) ? weekIndex : state && state.weekIndex);
        const schedule = state && state.actionSchedule || { actions: [], unresolved: [] };
        const actions = actionRowsForWeek(schedule, index).map(row => cropWithAllocationTiming(row.crop, row));
        const unresolved = (schedule.unresolved || []).filter(row => Number(row.actionWeekIndex) === index).map(row => Object.assign(cropWithAllocationTiming(row.crop, row), { unresolvedReason: row.reason || "not currently allocatable" }));
        return { actionable: actions, unresolved, satisfied: [], actionableWeekIndices: actionWeekIndices(schedule) };
    }

    function buildWeekOptionLabel(state, weekIndex) {
        const index = Number(weekIndex);
        const week = weekSummaryByIndex(state && state.coverage, index);
        const date = week && week.start ? " - " + week.start : "";
        if (state && state.actionSchedule) {
            const rows = actionRowsForWeek(state.actionSchedule, index);
            const futureDemandKg = rows.reduce((sum, row) => sum + Math.max(0, Number(row.futureDemandKg) || 0), 0);
            if (!rows.length && progressIsActive(state.scheduleProgress)) {
                return "Week " + (index + 1) + date + " - finding actions...";
            }
            return "Week " + (index + 1) + date + " - " + plural(rows.length, "sow action", "sow actions") + " - " + formatKg(futureDemandKg) + " future demand";
        }
        const modelForWeek = state && Number(state.weekIndex) === index && state.opportunityModel
            ? state.opportunityModel
            : buildOpportunityModel(state && state.plan, state && state.coverage, { weekIndex: index });
        return "Week " + (index + 1) + date + " - " + formatKg(week && week.shortKg) + " short - " + weekStatusText(modelForWeek);
    } // CHANGE: dropdown options expose sow-week actions instead of demand-week shortages.

    function buildDebugWeekRow(week) {
        const shortages = Array.isArray(week && week.cropShortages) ? week.cropShortages : [];
        return {
            week: Number(week && week.weekIndex) + 1,
            weekIndex: Number(week && week.weekIndex),
            start: String(week && week.start || ""),
            targetKg: Math.max(0, Number(week && week.targetKg) || 0),
            shortKg: Math.max(0, Number(week && week.shortKg) || 0),
            cropShortageCount: shortages.length,
            cropShortages: shortages.map(row => String(row && row.label || row && row.cropId || "Crop") + " " + formatKg(row && row.shortKg)).join(", ")
        };
    } // CHANGE: console diagnostics use compact, table-friendly week rows.

    function demandRangeRow(kind, row, fallback = {}) {
        const source = row || {};
        return {
            kind,
            id: String(source.id || fallback.id || ""),
            cropId: String(source.cropId || fallback.cropId || ""),
            channelId: String(source.channelId || fallback.channelId || ""),
            enabled: source.enabled !== false && fallback.enabled !== false,
            from: String(source.from || source.start || fallback.from || fallback.start || ""),
            to: String(source.to || source.end || fallback.to || fallback.end || ""),
            qty: source.qty ?? fallback.qty ?? "",
            unit: String(source.unit || fallback.unit || "")
        };
    } // CHANGE: normalize saved demand inputs for debug output.

    function buildDemandRangeRows(plan) {
        const rows = [];
        const demandLines = Array.isArray(plan && plan.demands) ? plan.demands : [];
        demandLines.forEach(line => rows.push(demandRangeRow("demand", line)));
        const selfLines = Array.isArray(plan && plan.selfSufficiency && plan.selfSufficiency.lines) ? plan.selfSufficiency.lines : [];
        selfLines.forEach(line => rows.push(demandRangeRow("self", line, { enabled: !(plan && plan.selfSufficiency && plan.selfSufficiency.enabled === false) })));
        const csa = plan && plan.csa || null;
        if (csa) {
            rows.push(demandRangeRow("csa", csa, { id: "csa", from: csa.start, to: csa.end, qty: csa.boxesPerWeek, unit: "boxes/week", enabled: csa.enabled !== false }));
            const components = Array.isArray(csa.components) ? csa.components : [];
            components.forEach((component, index) => rows.push(demandRangeRow("csa_component", component, { id: "component_" + (index + 1), from: csa.start, to: csa.end, enabled: csa.enabled !== false })));
        }
        return rows;
    } // CHANGE: expose raw demand windows that can make the first shortage week surprising.

    function firstWeekRow(rows, predicate) {
        return (rows || []).find(predicate) || null;
    }

    function buildAllocationDebugSnapshot(state) {
        const coverage = state && state.coverage || {};
        const weekRows = (coverage.weekSummaries || []).map(buildDebugWeekRow);
        const selected = weekRows.find(row => row.weekIndex === Number(state && state.weekIndex)) || null;
        const firstDemandWeek = firstWeekRow(weekRows, row => Number(row.targetKg) > EPS);
        const firstShortageWeek = firstWeekRow(weekRows, row => Number(row.shortKg) > EPS);
        const opportunityModel = state && state.opportunityModel || {};
        return {
            year: Number(state && state.year) || null,
            selectedWeek: selected,
            firstDemandWeek,
            firstShortageWeek,
            totals: {
                targetKg: Math.max(0, Number(coverage.totals && coverage.totals.targetKg) || 0),
                shortKg: Math.max(0, Number(coverage.totals && coverage.totals.shortKg) || 0)
            },
            opportunityCounts: {
                actionable: (opportunityModel.actionable || []).length,
                unresolved: (opportunityModel.unresolved || []).length,
                satisfied: (opportunityModel.satisfied || []).length
            },
            progress: state && state.scheduleProgress ? {
                phase: String(state.scheduleProgress.phase || ""),
                processedRows: Number(state.scheduleProgress.processedRows) || 0,
                totalRows: Number(state.scheduleProgress.totalRows) || 0,
                foundActions: Number(state.scheduleProgress.foundActions) || 0,
                unresolvedCount: Number(state.scheduleProgress.unresolvedCount) || 0,
                cacheHits: Number(state.scheduleProgress.cacheHits) || 0,
                cacheMisses: Number(state.scheduleProgress.cacheMisses) || 0,
                cancellations: Number(state.scheduleProgress.cancellations) || 0,
                elapsedMs: state.scheduleProgress.finishedAt && state.scheduleProgress.startedAt ? Math.max(0, Number(state.scheduleProgress.finishedAt) - Number(state.scheduleProgress.startedAt)) : 0
            } : null,
            demandRanges: buildDemandRangeRows(state && state.plan),
            weeks: weekRows
        };
    } // CHANGE: single testable source of truth for Allocate week diagnostics.

    function logAllocationDebugSnapshot(state, eventName) {
        if (!allocateDebugEnabled() || typeof console === "undefined") return;
        const snapshot = buildAllocationDebugSnapshot(state);
        const label = "Trellis Allocate " + (eventName || "debug") + " - " + (snapshot.year || "year");
        try {
            if (console.groupCollapsed) console.groupCollapsed(label);
            else if (console.log) console.log(label);
            if (console.log) console.log({ selectedWeek: snapshot.selectedWeek, firstDemandWeek: snapshot.firstDemandWeek, firstShortageWeek: snapshot.firstShortageWeek, totals: snapshot.totals, opportunityCounts: snapshot.opportunityCounts, progress: snapshot.progress });
            if (console.table) {
                console.table(snapshot.demandRanges);
                console.table(snapshot.weeks);
            } else if (console.log) {
                console.log("demandRanges", snapshot.demandRanges);
                console.log("weeks", snapshot.weeks);
            }
        } finally {
            if (console.groupEnd) console.groupEnd();
        }
    } // CHANGE: opt-in console output for explaining selected week behavior.

    function findTilerGroupAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (getAttr(cur, "tiler_group") === "1") return cur;
            cur = model.getParent ? model.getParent(cur) : null;
        }
        return null;
    }

    function bedContainingGroupCenter(state, groupCell) {
        const geo = groupCell && groupCell.getGeometry && groupCell.getGeometry();
        if (!geo) return null;
        const cx = (Number(geo.x) || 0) + (Number(geo.width) || 0) / 2;
        const cy = (Number(geo.y) || 0) + (Number(geo.height) || 0) / 2;
        return (state.beds || []).find(bed => {
            const bg = bed && bed.getGeometry && bed.getGeometry();
            return !!(bg && cx >= Number(bg.x || 0) && cx <= Number(bg.x || 0) + Number(bg.width || 0) && cy >= Number(bg.y || 0) && cy <= Number(bg.y || 0) + Number(bg.height || 0));
        }) || null;
    }

    function currentBedContext(state) {
        const selected = graph.getSelectionCell && graph.getSelectionCell();
        const selectedId = cellId(selected);
        const selectedBed = (state.beds || []).find(bed => cellId(bed) === selectedId);
        if (selectedBed) return { bed: selectedBed, planting: null };
        const group = findTilerGroupAncestor(selected);
        const bed = group ? bedContainingGroupCenter(state, group) : null;
        return bed ? { bed, planting: group } : null;
    }

    function rankBedResult(result) {
        if (!result || !result.ok) return 1000000;
        return (result.geometry && result.geometry.capacity || 0) - (result.plantCount || 0);
    }

    function stableStringify(value) {
        if (!value || typeof value !== "object") return String(value || "");
        const keys = Object.keys(value).sort();
        const out = {};
        keys.forEach(key => { out[key] = value[key]; });
        try { return JSON.stringify(out); } catch (_) { return ""; }
    }

    function stableSignatureValue(value, depth, seen) {
        if (value == null) return null;
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
        if (typeof value !== "object") return String(value || "");
        if (value.getId || value.getAttribute) return { cellId: cellId(value) };
        if ((depth || 0) > 8) return "[depth]";
        const prior = seen || [];
        if (prior.includes(value)) return "[circular]";
        const nextSeen = prior.concat([value]);
        if (Array.isArray(value)) return value.map(item => stableSignatureValue(item, (depth || 0) + 1, nextSeen));
        const out = {};
        Object.keys(value).sort().forEach(key => {
            if (key === "cell" || key === "parent" || key === "children") return;
            const child = value[key];
            if (typeof child === "function") return;
            out[key] = stableSignatureValue(child, (depth || 0) + 1, nextSeen);
        });
        return out;
    }

    function stableSignature(value) {
        try { return JSON.stringify(stableSignatureValue(value, 0, [])); } catch (_) { return ""; }
    }

    function geometrySignature(cell) {
        const geo = cell && cell.getGeometry && cell.getGeometry();
        return geo ? {
            x: Number(geo.x) || 0,
            y: Number(geo.y) || 0,
            width: Number(geo.width) || 0,
            height: Number(geo.height) || 0
        } : null;
    }

    function bedSignature(bed) {
        const attrs = {};
        BED_PROFILE_ATTRS.forEach(key => {
            const value = String(getAttr(bed, key) || "").trim();
            if (value) attrs[key] = value;
        });
        return { id: cellId(bed), label: String(getAttr(bed, "label") || ""), geometry: geometrySignature(bed), attrs };
    }

    function schedulerDefaultsSignature(scheduler) {
        try {
            if (scheduler && typeof scheduler.getAllocationDefaultsVersion === "function") return String(scheduler.getAllocationDefaultsVersion() || "");
            return String(scheduler && (scheduler.allocationDefaultsVersion || scheduler.defaultsVersion) || "");
        } catch (_) {
            return "";
        }
    }

    function buildScheduleCacheSignature(state) {
        return stableSignature({
            version: SCHEDULE_CACHE_VERSION,
            moduleId: cellId(state && state.moduleCell),
            year: Number(state && state.year) || 0,
            plan: state && state.plan || null,
            beds: (state && state.beds || []).map(bedSignature).sort((a, b) => a.id.localeCompare(b.id)),
            occupancy: (state && state.occupancy || []).map(item => stableSignatureValue(item, 0, [])).sort((a, b) => stableSignature(a).localeCompare(stableSignature(b))),
            schedulerDefaults: schedulerDefaultsSignature(window.USL && window.USL.scheduler)
        });
    }

    function clonePlain(value) {
        try { return JSON.parse(JSON.stringify(value == null ? null : value)); } catch (_) { return null; }
    }

    function occupancySignature(state) {
        return (state && state.occupancy || []).map(item => [item && item.groupId || item && item.id || "", item && item.entryISO || "", item && item.harvestEndISO || ""].join(":"))
            .sort()
            .join("|");
    }

    function demandWeekKey(state, crop) {
        const week = targetDemandWeekForCrop(state, crop);
        return [Number(week && week.weekIndex), String(week && week.start || ""), weekEndISO(week)].join("@");
    }

    function cropMethodCacheKey(state, crop) {
        return [
            state && state.year || "",
            crop && (crop.cropId || crop.id) || "",
            crop && crop.plantId || "",
            crop && crop.varietyId || "",
            crop && (crop.method || crop.methodId) || "",
            demandWeekKey(state, crop)
        ].join("|");
    }

    function lifecycleCacheKey(state, crop, bedProfile) {
        return cropMethodCacheKey(state, crop) + "|profile:" + stableStringify(bedProfile);
    }

    function bedResultCacheKey(state, crop, bed) {
        return cropMethodCacheKey(state, crop) + "|bed:" + cellId(bed) + "|occ:" + occupancySignature(state);
    }

    function targetDemandWeekForCrop(state, crop) {
        const index = Number(crop && crop.allocationDemandWeekIndex);
        return Number.isFinite(index) ? weekSummaryByIndex(state && state.coverage, index) : selectedWeek(state);
    }

    async function proposeAllocationLifecycle(scheduler, options) {
        if (scheduler && typeof scheduler.proposeLifecycleForDemandWindow === "function") return await scheduler.proposeLifecycleForDemandWindow(options);
        return await scheduler.proposeLifecycle(Object.assign({}, options, {
            weekStartISO: options.targetStartISO,
            weekEndISO: options.targetEndISO,
            chooseBestFeasibleDay: true
        }));
    }

    async function resolveAllocationContext(state, crop, bed) {
        const scheduler = window.USL && window.USL.scheduler;
        const tiler = window.USL && window.USL.tiler;
        const planning = window.USL && window.USL.planningCore;
        if (!scheduler || !tiler || !planning) return { ok: false, status: "structural_failure", reason: "Allocate contracts are unavailable." };
        const plantResolution = await scheduler.resolvePlantForPlanCrop({ plantId: crop.plantId, varietyId: crop.varietyId });
        if (!plantResolution || !plantResolution.ok) return { ok: false, status: "structural_failure", reason: plantResolution && plantResolution.reason || "Plant not found." };
        const demandWeek = targetDemandWeekForCrop(state, crop);
        const targetStartISO = demandWeek && demandWeek.start || "";
        const targetEndISO = weekEndISO(demandWeek);
        const methodContext = resolveCropMethodContext(crop);
        if (!methodContext.ok) return { ok: false, status: "structural_failure", reason: methodContext.reason, bed, crop, plantResolution }; // CHANGE: validate saved Year Plan method context before lifecycle scheduling.
        const bedProfile = tiler.readBedProfile(bed);
        const lifecycleKey = lifecycleCacheKey(state, crop, bedProfile);
        let lifecycle = crop && crop.allocationLifecycle || null; // CHANGE: allocation scheduler edits can supply a reviewed lifecycle.
        if (!lifecycle) lifecycle = state.lifecycleCache && state.lifecycleCache.get(lifecycleKey);
        noteCacheAccess(state, !!lifecycle);
        if (!lifecycle) {
            lifecycle = await proposeAllocationLifecycle(scheduler, {
                plant: plantResolution.plant,
                city: state.city,
                methodId: methodContext.methodId,
                methodCategoryId: methodContext.methodCategoryId, // CHANGE: preserve planting method category through allocation lifecycle scheduling.
                targetStartISO,
                targetEndISO,
                seasonStartYear: state.year,
                varietyName: plantResolution.varietyName,
                bedProfile,
                bedProfileSource: getAttr(bed, "label") || "garden bed"
            });
            if (state.lifecycleCache) state.lifecycleCache.set(lifecycleKey, lifecycle);
        }
        if (!lifecycle || !lifecycle.ok) return { ok: false, status: "structural_failure", reason: allocationLifecycleReason(lifecycle && lifecycle.reason), bed, crop, plantResolution, lifecycle, demandWeek }; // CHANGE
        const harvestStart = lifecycleHarvestStart(lifecycle);
        const harvestEnd = lifecycleHarvestEnd(lifecycle);
        const actionStartISO = lifecycle.startISO || lifecycle.primaryDateISO || "";
        const kgPerPlant = Number(crop.kgPerPlant || plantResolution.plant.yield_per_plant_kg || plantResolution.plant.yield_kg_per_plant || 0);
        if (!Number.isFinite(kgPerPlant) || kgPerPlant <= EPS) return { ok: false, status: "structural_failure", reason: "Missing yield data.", bed, crop, lifecycle, plantResolution, demandWeek };
        return { ok: true, scheduler, tiler, planning, plantResolution, lifecycle, actionStartISO, demandWeek, targetStartISO, targetEndISO, harvestStart, harvestEnd, kgPerPlant };
    }

    function recommendFullPlantCount(state, crop, context) {
        const recommendation = context.planning.recommendPlantCount({
            moduleCell: state.moduleCell,
            year: state.year,
            plan: state.plan,
            candidate: {
                cropId: crop.cropId || crop.id,
                harvestStart: context.harvestStart,
                harvestEnd: context.harvestEnd,
                kgPerPlant: context.kgPerPlant,
                shelfLifeDays: crop.shelfLifeDays || context.plantResolution.plant.shelf_life_days || 0
            }
        });
        if (Number(recommendation.reachableShortKg) <= EPS) return { ok: false, status: "no_fit", reason: "No reachable demand", recommendation };
        return {
            ok: true,
            recommendation,
            fullPlantCount: Math.max(1, Math.trunc(Number(recommendation.plantCount) || 0))
        };
    }

    function proposeGeometryForPlantCount(state, crop, bed, context, plantCount, orientationOverride) {
        return context.tiler.proposePlantingGeometry({
            bedCell: bed,
            plantCount,
            spacingXCm: context.plantResolution.plant.spacing_x_cm || context.plantResolution.plant.spacing_cm || 30,
            spacingYCm: context.plantResolution.plant.spacing_y_cm || context.plantResolution.plant.spacing_cm || 30,
            vegHeightCm: context.plantResolution.plant.veg_height_cm || null,
            occupancy: state.occupancy || [],
            entryISO: context.lifecycle.primaryDateISO || context.actionStartISO,
            harvestEndISO: context.harvestEnd,
            orientationOverride: orientationOverride != null ? orientationOverride : (crop.orientationOverride || "")
        });
    }

    function demandServedByCandidate(state, crop, context, plantCount) {
        const simulation = context.planning.simulateCandidatePlanting({
            moduleCell: state.moduleCell,
            year: state.year,
            plan: state.plan,
            candidate: {
                cropId: crop.cropId || crop.id,
                harvestStart: context.harvestStart,
                harvestEnd: context.harvestEnd,
                kgPerPlant: context.kgPerPlant,
                plantCount,
                shelfLifeDays: crop.shelfLifeDays || context.plantResolution.plant.shelf_life_days || 0
            }
        });
        return Math.max(0, Number(simulation && simulation.demandServedKg) || 0);
    }

    function partialAllocationWarning(plantCount, fullPlantCount) {
        return "Partial allocation: " + plantCount + " of " + fullPlantCount + " plants fit in this bed.";
    }

    function allocationWarnings(lifecycle, geometry, partialWarning) {
        return [].concat(lifecycle && lifecycle.warnings || [], geometry && geometry.warnings || [], partialWarning ? [partialWarning] : []);
    }

    function buildBedResult(state, crop, bed, context, geometry, plantCount, fullPlantCount, partialWarning) {
        const warnings = allocationWarnings(context.lifecycle, geometry, partialWarning);
        const status = (context.lifecycle.status === "warning" || geometry.status === "warning" || warnings.length) ? "warning" : "compatible";
        return {
            ok: true,
            status,
            bed,
            crop,
            plantResolution: context.plantResolution,
            lifecycle: context.lifecycle,
            geometry,
            plantCount,
            fullPlantCount,
            partialPlanting: !!partialWarning,
            partialWarning: partialWarning || "",
            kgPerPlant: context.kgPerPlant,
            harvestStart: context.harvestStart,
            harvestEnd: context.harvestEnd,
            actionStartISO: context.actionStartISO,
            targetDemandStartISO: context.targetStartISO,
            targetDemandEndISO: context.targetEndISO,
            targetDemandWeekIndex: context.demandWeek && context.demandWeek.weekIndex,
            demandServedKg: demandServedByCandidate(state, crop, context, plantCount),
            projectedKg: plantCount * context.kgPerPlant,
            taskPreview: context.lifecycle.taskPreview || [],
            warnings,
            conflictGroupIds: geometry.conflictGroupIds || []
        };
    }

    function cachedBedResult(state, key, result, bed, crop) {
        const value = Object.assign({ bed, crop }, result || {});
        if (state && state.bedResultCache && key) state.bedResultCache.set(key, value);
        return value;
    }

    async function computeBedResult(state, crop, bed) {
        const cacheKey = state && state.bedResultCache && !(crop && crop.allocationLifecycle) ? bedResultCacheKey(state, crop, bed) : ""; // CHANGE: edited scheduler lifecycles must not reuse stale bed results.
        if (cacheKey && state.bedResultCache.has(cacheKey)) {
            noteCacheAccess(state, true);
            return Object.assign({}, state.bedResultCache.get(cacheKey), { bed, crop });
        }
        if (cacheKey) noteCacheAccess(state, false);
        const context = await resolveAllocationContext(state, crop, bed);
        if (!context || !context.ok) return cachedBedResult(state, cacheKey, Object.assign({ bed, crop }, context || {}), bed, crop);
        const need = recommendFullPlantCount(state, crop, context);
        if (!need.ok) return cachedBedResult(state, cacheKey, { ok: false, status: need.status, reason: need.reason, bed, crop, lifecycle: context.lifecycle, plantResolution: context.plantResolution, recommendation: need.recommendation }, bed, crop);
        const fullPlantCount = need.fullPlantCount;
        const fullGeometry = proposeGeometryForPlantCount(state, crop, bed, context, fullPlantCount);
        if (fullGeometry && fullGeometry.ok) return cachedBedResult(state, cacheKey, buildBedResult(state, crop, bed, context, fullGeometry, fullPlantCount, fullPlantCount, ""), bed, crop);
        const capacity = Math.max(0, Math.trunc(Number(fullGeometry && fullGeometry.capacity) || 0));
        if (capacity > 0 && capacity < fullPlantCount) {
            const partialPlantCount = Math.max(1, Math.min(fullPlantCount, capacity));
            const partialGeometry = proposeGeometryForPlantCount(state, crop, bed, context, partialPlantCount);
            if (partialGeometry && partialGeometry.ok) {
                return cachedBedResult(state, cacheKey, buildBedResult(state, crop, bed, context, partialGeometry, partialPlantCount, fullPlantCount, partialAllocationWarning(partialPlantCount, fullPlantCount)), bed, crop);
            }
        }
        return cachedBedResult(state, cacheKey, { ok: false, status: "unavailable", reason: capacity > 0 ? "Need " + fullPlantCount + " plants" : "No bed capacity", capacity, plantCount: fullPlantCount, fullPlantCount, lifecycle: context.lifecycle, plantResolution: context.plantResolution, geometry: fullGeometry, bed, crop }, bed, crop);
    }

    function demandShortageRows(plan, coverage) {
        const rows = [];
        (coverage && coverage.weekSummaries || []).forEach(week => {
            (week.cropShortages || []).forEach(shortage => {
                const shortKg = Math.max(0, Number(shortage && shortage.shortKg) || 0);
                if (shortKg <= EPS) return;
                const crop = planCropById(plan, shortage.cropId);
                rows.push({ week, crop, cropId: String(shortage.cropId || ""), shortKg, label: String(shortage.label || cropLabel(crop)) });
            });
        });
        return rows;
    }

    function mergeActionRow(actions, row) {
        const key = [row.cropId, row.actionWeekIndex, row.actionStartISO].join("|");
        const existing = actions.find(item => item.key === key);
        if (!existing) {
            actions.push(Object.assign({ key, demandWeekIndices: [row.demandWeekIndex], futureDemandKg: row.shortKg }, row));
            return;
        }
        if (!existing.demandWeekIndices.includes(row.demandWeekIndex)) existing.demandWeekIndices.push(row.demandWeekIndex);
        existing.futureDemandKg += Math.max(0, Number(row.shortKg) || 0);
        if (row.targetDemandStartISO && (!existing.targetDemandStartISO || compareISO(row.targetDemandStartISO, existing.targetDemandStartISO) < 0)) existing.targetDemandStartISO = row.targetDemandStartISO;
        if (row.targetDemandEndISO && (!existing.targetDemandEndISO || compareISO(row.targetDemandEndISO, existing.targetDemandEndISO) > 0)) existing.targetDemandEndISO = row.targetDemandEndISO;
    }

    function unresolvedActionWeekIndex(coverage, row) {
        const target = row && row.week || null;
        const targetIndex = target && Number(target.weekIndex);
        return Number.isFinite(targetIndex) ? targetIndex : weekIndexForISO(coverage, target && target.start);
    }

    function refreshActionSchedule(schedule) {
        const value = schedule || emptyActionSchedule();
        value.actions.sort((a, b) => Number(a.actionWeekIndex) - Number(b.actionWeekIndex) || priorityRank(a.crop) - priorityRank(b.crop) || a.label.localeCompare(b.label));
        value.actionableWeekIndices = actionWeekIndices(value);
        return value;
    }

    async function processSowWeekScheduleRow(state, row, schedule) {
        const target = schedule || emptyActionSchedule();
        if (!row.crop) {
            target.unresolved.push(Object.assign({}, row, { actionWeekIndex: unresolvedActionWeekIndex(state.coverage, row), reason: "missing plant identity" }));
            return refreshActionSchedule(target);
        }
        const methodContext = resolveCropMethodContext(row.crop);
        if (!methodContext.ok || isPerennialPlanCrop(row.crop)) {
            target.unresolved.push(Object.assign({}, row, { crop: row.crop, actionWeekIndex: unresolvedActionWeekIndex(state.coverage, row), reason: isPerennialPlanCrop(row.crop) ? "new perennial allocation deferred" : methodContext.reason }));
            return refreshActionSchedule(target);
        }
        let best = null;
        let lastFailure = null;
        const cropForDemand = Object.assign({}, row.crop, {
            cropId: String(row.crop.id || row.cropId || ""),
            allocationDemandWeekIndex: Number(row.week.weekIndex),
            allocationDemandStartISO: String(row.week.start || ""),
            allocationDemandEndISO: weekEndISO(row.week)
        });
        for (const bed of state.beds || []) {
            const result = await computeBedResult(state, cropForDemand, bed);
            if (result && result.ok && (!best || rankBedResult(result) < rankBedResult(best))) best = result;
            else lastFailure = result || lastFailure;
        }
        if (!best) {
            target.unresolved.push(Object.assign({}, row, { crop: row.crop, actionWeekIndex: unresolvedActionWeekIndex(state.coverage, row), reason: lastFailure && lastFailure.reason || "no available bed" }));
            return refreshActionSchedule(target);
        }
        const actionStartISO = best.actionStartISO || best.lifecycle && (best.lifecycle.startISO || best.lifecycle.primaryDateISO) || "";
        const actionWeekIndex = weekIndexForISO(state.coverage, actionStartISO);
        if (!Number.isFinite(actionWeekIndex)) {
            target.unresolved.push(Object.assign({}, row, { crop: row.crop, actionWeekIndex: unresolvedActionWeekIndex(state.coverage, row), reason: "Required sow/start date is outside this plan year." }));
            return refreshActionSchedule(target);
        }
        mergeActionRow(target.actions, {
            crop: cropForDemand,
            cropId: String(cropForDemand.cropId || cropForDemand.id || ""),
            label: cropLabel(cropForDemand),
            shortKg: row.shortKg,
            actionWeekIndex,
            actionStartISO,
            bedEntryISO: best.lifecycle && best.lifecycle.primaryDateISO || "",
            demandWeekIndex: Number(row.week.weekIndex),
            targetDemandStartISO: String(row.week.start || ""),
            targetDemandEndISO: weekEndISO(row.week),
            selectedBedSuitability: best.status === "compatible" ? 2 : 1
        });
        return refreshActionSchedule(target);
    }

    async function buildSowWeekSchedule(state) {
        const schedule = emptyActionSchedule();
        for (const row of demandShortageRows(state.plan, state.coverage)) {
            await processSowWeekScheduleRow(state, row, schedule);
        }
        return refreshActionSchedule(schedule);
    }

    function updateScheduleCounts(state) {
        const progress = state && state.scheduleProgress || null;
        const schedule = state && state.actionSchedule || emptyActionSchedule();
        if (!progress) return;
        progress.foundActions = (schedule.actions || []).length;
        progress.unresolvedCount = (schedule.unresolved || []).length;
    }

    function chooseFirstActionWeek(state) {
        const weeks = state && state.actionSchedule && state.actionSchedule.actionableWeekIndices || [];
        if (weeks.length && !weeks.includes(state.weekIndex)) state.weekIndex = weeks[0];
    }

    function applyScheduleModel(state) {
        if (!state) return;
        chooseFirstActionWeek(state);
        state.opportunityModel = buildSowWeekOpportunityModel(state, state.weekIndex);
        if (state.selectedCropId && !opportunityContainsCrop(state.opportunityModel, state.selectedCropId)) state.selectedCropId = "";
    }

    function createButton(label, variant) {
        const button = document.createElement("button");
        button.textContent = label;
        const colors = {
            add: ["#188038", "#166534"],
            danger: ["#b91c1c", "#b91c1c"],
            open: ["#2563eb", "#1d4ed8"],
            neutral: ["#6b7280", "#111827"]
        }[variant || "neutral"];
        button.style.cssText = "border:1px solid " + colors[0] + ";color:" + colors[1] + ";background:#fff;border-radius:4px;padding:5px 9px;cursor:pointer;font:12px Arial,sans-serif;";
        return button;
    }

    const AllocateController = (() => {
        let session = null;
        const scheduleCache = new Map(); // CHANGE: session-only cache makes unchanged Allocate reopen instant.

        function cacheKeyForState(state) {
            return state && state.scheduleCacheSignature || "";
        }

        function restoreCachedSchedule(state) {
            const key = cacheKeyForState(state);
            const cached = key && scheduleCache.get(key);
            if (!state || !cached) return false;
            const schedule = clonePlain(cached.actionSchedule);
            const progress = clonePlain(cached.scheduleProgress);
            if (!schedule || !progress) return false;
            state.actionSchedule = refreshActionSchedule(Object.assign(emptyActionSchedule(), schedule));
            state.scheduleProgress = Object.assign(createScheduleProgress("complete", progress.totalRows), progress, {
                phase: "complete",
                error: "",
                finishedAt: Date.now ? Date.now() : 0
            });
            state.weekIndex = Number.isFinite(Number(cached.weekIndex)) ? Number(cached.weekIndex) : state.weekIndex;
            applyScheduleModel(state);
            return true;
        }

        function cacheCompletedSchedule(state) {
            const key = cacheKeyForState(state);
            if (!state || !key || state.scheduleProgress && state.scheduleProgress.phase !== "complete") return;
            scheduleCache.set(key, {
                actionSchedule: clonePlain(state.actionSchedule),
                scheduleProgress: clonePlain(state.scheduleProgress),
                weekIndex: Number(state.weekIndex) || 0,
                cachedAt: Date.now ? Date.now() : 0
            });
        }

        function removeCreatedActionOptimistically(state, draft) {
            const schedule = state && state.actionSchedule;
            if (!schedule || !draft || !draft.crop) return;
            const cropId = String(draft.crop.cropId || draft.crop.id || "");
            const actionStartISO = String(draft.actionStartISO || draft.lifecycle && (draft.lifecycle.startISO || draft.lifecycle.primaryDateISO) || "");
            const targetDemandStartISO = String(draft.targetDemandStartISO || "");
            schedule.actions = (schedule.actions || []).filter(row => {
                if (cropId && String(row.cropId || row.crop && (row.crop.cropId || row.crop.id) || "") !== cropId) return true;
                if (actionStartISO && String(row.actionStartISO || "") !== actionStartISO) return true;
                if (targetDemandStartISO && String(row.targetDemandStartISO || "") !== targetDemandStartISO) return true;
                return false;
            });
            refreshActionSchedule(schedule);
            applyScheduleModel(state);
        }

        function beginBackgroundStateRefresh(state, options = {}) {
            if (!state || state.closed) return;
            const previousCropId = String(options.previousCropId || state.selectedCropId || "");
            cancelDeferred(state.refreshTimer);
            state.scheduleProgress = createScheduleProgress("refreshing", state.scheduleRows && state.scheduleRows.length || 0);
            state.noticeMessage = "";
            renderHud(state);
            const refreshId = (Number(state.refreshJobId) || 0) + 1;
            state.refreshJobId = refreshId;
            state.refreshTimer = defer(async function () {
                state.refreshTimer = null;
                try {
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    await loadState(state);
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    state.selectedCropId = opportunityContainsCrop(state.opportunityModel, previousCropId) ? previousCropId : "";
                    renderHud(state);
                    if (!state.message && state.scheduleRows && state.scheduleRows.length) startSowWeekScheduleJob(state);
                    else scheduleOverlayEvaluation(state);
                } catch (err) {
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    state.scheduleProgress.phase = "failed";
                    state.scheduleProgress.error = err && err.message ? err.message : String(err || "Refresh failed.");
                    state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                    renderHud(state);
                }
            }, 0);
        }

        function cancelSowWeekScheduleJob(state, phase) {
            if (!state) return;
            state.scheduleJobId = (Number(state.scheduleJobId) || 0) + 1;
            cancelDeferred(state.scheduleTimer);
            state.scheduleTimer = null;
            if (state.scheduleProgress && progressIsActive(state.scheduleProgress)) {
                state.scheduleProgress.phase = phase || "cancelled";
                state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                state.scheduleProgress.cancellations += 1;
            }
        }

        function renderScheduleProgress(state) {
            if (!state || state.closed) return;
            updateScheduleCounts(state);
            applyScheduleModel(state);
            renderHud(state);
            if (selectedWeekHasActions(state)) scheduleOverlayEvaluation(state);
        }

        async function runSowWeekScheduleJob(state, jobId, rows) {
            try {
                for (let index = 0; index < rows.length; index += 1) {
                    if (state.closed || jobId !== state.scheduleJobId) return;
                    state.scheduleProgress.phase = "checking beds";
                    await processSowWeekScheduleRow(state, rows[index], state.actionSchedule);
                    if (state.closed || jobId !== state.scheduleJobId) return;
                    state.scheduleProgress.processedRows = index + 1;
                    renderScheduleProgress(state);
                    await yieldToUi();
                }
                if (state.closed || jobId !== state.scheduleJobId) return;
                state.scheduleProgress.phase = "complete";
                state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                renderScheduleProgress(state);
                cacheCompletedSchedule(state);
                logAllocationDebugSnapshot(state, "open");
            } catch (err) {
                if (state.closed || jobId !== state.scheduleJobId) return;
                state.scheduleProgress.phase = "failed";
                state.scheduleProgress.error = err && err.message ? err.message : String(err || "unknown error");
                state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                renderHud(state);
            }
        }

        function startSowWeekScheduleJob(state) {
            if (!state || state.closed) return null;
            const rows = state.scheduleRows || demandShortageRows(state.plan, state.coverage);
            const priorCancellations = state.scheduleProgress ? Number(state.scheduleProgress.cancellations) || 0 : 0;
            state.scheduleRows = rows;
            state.actionSchedule = emptyActionSchedule();
            state.scheduleProgress = createScheduleProgress(rows.length ? "scanning demand" : "complete", rows.length);
            state.scheduleProgress.cancellations = priorCancellations;
            applyScheduleModel(state);
            renderHud(state);
            if (!rows.length) {
                state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                cacheCompletedSchedule(state);
                logAllocationDebugSnapshot(state, "open");
                return null;
            }
            const jobId = (Number(state.scheduleJobId) || 0) + 1;
            state.scheduleJobId = jobId;
            state.scheduleTimer = defer(function () {
                state.scheduleTimer = null;
                void runSowWeekScheduleJob(state, jobId, rows);
            }, 0);
            return jobId;
        }

        function scheduleStateRefresh(state) {
            if (!state || state.closed) return;
            cancelSowWeekScheduleJob(state, "cancelled");
            const refreshId = (Number(state.refreshJobId) || 0) + 1;
            state.refreshJobId = refreshId;
            state.draft = null;
            renderHud(state);
            cancelDeferred(state.refreshTimer);
            state.refreshTimer = defer(async function () {
                state.refreshTimer = null;
                try {
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    await loadState(state);
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    renderHud(state);
                    if (!state.message && state.scheduleRows && state.scheduleRows.length) startSowWeekScheduleJob(state);
                    else scheduleOverlayEvaluation(state);
                } catch (err) {
                    if (state.closed || state.refreshJobId !== refreshId) return;
                    state.scheduleProgress.phase = "failed";
                    state.scheduleProgress.error = err && err.message ? err.message : String(err || "Refresh failed.");
                    state.scheduleProgress.finishedAt = Date.now ? Date.now() : 0;
                    renderHud(state);
                }
            }, 150);
        }

        function close(reason) {
            const current = session;
            if (!current) return;
            session = null;
            cancelSowWeekScheduleJob(current, "cancelled");
            cancelDeferred(current.refreshTimer);
            current.closed = true;
            removeNode(current.hud);
            removeNode(current.overlayHost);
            removeNode(current.ghost);
            (current.cleanups || []).forEach(fn => { try { fn(); } catch (_) { } });
            const modes = window.Trellis && window.Trellis.interactionModes;
            if (modes && typeof modes.release === "function") modes.release(MODE_ID, current.ownerId, reason || "closed");
        }

        async function open(moduleCell, year) {
            close("reopened");
            const ownerId = "allocate:" + cellId(moduleCell);
            ensureInteractionModes().request(MODE_ID, ownerId, { close: () => close("mode-closed") });
            const state = {
                moduleCell,
                year: Number(year),
                ownerId,
                plan: null,
                coverage: null,
                city: null,
                beds: [],
                occupancy: [],
                actionSchedule: emptyActionSchedule(),
                scheduleRows: [],
                scheduleProgress: createScheduleProgress("loading", 0),
                scheduleJobId: 0,
                scheduleTimer: null,
                refreshTimer: null,
                refreshJobId: 0,
                scheduleCacheSignature: "",
                lifecycleCache: new Map(),
                bedResultCache: new Map(),
                opportunityModel: null,
                weekIndex: 0,
                selectedCropId: "",
                selectedBedId: "",
                draft: null,
                overlayVersion: 0,
                draftVersion: 0,
                noticeMessage: "",
                closed: false,
                cleanups: []
            };
            state.overlayHost = createOverlayHost();
            state.hud = createHud(state);
            session = state;
            renderHud(state);
            await loadState(state);
            renderHud(state);
            const restored = !state.message && restoreCachedSchedule(state);
            renderHud(state);
            if (restored) scheduleOverlayEvaluation(state);
            else if (!state.message && state.scheduleRows && state.scheduleRows.length) startSowWeekScheduleJob(state);
            else scheduleOverlayEvaluation(state);
            installListeners(state);
            return state;
        }

        async function loadState(state) {
            const planning = window.USL && window.USL.planningCore;
            const scheduler = window.USL && window.USL.scheduler;
            const tiler = window.USL && window.USL.tiler;
            if (!planning || !scheduler || !tiler) {
                state.message = "Allocate contracts are unavailable.";
                return;
            }
            if (!state.moduleCell || !cellId(state.moduleCell)) {
                state.message = "Select a Trellis garden module first.";
                return;
            }
            const cityResult = await scheduler.resolveCityForModule(state.moduleCell);
            if (!cityResult || !cityResult.ok) {
                state.message = "Set the garden climate/location before allocating.";
                return;
            }
            state.city = cityResult.city;
            state.plan = planning.loadPlanForYear(state.moduleCell, state.year);
            if (!state.plan) {
                state.message = "No saved Year Plan for " + state.year + ".";
                return;
            }
            state.coverage = planning.computeYearCoverage({ moduleCell: state.moduleCell, year: state.year, plan: state.plan });
            state.beds = tiler.listGardenBeds(state.moduleCell);
            state.occupancy = typeof tiler.listPlantingFootprints === "function" ? tiler.listPlantingFootprints(state.moduleCell, { year: state.year, includeUndatedOccupancy: false }) : [];
            state.scheduleCacheSignature = buildScheduleCacheSignature(state);
            resetScheduleCaches(state);
            state.scheduleRows = demandShortageRows(state.plan, state.coverage);
            state.actionSchedule = emptyActionSchedule();
            state.scheduleProgress = createScheduleProgress(state.scheduleRows.length ? "scanning demand" : "complete", state.scheduleRows.length);
            state.opportunityModel = buildSowWeekOpportunityModel(state, state.weekIndex);
            if (state.selectedCropId && !opportunityContainsCrop(state.opportunityModel, state.selectedCropId)) state.selectedCropId = "";
            state.noticeMessage = "";
            if (state.coverage.totals.targetKg <= EPS) state.message = "No demand to allocate.";
            else if (state.coverage.totals.shortKg <= EPS) state.message = "The plan is covered.";
            else {
                state.message = "";
            }
        }

        async function buildWeekOpportunityModel(state) {
            if (state && state.actionSchedule) return buildSowWeekOpportunityModel(state, state.weekIndex);
            const weekModel = buildOpportunityModel(state.plan, state.coverage, { weekIndex: state.weekIndex });
            const actionable = [];
            const unresolved = weekModel.unresolved.slice();
            for (const crop of weekModel.actionable) {
                let best = null;
                let lastFailure = null;
                for (const bed of state.beds || []) {
                    const result = await computeBedResult(state, crop, bed);
                    if (result && result.ok) {
                        best = result;
                        break;
                    }
                    lastFailure = result || lastFailure;
                }
                if (best) actionable.push(Object.assign({}, crop, { selectedBedSuitability: best.status === "compatible" ? 2 : 1 }));
                else unresolved.push(Object.assign({}, crop, { unresolvedReason: lastFailure && lastFailure.reason || "no available bed" }));
            }
            actionable.sort((a, b) => {
                const pa = priorityRank(a) - priorityRank(b);
                if (pa) return pa;
                const urgency = Number(a.nextWindowDays ?? 9999) - Number(b.nextWindowDays ?? 9999);
                if (urgency) return urgency;
                const shortage = (b.shortKg / Math.max(1, b.targetKg)) - (a.shortKg / Math.max(1, a.targetKg));
                if (Math.abs(shortage) > EPS) return shortage;
                const pr = preferenceRank(a) - preferenceRank(b);
                if (pr) return pr;
                const suitability = Number(b.selectedBedSuitability || 0) - Number(a.selectedBedSuitability || 0);
                if (suitability) return suitability;
                return a.label.localeCompare(b.label);
            });
            return Object.assign({}, weekModel, { actionable, unresolved });
        }

        function createHud(state) {
            const panel = document.createElement("div");
            panel.className = "trellis-allocate-hud";
            panel.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:" + HUD_Z + ";width:340px;max-width:calc(100vw - 36px);box-sizing:border-box;background:#fff;border:1px solid #c7c7cc;border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:12px Arial,sans-serif;color:#111827;padding:10px;display:flex;flex-direction:column;gap:8px;";
            panel.innerHTML = "";
            (document.body || graph.container).appendChild(panel);
            return panel;
        }

        function showHudNode(node, visible, display) {
            if (node) node.style.display = visible ? (display || "") : "none";
        }

        function optionSignature(items) {
            return (items || []).map(item => [item.group || "", item.value || "", item.label || "", item.disabled ? "1" : "0"].join("\u0001")).join("\u0002");
        }

        function clearSelectOptions(select) {
            select.innerHTML = "";
        }

        function buildWeekOptionItems(state) {
            const weeks = state.opportunityModel && state.opportunityModel.actionableWeekIndices && state.opportunityModel.actionableWeekIndices.length
                ? state.opportunityModel.actionableWeekIndices
                : [state.weekIndex];
            return weeks.map(weekIndex => ({
                value: String(weekIndex),
                label: buildWeekOptionLabel(state, weekIndex),
                disabled: false
            }));
        } // CHANGE: stable HUD rendering compares week options before touching the focused select.

        function buildCropOptionGroups(state) {
            function cropItem(group, row, disabled) {
                return {
                    group,
                    value: row.cropId,
                    label: row.label + (row.shortKg > EPS ? " - " + formatKg(row.shortKg) + " short" : "") + (row.unresolvedReason ? " - " + row.unresolvedReason : ""),
                    disabled: !!disabled
                };
            }
            const model = state.opportunityModel || { actionable: [], unresolved: [], satisfied: [] };
            return [
                { label: "", items: [{ group: "", value: "", label: "Select crop...", disabled: false }] },
                { label: "Sow/start this week", items: (model.actionable || []).map(row => cropItem("Sow/start this week", row, false)) },
                { label: "Unresolved future demand", items: (model.unresolved || []).map(row => cropItem("Unresolved future demand", row, true)) },
                { label: "Already satisfied", items: (model.satisfied || []).map(row => cropItem("Already satisfied", row, true)) }
            ];
        } // CHANGE: crop option signatures include group, label, value, and disabled state.

        function updateWeekSelectOptions(select, state) {
            const items = buildWeekOptionItems(state);
            const signature = optionSignature(items);
            if (select.__trellisOptionSignature !== signature) {
                clearSelectOptions(select);
                items.forEach(item => {
                    const opt = document.createElement("option");
                    opt.value = item.value;
                    opt.textContent = item.label;
                    opt.disabled = !!item.disabled;
                    select.appendChild(opt);
                });
                select.__trellisOptionSignature = signature;
            }
            const value = String(state.weekIndex);
            if (items.some(item => item.value === value)) select.value = value;
        }

        function updateCropSelectOptions(select, state) {
            const groups = buildCropOptionGroups(state);
            const signature = groups.map(group => group.label + "\u0003" + optionSignature(group.items)).join("\u0004");
            if (select.__trellisOptionSignature !== signature) {
                clearSelectOptions(select);
                groups.forEach(group => {
                    if (!group.label) {
                        group.items.forEach(item => {
                            const opt = document.createElement("option");
                            opt.value = item.value;
                            opt.textContent = item.label;
                            opt.disabled = !!item.disabled;
                            select.appendChild(opt);
                        });
                        return;
                    }
                    const optgroup = document.createElement("optgroup");
                    optgroup.label = group.label;
                    group.items.forEach(item => {
                        const opt = document.createElement("option");
                        opt.value = item.value;
                        opt.textContent = item.label;
                        opt.disabled = !!item.disabled;
                        optgroup.appendChild(opt);
                    });
                    select.appendChild(optgroup);
                });
                select.__trellisOptionSignature = signature;
            }
            select.value = state.selectedCropId;
        }

        function ensureHudRefs(state, panel) {
            if (state.hudRefs) return state.hudRefs;
            panel.innerHTML = "";
            const header = document.createElement("div");
            header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;white-space:pre-line;";
            const closeBtn = createButton("Close");
            closeBtn.addEventListener("click", () => close("user"));
            header.appendChild(title);
            header.appendChild(closeBtn);
            panel.appendChild(header);

            const status = document.createElement("div");
            status.style.cssText = "line-height:1.35;color:#374151;";
            panel.appendChild(status);

            const progress = document.createElement("div");
            progress.style.cssText = "font-size:11px;line-height:1.3;color:#4b5563;";
            panel.appendChild(progress);

            const weekRow = document.createElement("div");
            weekRow.style.cssText = "display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;";
            const prev = createButton("<");
            const next = createButton(">");
            const weekSelect = document.createElement("select");
            weekSelect.title = "Select sow/start week";
            weekSelect.style.cssText = "width:100%;min-width:0;box-sizing:border-box;font-weight:700;";
            weekSelect.addEventListener("change", function () {
                void selectWeek(state, Number(weekSelect.value));
            });
            prev.addEventListener("click", () => { void moveWeek(state, -1); });
            next.addEventListener("click", () => { void moveWeek(state, 1); });
            weekRow.appendChild(prev);
            weekRow.appendChild(weekSelect);
            weekRow.appendChild(next);
            panel.appendChild(weekRow);

            const unresolvedBox = document.createElement("div");
            unresolvedBox.style.cssText = "border:1px solid #fed7aa;border-radius:6px;background:#fff7ed;color:#92400e;padding:7px;display:flex;flex-direction:column;gap:3px;line-height:1.3;";
            panel.appendChild(unresolvedBox);

            const cropSelect = document.createElement("select");
            cropSelect.style.cssText = "width:100%;box-sizing:border-box;";
            cropSelect.addEventListener("change", function () {
                state.selectedCropId = String(cropSelect.value || "");
                state.draft = null;
                renderHud(state);
                scheduleOverlayEvaluation(state);
            });
            panel.appendChild(cropSelect);

            const draftBox = document.createElement("div");
            draftBox.style.cssText = "border:1px solid #e5e7eb;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:5px;background:#f9fafb;";
            panel.appendChild(draftBox);

            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
            const rotate = createButton("Rotate", "open");
            rotate.addEventListener("click", () => rotateDraft(state));
            const create = createButton("Review Schedule", "add"); // CHANGE: HUD action opens review/configuration before committing.
            create.addEventListener("click", () => beginCreate(state));
            actions.appendChild(rotate);
            actions.appendChild(create);
            panel.appendChild(actions);

            state.hudRefs = { title, status, progress, weekRow, prev, weekSelect, next, unresolvedBox, cropSelect, draftBox, actions, rotate, create }; // CHANGE: keep HUD controls stable across progress renders.
            return state.hudRefs;
        }

        function renderHud(state) {
            const panel = state.hud;
            if (!panel) return;
            const refs = ensureHudRefs(state, panel);
            const bedContext = currentBedContext(state);
            const progressText = scheduleProgressText(state);
            panel.style.display = state.message || state.noticeMessage || bedContext || state.opportunityModel || progressText ? "flex" : "none";
            refs.title.textContent = bedContext
                ? ((getAttr(bedContext.bed, "label") || "Garden bed") + " - " + state.year + (bedContext.planting ? "\n" + (getAttr(bedContext.planting, "label") || getAttr(bedContext.planting, "plant_name") || "Planting") : ""))
                : "Allocate - " + state.year;

            if (state.message) refs.status.textContent = state.message;
            else if (state.coverage && state.coverage.totals) refs.status.textContent = formatKg(state.coverage.totals.shortKg) + " unmet of " + formatKg(state.coverage.totals.targetKg) + " demand" + (state.noticeMessage ? " - " + state.noticeMessage : "");
            else refs.status.textContent = "Loading Allocate...";

            refs.progress.textContent = progressText;
            showHudNode(refs.progress, !!progressText);

            const hasControls = !state.message && !!state.coverage;
            showHudNode(refs.weekRow, hasControls, "grid");
            showHudNode(refs.unresolvedBox, hasControls && !!(state.opportunityModel && state.opportunityModel.unresolved && state.opportunityModel.unresolved.length), "flex");
            showHudNode(refs.cropSelect, hasControls);
            showHudNode(refs.draftBox, hasControls, "flex");
            showHudNode(refs.actions, hasControls, "flex");
            if (!hasControls) return;

            updateWeekSelectOptions(refs.weekSelect, state);
            renderUnresolvedReasons(state, refs.unresolvedBox);
            updateCropSelectOptions(refs.cropSelect, state);
            renderDraftSummary(state, refs.draftBox);

            refs.rotate.disabled = !state.draft || !state.draft.geometry;
            refs.create.disabled = !state.draft || state.draft.status === "structural_failure" || state.draft.status === "unavailable";
        }

        function renderUnresolvedReasons(state, box) {
            const unresolved = state.opportunityModel && state.opportunityModel.unresolved || [];
            if (!unresolved.length) return;
            box.innerHTML = "";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;";
            title.textContent = "Unresolved future demand";
            box.appendChild(title);
            unresolved.slice(0, 5).forEach(crop => {
                const row = document.createElement("div");
                row.textContent = crop.label + ": " + (crop.unresolvedReason || "not currently allocatable");
                box.appendChild(row);
            });
            if (unresolved.length > 5) {
                const more = document.createElement("div");
                more.textContent = "+" + (unresolved.length - 5) + " more";
                box.appendChild(more);
            }
        }

        function renderDraftSummary(state, box) {
            if (!state.draft) {
                box.textContent = progressIsActive(state.scheduleProgress)
                    ? "Finding sow/start actions..."
                    : state.opportunityModel && !state.opportunityModel.actionable.length && state.opportunityModel.unresolved.length
                    ? "No sow/start actions this week. Resolve the reasons above or switch weeks."
                    : "Select a bed to preview placement.";
                return;
            }
            const d = state.draft;
            box.innerHTML = "";
            [
                d.crop.label,
                "Start/sow " + (d.actionStartISO || d.lifecycle.startISO || ""),
                d.lifecycle.primaryDateISO && d.lifecycle.primaryDateISO !== (d.actionStartISO || d.lifecycle.startISO || "") ? methodBedEntryLabel(d.crop.method) + " " + d.lifecycle.primaryDateISO : "",
                d.targetDemandStartISO ? "Targets demand " + d.targetDemandStartISO + " to " + (d.targetDemandEndISO || d.targetDemandStartISO) : "",
                String(d.plantCount || 0) + " plants - " + formatKg(d.projectedKg) + " projected",
                d.partialPlanting ? "Partial: " + d.plantCount + " of " + d.fullPlantCount + " plants" : "",
                "Harvest " + (d.harvestStart || "n/a") + " to " + (d.harvestEnd || "n/a"),
                "Serves " + formatKg(d.demandServedKg || 0) + " unmet demand",
                d.status === "compatible" ? "Compatible" : (d.reason || d.status)
            ].filter(Boolean).forEach(text => {
                const div = document.createElement("div");
                div.textContent = text;
                box.appendChild(div);
            });
        }

        async function moveWeek(state, delta) {
            const weeks = state.opportunityModel && state.opportunityModel.actionableWeekIndices || [state.weekIndex];
            const pos = Math.max(0, weeks.indexOf(state.weekIndex));
            const nextPos = Math.max(0, Math.min(weeks.length - 1, pos + delta));
            await selectWeek(state, weeks[nextPos] ?? state.weekIndex);
        }

        async function selectWeek(state, weekIndex) {
            const nextWeekIndex = Number(weekIndex);
            if (!Number.isFinite(nextWeekIndex)) return;
            state.weekIndex = nextWeekIndex;
            state.draft = null;
            state.opportunityModel = await buildWeekOpportunityModel(state);
            if (state.selectedCropId && !state.opportunityModel.actionable.some(crop => crop.cropId === state.selectedCropId)) state.selectedCropId = "";
            logAllocationDebugSnapshot(state, "week-change");
            renderHud(state);
            scheduleOverlayEvaluation(state);
        } // CHANGE: dropdown and step buttons share the same week-change behavior.

        function createOverlayHost() {
            const layer = ensureGraphOverlayHtmlLayer("control") || graph.container || document.body;
            let host = layer && layer.querySelector ? layer.querySelector(".trellis-allocate-overlay-layer") : null;
            if (!host) {
                host = document.createElement("div");
                host.className = "trellis-allocate-overlay-layer";
                host.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;font:12px Arial,sans-serif;";
                if (layer && layer.appendChild) layer.appendChild(host);
            }
            return host;
        } // CHANGE: Allocate bed controls now live on the graph control layer instead of the document body.

        function scheduleOverlayEvaluation(state) {
            const version = ++state.overlayVersion;
            state.overlayHost.innerHTML = "";
            removeNode(state.ghost);
            state.ghost = null;
            if (!state.opportunityModel || progressIsActive(state.scheduleProgress) && !selectedWeekHasActions(state)) return;
            if (!state.selectedCropId) return; // CHANGE: bed badges are meaningful only for the user's selected crop.
            const crop = (state.opportunityModel && state.opportunityModel.actionable || []).find(item => item.cropId === state.selectedCropId) || planCropById(state.plan, state.selectedCropId);
            if (!crop) return;
            setTimeout(async function () {
                const results = [];
                for (const bed of state.beds) {
                    if (state.closed || version !== state.overlayVersion) return;
                    const result = await computeBedResult(state, Object.assign({}, crop, { cropId: String(crop.cropId || crop.id || "") }), bed);
                    if (state.closed || version !== state.overlayVersion) return;
                    results.push(result);
                    if (result && result.ok) renderBedOverlay(state, bed, overlayModel(result)); // CHANGE: show only plantable beds.
                }
                if (!state.draft && crop) {
                    const best = results.filter(result => result && result.ok).sort((a, b) => rankBedResult(a) - rankBedResult(b))[0];
                    if (best) setDraft(state, best);
                }
            }, 0);
        }

        async function bestOpportunityForBed(state, bed) {
            let best = null;
            for (const crop of state.opportunityModel && state.opportunityModel.actionable || []) {
                const result = await computeBedResult(state, crop, bed);
                if (result && result.ok && (!best || rankBedResult(result) < rankBedResult(best))) best = result;
            }
            return best || { ok: false, bed, status: "no_fit", reason: "No current fit" };
        }

        function overlayModel(result) {
            if (!result || !result.ok) return { label: result && result.reason || "No current fit", tone: "bad" };
            const status = result.status === "warning" ? "Warning" : "Good match";
            const fitLabel = result.partialPlanting ? (result.plantCount + " of " + result.fullPlantCount + " fit") : (result.plantCount + " fit");
            return { label: result.crop.label + "\n" + fitLabel + " - " + status, tone: result.status === "warning" ? "warn" : "good", result };
        }

        function renderBedOverlay(state, bed, modelValue) {
            let node = state.overlayHost.querySelector('[data-bed-id="' + cellId(bed) + '"]');
            if (!node) {
                node = document.createElement("button");
                node.type = "button";
                node.setAttribute("data-bed-id", cellId(bed));
                node.style.cssText = "position:absolute;pointer-events:auto;white-space:pre-line;text-align:left;border-radius:4px;padding:4px 6px;font:11px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.16);cursor:pointer;";
                node.addEventListener("click", function () {
                    const result = node.__allocateResult;
                    if (graph.setSelectionCell) graph.setSelectionCell(bed);
                    if (result && result.ok) setDraft(state, result);
                });
                state.overlayHost.appendChild(node);
            }
            node.__allocateBedCell = bed; // CHANGE: view-only refreshes can reposition badges without recomputing fit.
            node.__allocateResult = modelValue.result || null;
            node.textContent = modelValue.label;
            positionBedOverlayNode(state, node, bed);
            node.style.border = modelValue.tone === "good" ? "1px solid #188038" : (modelValue.tone === "warn" ? "1px solid #d97706" : "1px solid #b91c1c");
            node.style.background = modelValue.tone === "good" ? "#f0fff4" : (modelValue.tone === "warn" ? "#fffbeb" : "#fff7ed");
            node.style.color = modelValue.tone === "good" ? "#166534" : "#92400e";
        }

        function positionBedOverlayNode(state, node, bed) {
            const rect = cellContainerRect(bed, state && state.overlayHost);
            if (!node || !rect) return false;
            node.style.left = Math.round(rect.left + 6) + "px";
            node.style.top = Math.round(rect.top + 6) + "px";
            return true;
        } // CHANGE: bed badges stay pinned inside the bed's rendered top-left corner.

        function repositionBedOverlays(state) {
            if (!state || !state.overlayHost || !state.overlayHost.querySelectorAll) return;
            const byId = new Map((state.beds || []).map(bed => [cellId(bed), bed]));
            Array.from(state.overlayHost.querySelectorAll("[data-bed-id]")).forEach(node => {
                const bed = node.__allocateBedCell || byId.get(node.getAttribute("data-bed-id"));
                if (bed) positionBedOverlayNode(state, node, bed);
            });
        } // CHANGE: zoom/pan updates move existing badges instead of rebuilding recommendations.

        function repositionGraphOverlays(state) {
            if (!state || state.closed) return;
            repositionBedOverlays(state);
            renderGhost(state);
        } // CHANGE: view-only changes keep Allocate DOM overlays attached to graph content.

        function setDraft(state, result) {
            state.draft = Object.assign({}, result, {
                allocationWeek: Number(state.weekIndex) + 1
            });
            state.selectedCropId = result.crop && (result.crop.cropId || result.crop.id) || state.selectedCropId;
            state.selectedBedId = cellId(result.bed);
            renderGhost(state);
            renderHud(state);
        }

        function rotateDraft(state) {
            if (!state.draft) return;
            const tiler = window.USL && window.USL.tiler;
            const d = state.draft;
            const next = tiler.proposePlantingGeometry({
                bedCell: d.bed,
                plantCount: d.plantCount,
                spacingXCm: d.geometry.spacingYCm,
                spacingYCm: d.geometry.spacingXCm,
                vegHeightCm: d.geometry.vegHeightCm || null,
                occupancy: state.occupancy || [],
                entryISO: d.lifecycle && d.lifecycle.primaryDateISO || "",
                harvestEndISO: d.harvestEnd || "",
                orientationOverride: d.geometry.orientation === "normal" ? "rotated_grid" : "normal"
            });
            d.geometry = next;
            d.warnings = allocationWarnings(d.lifecycle, next, d.partialWarning);
            d.status = d.warnings.length ? "warning" : "compatible";
            d.conflictGroupIds = next && next.conflictGroupIds || [];
            renderGhost(state);
            renderHud(state);
        }

        function renderGhost(state) {
            removeNode(state.ghost);
            const d = state.draft;
            if (!d || !d.geometry || !d.geometry.geometry) return;
            const geo = d.geometry.geometry;
            const screen = graphPointToContainer(geo.x, geo.y); // CHANGE: proposal geometry is already in graph coordinates and rendered graph-locally.
            const scale = screen.scale || 1;
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("class", "trellis-allocate-ghost");
            svg.style.cssText = "position:absolute;left:" + Math.round(screen.left) + "px;top:" + Math.round(screen.top) + "px;width:" + Math.round(geo.width * scale) + "px;height:" + Math.round(geo.height * scale) + "px;pointer-events:none;overflow:visible;";
            svg.setAttribute("viewBox", "0 0 " + geo.width + " " + geo.height);
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", "0");
            rect.setAttribute("y", "0");
            rect.setAttribute("width", String(geo.width));
            rect.setAttribute("height", String(geo.height));
            rect.setAttribute("fill", "rgba(37,99,235,.10)");
            rect.setAttribute("stroke", d.status === "warning" ? "#d97706" : "#2563eb");
            rect.setAttribute("stroke-width", "2");
            rect.setAttribute("stroke-dasharray", "5 3");
            svg.appendChild(rect);
            if (d.geometry.lodCollapsed) {
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", String(geo.width / 2));
                text.setAttribute("y", String(geo.height / 2));
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("dominant-baseline", "middle");
                text.setAttribute("font-size", "12");
                text.setAttribute("font-weight", "700");
                text.textContent = String(d.plantCount) + " plants";
                svg.appendChild(text);
            } else {
                (d.geometry.slots || []).forEach(slot => {
                    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    c.setAttribute("cx", String(slot.x));
                    c.setAttribute("cy", String(slot.y));
                    c.setAttribute("r", String(Math.max(2, slot.r)));
                    c.setAttribute("fill", "rgba(37,99,235,.42)");
                    svg.appendChild(c);
                });
            }
            (ensureGraphOverlayHtmlLayer("annotation") || state.overlayHost || graph.container || document.body).appendChild(svg); // CHANGE: ghost previews use the graph annotation layer.
            state.ghost = svg;
        }

        async function beginCreate(state) {
            if (!state.draft) return;
            const scheduler = window.USL && window.USL.scheduler;
            const defaults = scheduler && typeof scheduler.resolveAllocationDefaultStatus === "function"
                ? await scheduler.resolveAllocationDefaultStatus(state.draft)
                : { complete: true, missing: [] };
            if (defaults && defaults.complete === false) {
                await openAllocationSchedulerAndCreate(state, state.draft, { defaultStatus: defaults });
                return;
            }
            if (isReviewSuppressed(state.draft) && state.draft.status === "compatible") {
                await createDraft(state, state.draft);
                return;
            }
            const reviewed = await showCreateReview(state, state.draft);
            if (reviewed && reviewed.action === "create") await createDraft(state, reviewed.draft);
            else if (reviewed && reviewed.action === "scheduler") await openAllocationSchedulerAndCreate(state, reviewed.draft, { defaultStatus: defaults });
        }

        async function openAllocationSchedulerAndCreate(state, draft, options = {}) {
            const scheduler = window.USL && window.USL.scheduler;
            if (!scheduler || typeof scheduler.openAllocationScheduleDialog !== "function") {
                const reviewed = await showCreateReview(state, draft);
                if (reviewed && reviewed.action === "create") await createDraft(state, reviewed.draft);
                return;
            }
            const tiler = window.USL && window.USL.tiler;
            const schedulerDraft = Object.assign({}, draft, {
                city: state.city,
                allocationYear: state.year,
                bedProfile: tiler && draft.bed && typeof tiler.readBedProfile === "function" ? tiler.readBedProfile(draft.bed) : null,
                bedProfileSource: draft.bed ? (getAttr(draft.bed, "label") || "allocation bed") : "allocation bed"
            });
            const edited = await scheduler.openAllocationScheduleDialog(ui, schedulerDraft, Object.assign({ defaultStatus: options.defaultStatus || null }, options));
            if (!edited || edited.action === "cancel") return;
            const nextDraft = await recomputeDraftForSameBed(state, Object.assign({}, draft, edited.draft || edited));
            if (!nextDraft || !nextDraft.ok) {
                state.noticeMessage = nextDraft && nextDraft.reason || "Edited schedule no longer fits the selected bed.";
                renderHud(state);
                return;
            }
            await createDraft(state, nextDraft);
        } // CHANGE: full allocation scheduler saves are final pre-create edits.

        async function recomputeDraftForSameBed(state, draft) {
            const bed = draft && draft.bed;
            if (!bed) return Object.assign({}, draft, { ok: false, reason: "Selected bed is unavailable." });
            const crop = Object.assign({}, draft.crop || {}, {
                cropId: String(draft.crop && (draft.crop.cropId || draft.crop.id) || state.selectedCropId || ""),
                method: draft.methodId || draft.crop && draft.crop.method || "",
                methodCategoryId: draft.methodCategoryId || draft.crop && draft.crop.methodCategoryId || "",
                allocationLifecycle: draft.lifecycle || null
            });
            const result = await computeBedResult(state, crop, bed);
            if (!result || !result.ok) return Object.assign({}, draft, { ok: false, reason: result && result.reason || "Edited schedule no longer fits the selected bed." });
            return Object.assign({}, result, {
                taskPreview: draft.taskPreview || result.taskPreview || [],
                lifecycle: draft.lifecycle || result.lifecycle,
                actionStartISO: draft.actionStartISO || result.actionStartISO,
                targetDemandStartISO: draft.targetDemandStartISO || result.targetDemandStartISO,
                targetDemandEndISO: draft.targetDemandEndISO || result.targetDemandEndISO
            });
        } // CHANGE: edited allocation drafts must be revalidated against the same bed.

        async function showCreateReview(state, draft) {
            const div = document.createElement("div");
            div.style.cssText = "padding:14px;font:12px Arial,sans-serif;color:#111827;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto;";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;font-size:15px;";
            title.textContent = draft.status === "compatible" ? "Create Planting" : "Create Anyway";
            div.appendChild(title);
            [
                draft.crop.label,
                "Method " + (draft.lifecycle && draft.lifecycle.methodId || draft.crop.method || ""),
                "Grown for " + (draft.lifecycle && draft.lifecycle.growthStageLabel || draft.crop.growthStageLabel || "Mature"),
                "Start/sow " + (draft.actionStartISO || draft.lifecycle.startISO || ""),
                draft.lifecycle.primaryDateISO && draft.lifecycle.primaryDateISO !== (draft.actionStartISO || draft.lifecycle.startISO || "") ? methodBedEntryLabel(draft.crop.method) + " " + draft.lifecycle.primaryDateISO : "",
                draft.targetDemandStartISO ? "Targets demand " + draft.targetDemandStartISO + " to " + (draft.targetDemandEndISO || draft.targetDemandStartISO) : "",
                String(draft.plantCount) + " plants",
                draft.partialPlanting ? "Partial: " + draft.plantCount + " of " + draft.fullPlantCount + " plants fit in this bed" : "",
                "Harvest " + draft.harvestStart + " to " + draft.harvestEnd,
                "Serves " + formatKg(draft.demandServedKg),
                "Bed: " + (getAttr(draft.bed, "label") || cellId(draft.bed))
            ].filter(Boolean).forEach(text => {
                const row = document.createElement("div");
                row.textContent = text;
                div.appendChild(row);
            });
            if ((draft.warnings || []).length) {
                const warnings = document.createElement("div");
                warnings.style.cssText = "border:1px solid #d97706;border-radius:6px;background:#fffbeb;color:#92400e;padding:8px;display:flex;flex-direction:column;gap:3px;";
                (draft.warnings || []).forEach(warning => {
                    const row = document.createElement("div");
                    row.textContent = String(warning && warning.message || warning || "");
                    warnings.appendChild(row);
                });
                div.appendChild(warnings);
            }
            const tasksTitle = document.createElement("div");
            tasksTitle.style.cssText = "font-weight:700;margin-top:4px;";
            tasksTitle.textContent = "Generated tasks";
            div.appendChild(tasksTitle);
            const taskList = document.createElement("div");
            taskList.style.cssText = "border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#f9fafb;display:flex;flex-direction:column;gap:4px;";
            (draft.taskPreview || []).forEach(task => {
                const row = document.createElement("div");
                row.textContent = [task.startISO, task.title].filter(Boolean).join(" - ");
                taskList.appendChild(row);
            });
            if (!(draft.taskPreview || []).length) taskList.textContent = "No generated tasks.";
            div.appendChild(taskList);
            const suppress = document.createElement("label");
            suppress.style.cssText = "display:flex;align-items:center;gap:8px;";
            const suppressInput = document.createElement("input");
            suppressInput.type = "checkbox";
            suppress.appendChild(suppressInput);
            suppress.appendChild(document.createTextNode("Don't show again for this plant"));
            div.appendChild(suppress);
            const buttons = document.createElement("div");
            buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
            const edit = createButton("Edit", "open");
            const cancel = createButton("Cancel");
            const create = createButton(draft.status === "compatible" ? "Create" : "Create anyway", "add");
            buttons.appendChild(edit);
            buttons.appendChild(cancel);
            buttons.appendChild(create);
            div.appendChild(buttons);
            return await new Promise(resolve => {
                cancel.addEventListener("click", function () { ui.hideDialog(); resolve(null); });
                edit.addEventListener("click", async function () {
                    ui.hideDialog();
                    resolve({ action: "scheduler", draft }); // CHANGE: Edit opens the allocation scheduler path.
                });
                create.addEventListener("click", function () {
                    if (suppressInput.checked) setReviewSuppressed(draft);
                    ui.hideDialog();
                    resolve({ action: "create", draft });
                });
                ui.showDialog(div, 560, 520, true, true);
            });
        }

        async function createDraft(state, draft) {
            const tiler = window.USL && window.USL.tiler;
            const tasks = window.USL && window.USL.tasks;
            if (!tiler || !tasks || typeof tasks.applySchedulerTaskReplacement !== "function") return;
            const history = window.Trellis && window.Trellis.history;
            const operation = function () {
                let group = null;
                model.beginUpdate();
                try {
                    const attrs = Object.assign({}, draft.lifecycle.attributePatch || {}, {
                        plant_id: String(draft.crop.plantId || ""),
                        plant_name: String(draft.plantResolution.plant.plant_name || draft.crop.plant || ""),
                        variety_id: String(draft.crop.varietyId || ""),
                        variety_name: String(draft.plantResolution.varietyName || draft.crop.variety || ""),
                        plant_locked: "1",
                        label: draft.crop.label + " group",
                        allocation_source: "year_plan",
                        allocation_year: String(state.year),
                        allocation_plan_crop_id: String(draft.crop.cropId || draft.crop.id || ""),
                        allocation_week: String(draft.allocationWeek || state.weekIndex + 1),
                        allocation_demand_served_kg: String(Number(draft.demandServedKg || 0)),
                        allocation_override_json: draft.status === "compatible" ? "" : JSON.stringify({ occurred: true, reasons: draft.warnings || [draft.reason || draft.status], timestamp: new Date().toISOString() })
                    });
                    if (draft.partialPlanting) {
                        attrs.allocation_partial = "1";
                        attrs.allocation_full_plant_count = String(draft.fullPlantCount || draft.plantCount || 0);
                    }
                    group = tiler.createPlantingFromProposal({
                        graph,
                        moduleCell: state.moduleCell,
                        proposal: draft.geometry,
                        attributes: attrs,
                        insideUpdate: true
                    }, { insideUpdate: true });
                    tasks.applySchedulerTaskReplacement({
                        mode: "replace",
                        targetGroupId: cellId(group),
                        tasks: draft.taskPreview || []
                    }, { insideUpdate: true, focusCreated: false });
                } finally {
                    model.endUpdate();
                }
                if (group && graph.setSelectionCell) graph.setSelectionCell(group);
                return group;
            };
            const previousCropId = String(draft.crop && draft.crop.cropId || draft.crop && draft.crop.id || state.selectedCropId || "");
            if (history && typeof history.run === "function" && !(history.isRestoring && history.isRestoring())) {
                history.run({ category: "Garden scheduling", action: "allocateCreate", origin: "Allocate_Planner", title: "Create allocated planting", affectedCellIds: [cellId(state.moduleCell)], tags: ["Allocate", "Tasks"] }, operation);
            } else {
                operation();
            }
            cancelSowWeekScheduleJob(state, "cancelled");
            state.draft = null;
            state.selectedBedId = "";
            state.selectedCropId = "";
            removeCreatedActionOptimistically(state, draft);
            beginBackgroundStateRefresh(state, { previousCropId });
        }

        function installListeners(state) {
            const refresh = function () {
                scheduleStateRefresh(state);
            };
            const selectionRefresh = function () {
                if (state.closed) return;
                renderHud(state);
            };
            const layoutRefresh = function () {
                if (state.closed) return;
                renderHud(state);
                scheduleOverlayEvaluation(state);
            };
            const viewRefresh = function () {
                repositionGraphOverlays(state);
            };
            if (graph.addListener && typeof mxEvent !== "undefined") {
                graph.addListener(mxEvent.CELLS_MOVED, refresh);
                graph.addListener(mxEvent.CELLS_RESIZED, refresh);
                graph.addListener(mxEvent.CELLS_ADDED, refresh);
                graph.addListener(mxEvent.CELLS_REMOVED, refresh);
                state.cleanups.push(function () {
                    if (graph.removeListener) graph.removeListener(refresh);
                });
            }
            const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
            if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") {
                selectionModel.addListener(mxEvent.CHANGE, selectionRefresh);
                state.cleanups.push(function () {
                    if (selectionModel.removeListener) selectionModel.removeListener(selectionRefresh);
                });
            }
            const view = graphView();
            if (view && view.addListener && typeof mxEvent !== "undefined") {
                [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE, mxEvent.REPAINT].filter(Boolean).forEach(eventName => view.addListener(eventName, viewRefresh));
                state.cleanups.push(function () {
                    if (view.removeListener) view.removeListener(viewRefresh);
                });
            } // CHANGE: zoom/pan/repaint only reposition existing Allocate overlays.
            if (graph.container && graph.container.addEventListener) {
                graph.container.addEventListener("scroll", viewRefresh);
                state.cleanups.push(function () { if (graph.container && graph.container.removeEventListener) graph.container.removeEventListener("scroll", viewRefresh); });
            } // CHANGE: graph-container scroll keeps DOM badges glued to their rendered beds.
            window.addEventListener("resize", layoutRefresh);
            state.cleanups.push(function () { window.removeEventListener("resize", layoutRefresh); });
        }

        return { open, close, isActive: () => !!session, _session: () => session };
    })();

    async function onAllocatePlanRequested(ev) {
        const d = ev && ev.detail ? ev.detail : null;
        const moduleCellId = String(d && d.moduleCellId || "").trim();
        const year = Number(d && d.year);
        if (!moduleCellId || !Number.isFinite(year)) return;
        const moduleCell = model.getCell(moduleCellId);
        if (moduleCell) await AllocateController.open(moduleCell, year);
    }

    if (window.__trellisAllocatePlanRequestedHandler) {
        window.removeEventListener(ALLOCATE_EVENT, window.__trellisAllocatePlanRequestedHandler);
    }
    window.__trellisAllocatePlanRequestedHandler = onAllocatePlanRequested;
    window.addEventListener(ALLOCATE_EVENT, onAllocatePlanRequested);

    window.USL = window.USL || {};
    window.USL.allocate = Object.assign({}, window.USL.allocate, {
        open: AllocateController.open,
        close: AllocateController.close,
        isActive: AllocateController.isActive,
        __test: {
            buildOpportunityModel,
            buildWeekOptionLabel,
            buildAllocationDebugSnapshot,
            buildSowWeekSchedule,
            processSowWeekScheduleRow,
            buildSowWeekOpportunityModel,
            createScheduleProgress,
            scheduleProgressText,
            progressIsActive,
            graphPointToScreen,
            graphPointToContainer,
            cellContainerRect,
            cellVisualBounds,
            computeBedResult,
            partialAllocationWarning,
            buildScheduleCacheSignature,
            stableSignature,
            resolveCropMethodContext,
            reviewKey,
            methodBedEntryLabel
        }
    });
});
