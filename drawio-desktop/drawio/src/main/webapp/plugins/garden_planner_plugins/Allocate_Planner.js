Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();
    const MODE_ID = "allocate";
    const ALLOCATE_EVENT = "usl:allocatePlanRequested";
    const HUD_Z = 2000000000;
    const EPS = 0.0001;
    const STORE_PREFIX = "trellis.allocate.reviewSuppressed.";

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

    async function resolveAllocationContext(state, crop, bed) {
        const scheduler = window.USL && window.USL.scheduler;
        const tiler = window.USL && window.USL.tiler;
        const planning = window.USL && window.USL.planningCore;
        if (!scheduler || !tiler || !planning) return { ok: false, status: "structural_failure", reason: "Allocate contracts are unavailable." };
        const plantResolution = await scheduler.resolvePlantForPlanCrop({ plantId: crop.plantId, varietyId: crop.varietyId });
        if (!plantResolution || !plantResolution.ok) return { ok: false, status: "structural_failure", reason: plantResolution && plantResolution.reason || "Plant not found." };
        const week = selectedWeek(state);
        const weekStartISO = week && week.start || "";
        const methodContext = resolveCropMethodContext(crop);
        if (!methodContext.ok) return { ok: false, status: "structural_failure", reason: methodContext.reason, bed, crop, plantResolution }; // CHANGE: validate saved Year Plan method context before lifecycle scheduling.
        const lifecycle = await scheduler.proposeLifecycle({
            plant: plantResolution.plant,
            city: state.city,
            methodId: methodContext.methodId,
            methodCategoryId: methodContext.methodCategoryId, // CHANGE: preserve planting method category through allocation lifecycle scheduling.
            weekStartISO,
            weekEndISO: addDaysISO(weekStartISO, 6),
            chooseBestFeasibleDay: true,
            seasonStartYear: state.year,
            varietyName: plantResolution.varietyName,
            bedProfile: tiler.readBedProfile(bed),
            bedProfileSource: getAttr(bed, "label") || "garden bed"
        });
        if (!lifecycle || !lifecycle.ok) return { ok: false, status: "structural_failure", reason: allocationLifecycleReason(lifecycle && lifecycle.reason), bed, crop, plantResolution, lifecycle }; // CHANGE
        const harvestStart = lifecycleHarvestStart(lifecycle);
        const harvestEnd = lifecycleHarvestEnd(lifecycle);
        const kgPerPlant = Number(crop.kgPerPlant || plantResolution.plant.yield_per_plant_kg || plantResolution.plant.yield_kg_per_plant || 0);
        if (!Number.isFinite(kgPerPlant) || kgPerPlant <= EPS) return { ok: false, status: "structural_failure", reason: "Missing yield data.", bed, crop, lifecycle, plantResolution };
        return { ok: true, scheduler, tiler, planning, plantResolution, lifecycle, weekStartISO, harvestStart, harvestEnd, kgPerPlant };
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
            entryISO: context.lifecycle.primaryDateISO || context.weekStartISO,
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
            demandServedKg: demandServedByCandidate(state, crop, context, plantCount),
            projectedKg: plantCount * context.kgPerPlant,
            taskPreview: context.lifecycle.taskPreview || [],
            warnings,
            conflictGroupIds: geometry.conflictGroupIds || []
        };
    }

    async function computeBedResult(state, crop, bed) {
        const context = await resolveAllocationContext(state, crop, bed);
        if (!context || !context.ok) return Object.assign({ bed, crop }, context || {});
        const need = recommendFullPlantCount(state, crop, context);
        if (!need.ok) return { ok: false, status: need.status, reason: need.reason, bed, crop, lifecycle: context.lifecycle, plantResolution: context.plantResolution, recommendation: need.recommendation };
        const fullPlantCount = need.fullPlantCount;
        const fullGeometry = proposeGeometryForPlantCount(state, crop, bed, context, fullPlantCount);
        if (fullGeometry && fullGeometry.ok) return buildBedResult(state, crop, bed, context, fullGeometry, fullPlantCount, fullPlantCount, "");
        const capacity = Math.max(0, Math.trunc(Number(fullGeometry && fullGeometry.capacity) || 0));
        if (capacity > 0 && capacity < fullPlantCount) {
            const partialPlantCount = Math.max(1, Math.min(fullPlantCount, capacity));
            const partialGeometry = proposeGeometryForPlantCount(state, crop, bed, context, partialPlantCount);
            if (partialGeometry && partialGeometry.ok) {
                return buildBedResult(state, crop, bed, context, partialGeometry, partialPlantCount, fullPlantCount, partialAllocationWarning(partialPlantCount, fullPlantCount));
            }
        }
        return { ok: false, status: "unavailable", reason: capacity > 0 ? "Need " + fullPlantCount + " plants" : "No bed capacity", capacity, plantCount: fullPlantCount, fullPlantCount, lifecycle: context.lifecycle, plantResolution: context.plantResolution, geometry: fullGeometry, bed, crop };
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

        function close(reason) {
            const current = session;
            if (!current) return;
            session = null;
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
            await loadState(state);
            renderHud(state);
            scheduleOverlayEvaluation(state);
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
            const globalOpportunityModel = buildOpportunityModel(state.plan, state.coverage);
            state.weekIndex = globalOpportunityModel.actionableWeekIndices.includes(state.weekIndex) ? state.weekIndex : (globalOpportunityModel.actionableWeekIndices[0] ?? 0);
            state.opportunityModel = await buildWeekOpportunityModel(state);
            if (state.selectedCropId && !opportunityContainsCrop(state.opportunityModel, state.selectedCropId)) state.selectedCropId = "";
            state.noticeMessage = "";
            if (state.coverage.totals.targetKg <= EPS) state.message = "No demand to allocate.";
            else if (state.coverage.totals.shortKg <= EPS) state.message = "The plan is covered.";
            else {
                state.message = "";
                if (!state.opportunityModel.actionable.length && state.opportunityModel.unresolved.length) state.noticeMessage = "Only unresolved crops remain for this week.";
            }
        }

        async function buildWeekOpportunityModel(state) {
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

        function renderHud(state) {
            const panel = state.hud;
            if (!panel) return;
            const bedContext = currentBedContext(state);
            panel.style.display = state.message || state.noticeMessage || bedContext || state.opportunityModel ? "flex" : "none";
            panel.innerHTML = "";
            const header = document.createElement("div");
            header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;";
            title.textContent = bedContext
                ? ((getAttr(bedContext.bed, "label") || "Garden bed") + " - " + state.year + (bedContext.planting ? "\n" + (getAttr(bedContext.planting, "label") || getAttr(bedContext.planting, "plant_name") || "Planting") : ""))
                : "Allocate - " + state.year;
            title.style.whiteSpace = "pre-line";
            const closeBtn = createButton("Close");
            closeBtn.addEventListener("click", () => close("user"));
            header.appendChild(title);
            header.appendChild(closeBtn);
            panel.appendChild(header);

            const status = document.createElement("div");
            status.style.cssText = "line-height:1.35;color:#374151;";
            if (state.message) status.textContent = state.message;
            else status.textContent = formatKg(state.coverage.totals.shortKg) + " unmet of " + formatKg(state.coverage.totals.targetKg) + " demand" + (state.noticeMessage ? " - " + state.noticeMessage : "");
            panel.appendChild(status);

            if (state.message) return;

            const week = selectedWeek(state);
            const weekRow = document.createElement("div");
            weekRow.style.cssText = "display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;";
            const prev = createButton("<");
            const next = createButton(">");
            const label = document.createElement("div");
            label.style.cssText = "text-align:center;font-weight:700;";
            label.textContent = "Week " + (Number(state.weekIndex) + 1) + " - " + (week && week.start || "");
            prev.addEventListener("click", () => { void moveWeek(state, -1); });
            next.addEventListener("click", () => { void moveWeek(state, 1); });
            weekRow.appendChild(prev);
            weekRow.appendChild(label);
            weekRow.appendChild(next);
            panel.appendChild(weekRow);

            renderUnresolvedReasons(state, panel);

            const cropSelect = document.createElement("select");
            cropSelect.style.cssText = "width:100%;box-sizing:border-box;";
            appendCropOptions(cropSelect, state);
            cropSelect.value = state.selectedCropId;
            cropSelect.addEventListener("change", function () {
                state.selectedCropId = String(cropSelect.value || "");
                state.draft = null;
                renderHud(state);
                scheduleOverlayEvaluation(state);
            });
            panel.appendChild(cropSelect);

            const draftBox = document.createElement("div");
            draftBox.style.cssText = "border:1px solid #e5e7eb;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:5px;background:#f9fafb;";
            renderDraftSummary(state, draftBox);
            panel.appendChild(draftBox);

            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
            const rotate = createButton("Rotate", "open");
            rotate.disabled = !state.draft || !state.draft.geometry;
            rotate.addEventListener("click", () => rotateDraft(state));
            const create = createButton(state.draft && state.draft.status !== "compatible" ? "Create anyway" : "Create", "add");
            create.disabled = !state.draft || state.draft.status === "structural_failure" || state.draft.status === "unavailable";
            create.addEventListener("click", () => beginCreate(state));
            actions.appendChild(rotate);
            actions.appendChild(create);
            panel.appendChild(actions);
        }

        function appendCropOptions(select, state) {
            function group(label, rows, disabled) {
                const optgroup = document.createElement("optgroup");
                optgroup.label = label;
                rows.forEach(row => {
                    const opt = document.createElement("option");
                    opt.value = row.cropId;
                    opt.textContent = row.label + (row.shortKg > EPS ? " - " + formatKg(row.shortKg) + " short" : "") + (row.unresolvedReason ? " - " + row.unresolvedReason : "");
                    opt.disabled = !!disabled;
                    optgroup.appendChild(opt);
                });
                select.appendChild(optgroup);
            }
            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "Select crop...";
            select.appendChild(placeholder);
            group("Actionable this week", state.opportunityModel.actionable, false);
            group("Unresolved this week", state.opportunityModel.unresolved, true);
            group("Satisfied this week", state.opportunityModel.satisfied, true);
        }

        function renderUnresolvedReasons(state, panel) {
            const unresolved = state.opportunityModel && state.opportunityModel.unresolved || [];
            if (!unresolved.length) return;
            const box = document.createElement("div");
            box.style.cssText = "border:1px solid #fed7aa;border-radius:6px;background:#fff7ed;color:#92400e;padding:7px;display:flex;flex-direction:column;gap:3px;line-height:1.3;";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;";
            title.textContent = "Unresolved this week";
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
            panel.appendChild(box);
        }

        function renderDraftSummary(state, box) {
            if (!state.draft) {
                box.textContent = state.opportunityModel && !state.opportunityModel.actionable.length && state.opportunityModel.unresolved.length
                    ? "No actionable crops this week. Resolve the reasons above or switch weeks."
                    : "Select a bed to preview placement.";
                return;
            }
            const d = state.draft;
            box.innerHTML = "";
            [
                d.crop.label,
                methodBedEntryLabel(d.crop.method) + " " + (d.lifecycle.primaryDateISO || ""),
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
            const weeks = state.opportunityModel.actionableWeekIndices;
            const pos = Math.max(0, weeks.indexOf(state.weekIndex));
            const nextPos = Math.max(0, Math.min(weeks.length - 1, pos + delta));
            state.weekIndex = weeks[nextPos] ?? state.weekIndex;
            state.draft = null;
            state.opportunityModel = await buildWeekOpportunityModel(state);
            if (state.selectedCropId && !state.opportunityModel.actionable.some(crop => crop.cropId === state.selectedCropId)) state.selectedCropId = "";
            renderHud(state);
            scheduleOverlayEvaluation(state);
        }

        function createOverlayHost() {
            const host = document.createElement("div");
            host.className = "trellis-allocate-overlay-layer";
            host.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:" + (HUD_Z - 50) + ";pointer-events:none;font:12px Arial,sans-serif;";
            (document.body || graph.container).appendChild(host);
            return host;
        }

        function scheduleOverlayEvaluation(state) {
            const version = ++state.overlayVersion;
            state.overlayHost.innerHTML = "";
            removeNode(state.ghost);
            state.ghost = null;
            const crop = planCropById(state.plan, state.selectedCropId);
            state.beds.forEach(bed => renderBedOverlay(state, bed, { label: "Calculating...", tone: "neutral" }));
            setTimeout(async function () {
                const results = [];
                for (const bed of state.beds) {
                    if (state.closed || version !== state.overlayVersion) return;
                    let result = null;
                    if (crop) result = await computeBedResult(state, Object.assign({}, crop, { cropId: String(crop.id || "") }), bed);
                    else result = await bestOpportunityForBed(state, bed);
                    if (state.closed || version !== state.overlayVersion) return;
                    results.push(result);
                    renderBedOverlay(state, bed, overlayModel(result));
                }
                if (!state.draft && crop) {
                    const best = results.filter(result => result && result.ok).sort((a, b) => rankBedResult(a) - rankBedResult(b))[0];
                    if (best) setDraft(state, best);
                }
            }, 0);
        }

        async function bestOpportunityForBed(state, bed) {
            let best = null;
            for (const crop of state.opportunityModel.actionable) {
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
            const rect = cellScreenRect(bed);
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
            node.__allocateResult = modelValue.result || null;
            node.textContent = modelValue.label;
            node.style.left = Math.round(rect.left + 6) + "px";
            node.style.top = Math.round(rect.top + 6) + "px";
            node.style.border = modelValue.tone === "good" ? "1px solid #188038" : (modelValue.tone === "warn" ? "1px solid #d97706" : "1px solid #b91c1c");
            node.style.background = modelValue.tone === "good" ? "#f0fff4" : (modelValue.tone === "warn" ? "#fffbeb" : "#fff7ed");
            node.style.color = modelValue.tone === "good" ? "#166534" : "#92400e";
        }

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
            const moduleRect = cellScreenRect(state.moduleCell);
            const geo = d.geometry.geometry;
            const scale = moduleRect.scale || 1;
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("class", "trellis-allocate-ghost");
            svg.style.cssText = "position:fixed;left:" + Math.round(moduleRect.left + geo.x * scale) + "px;top:" + Math.round(moduleRect.top + geo.y * scale) + "px;width:" + Math.round(geo.width * scale) + "px;height:" + Math.round(geo.height * scale) + "px;z-index:" + (HUD_Z - 40) + ";pointer-events:none;overflow:visible;";
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
            (document.body || graph.container).appendChild(svg);
            state.ghost = svg;
        }

        async function beginCreate(state) {
            if (!state.draft) return;
            if (isReviewSuppressed(state.draft) && state.draft.status === "compatible") {
                await createDraft(state, state.draft);
                return;
            }
            const reviewed = await showCreateReview(state, state.draft);
            if (reviewed && reviewed.action === "create") await createDraft(state, reviewed.draft);
        }

        async function showCreateReview(state, draft) {
            const div = document.createElement("div");
            div.style.cssText = "padding:14px;font:12px Arial,sans-serif;color:#111827;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto;";
            const title = document.createElement("div");
            title.style.cssText = "font-weight:700;font-size:15px;";
            title.textContent = draft.status === "compatible" ? "Create Planting" : "Create Anyway";
            div.appendChild(title);
            [
                draft.crop.label,
                methodBedEntryLabel(draft.crop.method) + " " + (draft.lifecycle.primaryDateISO || ""),
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
                    const edited = await window.USL.scheduler.openDraftScheduleDialog(ui, draft);
                    if (edited) {
                        state.draft = Object.assign({}, draft, edited);
                        resolve(await showCreateReview(state, state.draft));
                    } else {
                        resolve(null);
                    }
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
            await loadState(state);
            state.selectedCropId = opportunityContainsCrop(state.opportunityModel, previousCropId) ? previousCropId : "";
            renderHud(state);
            scheduleOverlayEvaluation(state);
        }

        function installListeners(state) {
            const refresh = function () {
                if (state.closed) return;
                state.draft = null;
                void loadState(state).then(function () {
                    if (state.closed) return;
                    renderHud(state);
                    scheduleOverlayEvaluation(state);
                });
            };
            const selectionRefresh = function () {
                if (state.closed) return;
                renderHud(state);
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
            window.addEventListener("resize", refresh);
            state.cleanups.push(function () { window.removeEventListener("resize", refresh); });
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
            computeBedResult,
            partialAllocationWarning,
            resolveCropMethodContext,
            reviewKey,
            methodBedEntryLabel
        }
    });
});
