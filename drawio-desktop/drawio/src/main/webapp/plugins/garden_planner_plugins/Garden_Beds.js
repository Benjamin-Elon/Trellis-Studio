/**
 * Draw.io Plugin: Garden Beds
 *
 * Stores growing-condition metadata on Trellis garden beds,
 * then renders selected-bed overlays from that saved metadata.
 */
Draw.loadPlugin(function (ui) { // NEW
    const graph = ui && ui.editor && ui.editor.graph; // NEW
    if (!graph || graph.__gardenBedsInstalled) return; // CHANGE
    graph.__gardenBedsInstalled = true; // CHANGE

    const model = graph.getModel && graph.getModel(); // NEW
    if (!model) return; // NEW

    const ATTRS = { // NEW
        BED_JSON: "bed_conditions_json" // NEW
    }; // NEW

    const MIRROR_ATTRS = { // NEW
        sunExposure: "sun_exposure", // NEW
        soilMoisture: "soil_moisture", // NEW
        drainage: "drainage", // NEW
        soilTexture: "soil_texture", // NEW
        fertility: "fertility", // NEW
        irrigation: "irrigation", // NEW
        trellis: "trellis", // NEW
        bedUse: "bed_use", // NEW
        windExposure: "wind_exposure", // NEW
        frostRisk: "frost_risk", // CHANGE
    }; // NEW

    const FIELD_DEFS = [ // NEW
        { key: "sunExposure", label: "Sun exposure", values: ["unknown", "full_sun", "part_sun", "part_shade", "shade"], fallback: "unknown" }, // NEW
        { key: "soilMoisture", label: "Soil moisture", values: ["unknown", "dry", "moderate", "moist", "wet"], fallback: "unknown" }, // NEW
        { key: "drainage", label: "Drainage", values: ["unknown", "fast", "normal", "slow"], fallback: "unknown" }, // NEW
        { key: "soilTexture", label: "Soil texture", values: ["unknown", "sandy", "loamy", "clay", "mixed", "amended"], fallback: "unknown" }, // NEW
        { key: "fertility", label: "Fertility", values: ["unknown", "low", "medium", "high"], fallback: "unknown" }, // NEW
        { key: "irrigation", label: "Irrigation", values: ["unknown", "none", "manual", "drip", "sprinkler", "self_watering"], fallback: "unknown" }, // NEW
        { key: "trellis", label: "Trellis", values: ["unknown", "none", "available", "required_structure"], fallback: "unknown" }, // NEW
        { key: "windExposure", label: "Wind exposure", values: ["unknown", "sheltered", "moderate", "exposed"], fallback: "unknown" }, // NEW
        { key: "frostRisk", label: "Frost risk", values: ["unknown", "none", "low", "medium", "high"], fallback: "unknown" }, // NEW
        { key: "bedUse", label: "Bed use", values: ["unknown", "annuals", "perennials", "nursery", "seed_starting", "mixed", "resting"], fallback: "unknown" } // NEW
    ]; // NEW

    const FIELD_BY_KEY = FIELD_DEFS.reduce(function (out, field) { // NEW
        out[field.key] = field; // NEW
        return out; // NEW
    }, Object.create(null)); // NEW

    const VALUE_LABELS = { // NEW
        unknown: "Unknown", // NEW
        full_sun: "Full sun", // NEW
        part_sun: "Part sun", // NEW
        part_shade: "Part shade", // NEW
        shade: "Shade", // NEW
        dry: "Dry", // NEW
        moderate: "Moderate", // NEW
        moist: "Moist", // NEW
        wet: "Wet", // NEW
        fast: "Fast drainage", // NEW
        normal: "Normal drainage", // NEW
        slow: "Slow drainage", // NEW
        sandy: "Sandy", // NEW
        loamy: "Loamy", // NEW
        clay: "Clay", // NEW
        mixed: "Mixed", // NEW
        amended: "Amended", // NEW
        low: "Low", // NEW
        medium: "Medium", // NEW
        high: "High", // NEW
        none: "None", // NEW
        manual: "Manual", // NEW
        drip: "Drip", // NEW
        sprinkler: "Sprinkler", // NEW
        self_watering: "Self watering", // NEW
        available: "Available", // NEW
        required_structure: "Structure required", // NEW
        sheltered: "Sheltered", // NEW
        exposed: "Exposed", // NEW
        annuals: "Annuals", // NEW
        perennials: "Perennials", // NEW
        nursery: "Nursery", // NEW
        seed_starting: "Seed starting", // NEW
        resting: "Resting" // NEW
    }; // NEW

    const PRESETS = { // NEW
        "": { label: "Choose preset", values: {} }, // NEW
        sunny_vegetable: { label: "Sunny vegetable bed", values: { sunExposure: "full_sun", soilMoisture: "moderate", drainage: "normal", soilTexture: "loamy", fertility: "high", irrigation: "unknown", trellis: "unknown", bedUse: "annuals" } }, // NEW
        shady_greens: { label: "Shady greens bed", values: { sunExposure: "part_shade", soilMoisture: "moist", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "annuals" } }, // NEW
        dry_herb: { label: "Dry herb bed", values: { sunExposure: "full_sun", soilMoisture: "dry", drainage: "fast", soilTexture: "sandy", fertility: "low", irrigation: "unknown", trellis: "unknown", bedUse: "perennials" } }, // NEW
        wet_moist: { label: "Wet/moist bed", values: { sunExposure: "part_sun", soilMoisture: "moist", drainage: "slow", fertility: "medium", irrigation: "none", trellis: "unknown", bedUse: "unknown" } }, // NEW
        nursery: { label: "Nursery bed", values: { sunExposure: "part_sun", soilMoisture: "moderate", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "nursery" } }, // NEW
        perennial: { label: "Perennial bed", values: { sunExposure: "full_sun", soilMoisture: "moderate", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "perennials" } }, // NEW
        resting: { label: "Resting bed", values: { sunExposure: "unknown", soilMoisture: "unknown", drainage: "unknown", fertility: "low", irrigation: "unknown", trellis: "unknown", bedUse: "resting" } } // NEW
    }; // NEW

    let copiedProfile = null; // NEW
    const selectedBedOverlays = new Map(); // NEW

    function isGardenBed(cell) { // NEW
        if (!cell || !cell.getAttribute) return false; // CHANGE
        return cell.getAttribute("garden_bed") === "1" || cell.getAttribute("gardenBed") === "1" || cell.getAttribute("is_garden_bed") === "1"; // CHANGE
    } // NEW

    function getCellAttr(cell, key, fallback) { // NEW
        if (!cell || !cell.getAttribute) return fallback || ""; // NEW
        const value = cell.getAttribute(key); // NEW
        return value == null ? (fallback || "") : String(value); // NEW
    } // NEW

    function createXmlDocument() { // NEW
        if (typeof mxUtils !== "undefined" && mxUtils.createXmlDocument) return mxUtils.createXmlDocument(); // NEW
        return document.implementation.createDocument("", "", null); // NEW
    } // NEW

    function buildXmlValueForEdit(cell) { // CHANGE
        if (!cell) return null; // NEW
        const value = cell.value; // NEW
        if (value && value.nodeType === 1) return value.cloneNode(true); // CHANGE
        const node = createXmlDocument().createElement("object"); // NEW
        if (typeof value === "string" && value) node.setAttribute("label", value); // NEW
        return node; // NEW
    } // NEW

    function setCellAttrs(cell, attrs) { // NEW
        const node = buildXmlValueForEdit(cell); // CHANGE
        if (!node) return; // NEW
        Object.keys(attrs || {}).forEach(function (key) { // NEW
            const value = attrs[key]; // NEW
            if (value == null || value === "") node.removeAttribute(key); // NEW
            else node.setAttribute(key, String(value)); // NEW
        }); // NEW
        if (model.setValue) model.setValue(cell, node); // NEW
    } // NEW

    function nowIso() { // NEW
        return new Date().toISOString(); // NEW
    } // NEW

    function valueLabel(value) { // NEW
        return VALUE_LABELS[value] || String(value || "").replace(/_/g, " "); // NEW
    } // NEW

    function normalizeEnumValue(key, value) { // NEW
        const field = FIELD_BY_KEY[key]; // NEW
        const raw = String(value == null ? "" : value).trim(); // NEW
        if (!field || field.values.indexOf(raw) < 0) return field ? field.fallback : ""; // NEW
        return raw; // NEW
    } // NEW

    function normalizeTags(tags) { // NEW
        const values = Array.isArray(tags) ? tags : String(tags || "").split(","); // NEW
        const seen = Object.create(null); // NEW
        const out = []; // NEW
        values.forEach(function (tag) { // NEW
            const clean = String(tag || "").trim(); // NEW
            if (!clean || seen[clean]) return; // NEW
            seen[clean] = true; // NEW
            out.push(clean); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function isValidPresetKey(key) { // NEW
        return !!key && !!PRESETS[key]; // NEW
    } // NEW

    function getPresetFieldKeys(presetKey) { // NEW
        const preset = isValidPresetKey(presetKey) ? PRESETS[presetKey] : null; // NEW
        const values = (preset && preset.values) || {}; // NEW
        return Object.keys(values).filter(function (key) { return values[key] !== "unknown"; }); // NEW
    } // NEW

    function doesProfileMatchPreset(profile, presetKey) { // NEW
        if (!isValidPresetKey(presetKey)) return false; // NEW
        const values = PRESETS[presetKey].values || {}; // NEW
        return getPresetFieldKeys(presetKey).every(function (key) { // NEW
            return normalizeEnumValue(key, profile[key]) === normalizeEnumValue(key, values[key]); // NEW
        }); // NEW
    } // NEW

    function normalizeProfile(profile, options) { // NEW
        const source = profile && typeof profile === "object" ? profile : {}; // NEW
        const out = { schemaVersion: 1 }; // NEW
        FIELD_DEFS.forEach(function (field) { // NEW
            out[field.key] = normalizeEnumValue(field.key, source[field.key]); // NEW
        }); // NEW
        const presetKey = String(source.presetKey || "").trim(); // NEW
        if (options && options.allowPreset && doesProfileMatchPreset(out, presetKey)) out.presetKey = presetKey; // NEW
        out.notes = String(source.notes || "").trim(); // NEW
        out.tags = normalizeTags(source.tags); // NEW
        out.lastUpdated = String(source.lastUpdated || (options && options.keepExistingDate ? "" : nowIso())); // NEW
        return out; // NEW
    } // NEW

    function parseProfileRecord(cell, attrName) { // NEW
        const options = { keepExistingDate: true, allowPreset: attrName === ATTRS.BED_JSON }; // NEW
        const raw = getCellAttr(cell, attrName, ""); // NEW
        if (!raw) return { raw: "", invalid: false, profile: normalizeProfile({}, options) }; // NEW
        try { // NEW
            return { raw: raw, invalid: false, profile: normalizeProfile(JSON.parse(raw), options) }; // NEW
        } catch (e) { // NEW
            return { raw: raw, invalid: true, profile: normalizeProfile({}, options) }; // NEW
        } // NEW
    } // NEW

    function readBedConditions(bedCell) { // NEW
        return parseProfileRecord(bedCell, ATTRS.BED_JSON).profile; // NEW
    } // NEW

    function buildMirrorAttrs(profile) { // NEW
        const attrs = {}; // NEW
        Object.keys(MIRROR_ATTRS).forEach(function (key) { // NEW
            attrs[MIRROR_ATTRS[key]] = profile[key]; // NEW
        }); // NEW
        return attrs; // NEW
    } // NEW

    function writeBedConditions(bedCell, profile) { // NEW
        if (!isGardenBed(bedCell)) return null; // NEW
        const normalized = normalizeProfile(profile, { allowPreset: true }); // NEW
        const attrs = buildMirrorAttrs(normalized); // NEW
        attrs[ATTRS.BED_JSON] = JSON.stringify(normalized); // NEW
        setCellAttrs(bedCell, attrs); // NEW
        refreshSelectedBedOverlaysSoon(); // NEW
        return normalized; // NEW
    } // NEW

    function clearBedConditions(bedCell) { // NEW
        if (!isGardenBed(bedCell)) return; // NEW
        const attrs = { [ATTRS.BED_JSON]: null }; // NEW
        Object.keys(MIRROR_ATTRS).forEach(function (key) { // NEW
            attrs[MIRROR_ATTRS[key]] = null; // NEW
        }); // NEW
        setCellAttrs(bedCell, attrs); // NEW
        refreshSelectedBedOverlaysSoon(); // NEW
    } // NEW

    function isMeaningfulOverride(key, value) { // NEW
        if (key === "trellis") return value === "none" || value === "available" || value === "required_structure"; // NEW
        return !!value && value !== "unknown"; // NEW
    } // NEW

    function getDisplayBedConditions(bedCell) { // CHANGE
        const bedRecord = parseProfileRecord(bedCell, ATTRS.BED_JSON); // NEW
        const out = normalizeProfile({}, { keepExistingDate: true }); // NEW
        FIELD_DEFS.forEach(function (field) { // NEW
            const value = bedRecord.profile[field.key]; // NEW
            if (isMeaningfulOverride(field.key, value)) out[field.key] = value; // NEW
        }); // NEW
        if (bedRecord.profile.notes) out.notes = bedRecord.profile.notes; // NEW
        if (bedRecord.profile.tags && bedRecord.profile.tags.length) out.tags = bedRecord.profile.tags.slice(); // NEW
        if (bedRecord.profile.presetKey && doesProfileMatchPreset(bedRecord.profile, bedRecord.profile.presetKey)) out.presetKey = bedRecord.profile.presetKey; // NEW
        out.lastUpdated = bedRecord.profile.lastUpdated || ""; // NEW
        return out; // NEW
    } // NEW

    function isBedCompatibleWithCrop() { // NEW
        return { compatible: true, hardFailures: [], warnings: [] }; // NEW
    } // NEW

    function scoreBedSuitability() { // NEW
        return { score: 0, reasons: [] }; // NEW
    } // NEW

    function getCellId(cell) { // NEW
        return cell && cell.getId ? cell.getId() : (cell && cell.id); // NEW
    } // NEW

    function collectSelectedBeds(fallbackBed) { // NEW
        const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
        const byId = new Map(); // NEW
        cells.forEach(function (cell) { // NEW
            if (isGardenBed(cell)) byId.set(getCellId(cell), cell); // NEW
        }); // NEW
        if (!byId.size && fallbackBed) byId.set(getCellId(fallbackBed), fallbackBed); // NEW
        return Array.from(byId.values()); // NEW
    } // NEW

    function makeSelect(field, value) { // NEW
        const select = document.createElement("select"); // NEW
        select.style.width = "100%"; // NEW
        field.values.forEach(function (optionValue) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = optionValue; // NEW
            option.textContent = valueLabel(optionValue); // NEW
            select.appendChild(option); // NEW
        }); // NEW
        select.value = normalizeEnumValue(field.key, value); // NEW
        return select; // NEW
    } // NEW

    function appendSection(container, title) { // NEW
        const section = document.createElement("div"); // NEW
        section.style.borderTop = "1px solid #e5e7eb"; // NEW
        section.style.paddingTop = "8px"; // NEW
        section.style.marginTop = "8px"; // NEW
        const label = document.createElement("div"); // NEW
        label.textContent = title; // NEW
        label.style.fontWeight = "bold"; // NEW
        label.style.marginBottom = "6px"; // NEW
        section.appendChild(label); // NEW
        container.appendChild(section); // NEW
        return section; // NEW
    } // NEW

    function appendField(section, field, input) { // NEW
        const row = document.createElement("label"); // NEW
        row.style.display = "grid"; // NEW
        row.style.gridTemplateColumns = "130px 1fr"; // NEW
        row.style.alignItems = "center"; // NEW
        row.style.gap = "8px"; // NEW
        row.style.marginBottom = "6px"; // NEW
        const text = document.createElement("span"); // NEW
        text.textContent = field.label; // NEW
        row.appendChild(text); // NEW
        row.appendChild(input); // NEW
        section.appendChild(row); // NEW
    } // NEW

    function showConditionEditorDialog(targetCell) { // NEW
        const current = readBedConditions(targetCell); // NEW
        const div = document.createElement("div"); // NEW
        div.style.padding = "14px"; // NEW
        div.style.fontSize = "13px"; // NEW
        const title = document.createElement("h3"); // NEW
        title.textContent = "Bed Conditions"; // NEW
        title.style.margin = "0 0 10px"; // NEW
        div.appendChild(title); // NEW

        const presetRow = document.createElement("label"); // NEW
        presetRow.style.display = "grid"; // NEW
        presetRow.style.gridTemplateColumns = "130px 1fr"; // NEW
        presetRow.style.alignItems = "center"; // NEW
        presetRow.style.gap = "8px"; // NEW
        const presetSelect = document.createElement("select"); // NEW
        Object.keys(PRESETS).forEach(function (key) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = key; // NEW
            option.textContent = PRESETS[key].label; // NEW
            presetSelect.appendChild(option); // NEW
        }); // NEW
        if (current.presetKey) presetSelect.value = current.presetKey; // NEW
        presetRow.appendChild(document.createTextNode("Preset")); // NEW
        presetRow.appendChild(presetSelect); // NEW
        div.appendChild(presetRow); // NEW

        const controls = Object.create(null); // NEW
        const growing = appendSection(div, "Growing Conditions"); // NEW
        ["sunExposure", "soilMoisture", "drainage", "soilTexture", "fertility"].forEach(function (key) { // NEW
            controls[key] = makeSelect(FIELD_BY_KEY[key], current[key]); // NEW
            appendField(growing, FIELD_BY_KEY[key], controls[key]); // NEW
        }); // NEW

        const infra = appendSection(div, "Infrastructure"); // NEW
        ["irrigation", "trellis", "windExposure", "frostRisk"].forEach(function (key) { // NEW
            controls[key] = makeSelect(FIELD_BY_KEY[key], current[key]); // NEW
            appendField(infra, FIELD_BY_KEY[key], controls[key]); // NEW
        }); // NEW

        const use = appendSection(div, "Use"); // NEW
        controls.bedUse = makeSelect(FIELD_BY_KEY.bedUse, current.bedUse); // NEW
        appendField(use, FIELD_BY_KEY.bedUse, controls.bedUse); // NEW

        const tagsInput = document.createElement("input"); // NEW
        tagsInput.type = "text"; // NEW
        tagsInput.value = (current.tags || []).join(", "); // NEW
        tagsInput.style.width = "100%"; // NEW
        appendField(use, { label: "Tags" }, tagsInput); // NEW

        const notesInput = document.createElement("textarea"); // NEW
        notesInput.value = current.notes || ""; // NEW
        notesInput.rows = 3; // NEW
        notesInput.style.width = "100%"; // NEW
        appendField(use, { label: "Notes" }, notesInput); // NEW

        presetSelect.addEventListener("change", function () { // NEW
            const preset = PRESETS[presetSelect.value]; // NEW
            Object.keys((preset && preset.values) || {}).forEach(function (key) { // NEW
                if (controls[key]) controls[key].value = preset.values[key]; // NEW
            }); // NEW
        }); // NEW

        function readDialogProfile() { // NEW
            const next = {}; // NEW
            FIELD_DEFS.forEach(function (field) { next[field.key] = controls[field.key].value; }); // NEW
            next.presetKey = presetSelect.value; // NEW
            next.tags = tagsInput.value; // NEW
            next.notes = notesInput.value; // NEW
            return next; // NEW
        } // NEW

        const actionRow = document.createElement("div"); // NEW
        actionRow.style.display = "flex"; // NEW
        actionRow.style.justifyContent = "space-between"; // NEW
        actionRow.style.alignItems = "center"; // NEW
        actionRow.style.gap = "8px"; // NEW
        actionRow.style.marginTop = "12px"; // NEW
        actionRow.style.paddingTop = "10px"; // NEW
        actionRow.style.borderTop = "1px solid #e5e7eb"; // NEW
        const secondaryButtons = document.createElement("div"); // NEW
        secondaryButtons.style.display = "flex"; // NEW
        secondaryButtons.style.gap = "8px"; // NEW
        actionRow.appendChild(document.createElement("span")); // NEW
        secondaryButtons.appendChild(mxUtils.button("Copy", function () { copiedProfile = normalizeProfile(readDialogProfile(), { allowPreset: true }); })); // NEW
        secondaryButtons.appendChild(mxUtils.button("Paste", function () { // NEW
            if (!copiedProfile) { ui.alert("No copied bed conditions are available."); return; } // NEW
            const targets = collectSelectedBeds(targetCell); // NEW
            model.beginUpdate(); // NEW
            try { targets.forEach(function (target) { writeBedConditions(target, copiedProfile); }); } // NEW
            finally { model.endUpdate(); } // NEW
            ui.hideDialog(); // NEW
        })); // NEW
        secondaryButtons.appendChild(mxUtils.button("Clear", function () { // CHANGE
            const targets = collectSelectedBeds(targetCell); // NEW
            model.beginUpdate(); // NEW
            try { targets.forEach(clearBedConditions); } // NEW
            finally { model.endUpdate(); } // NEW
            ui.hideDialog(); // NEW
        })); // NEW

        actionRow.appendChild(secondaryButtons); // NEW
        div.appendChild(actionRow); // NEW

        const buttonRow = document.createElement("div"); // NEW
        buttonRow.style.display = "flex"; // NEW
        buttonRow.style.justifyContent = "flex-end"; // NEW
        buttonRow.style.gap = "8px"; // NEW
        buttonRow.style.marginTop = "12px"; // NEW
        buttonRow.appendChild(mxUtils.button("Cancel", function () { ui.hideDialog(); })); // NEW
        buttonRow.appendChild(mxUtils.button("Save", function () { // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                writeBedConditions(targetCell, readDialogProfile()); // CHANGE
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
            ui.hideDialog(); // NEW
        })); // NEW
        div.appendChild(buttonRow); // NEW
        ui.showDialog(div, 520, 650, true, true); // CHANGE
    } // NEW

    function isOverlayDisplayValue(key, value) { // NEW
        if (!value || value === "unknown") return false; // NEW
        if (key === "trellis" && value === "none") return false; // NEW
        return true; // NEW
    } // NEW

    function buildOverlayRows(profile) { // NEW
        const rows = []; // NEW
        const presetKey = profile && profile.presetKey && doesProfileMatchPreset(profile, profile.presetKey) ? profile.presetKey : ""; // NEW
        const presetFields = new Set(getPresetFieldKeys(presetKey)); // NEW
        if (presetKey) rows.push({ label: "Preset", value: PRESETS[presetKey].label }); // NEW
        FIELD_DEFS.forEach(function (field) { // NEW
            if (presetFields.has(field.key)) return; // NEW
            const value = profile && profile[field.key]; // NEW
            if (isOverlayDisplayValue(field.key, value)) rows.push({ label: field.label, value: valueLabel(value) }); // NEW
        }); // NEW
        return rows; // NEW
    } // NEW

    function createSelectedBedOverlay() { // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-bed-conditions-overlay"; // NEW
        div.style.position = "absolute"; // NEW
        div.style.pointerEvents = "auto"; // NEW
        div.style.zIndex = "998"; // NEW
        div.style.boxSizing = "border-box"; // NEW
        div.style.width = "190px"; // NEW
        div.style.padding = "8px"; // NEW
        div.style.borderRadius = "6px"; // NEW
        div.style.fontSize = "12px"; // NEW
        div.style.lineHeight = "16px"; // NEW
        div.style.color = "#111827"; // NEW
        div.style.background = "rgba(255, 255, 255, 0.96)"; // NEW
        div.style.border = "1px solid rgba(75, 85, 99, 0.45)"; // NEW
        div.style.boxShadow = "0 2px 7px rgba(0,0,0,0.18)"; // NEW
        return div; // NEW
    } // NEW

    function ensureOverlayContainer() { // NEW
        if (!graph.container) return; // NEW
        const style = window.getComputedStyle ? window.getComputedStyle(graph.container) : null; // NEW
        if (style && style.position === "static") graph.container.style.position = "relative"; // NEW
    } // NEW

    function renderSelectedBedOverlay(entry) { // NEW
        entry.div.innerHTML = ""; // NEW
        const button = mxUtils.button("Set Bed Conditions", function () { showConditionEditorDialog(entry.cell); }); // NEW
        button.style.width = "100%"; // NEW
        button.style.marginBottom = "6px"; // NEW
        entry.div.appendChild(button); // NEW
        const rows = buildOverlayRows(getDisplayBedConditions(entry.cell)); // CHANGE
        if (!rows.length) { // NEW
            const empty = document.createElement("div"); // NEW
            empty.textContent = "No set conditions"; // NEW
            empty.style.color = "#6b7280"; // NEW
            entry.div.appendChild(empty); // NEW
            return; // NEW
        } // NEW
        rows.forEach(function (row) { // NEW
            const line = document.createElement("div"); // NEW
            line.style.display = "grid"; // NEW
            line.style.gridTemplateColumns = "72px 1fr"; // NEW
            line.style.gap = "6px"; // NEW
            line.style.marginTop = "3px"; // NEW
            const label = document.createElement("span"); // NEW
            label.textContent = row.label; // NEW
            label.style.color = "#4b5563"; // NEW
            const value = document.createElement("span"); // NEW
            value.textContent = row.value; // NEW
            value.style.fontWeight = "600"; // NEW
            line.appendChild(label); // NEW
            line.appendChild(value); // NEW
            entry.div.appendChild(line); // NEW
        }); // NEW
    } // NEW

    function positionSelectedBedOverlay(entry) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(entry.cell) : null; // NEW
        if (!state) return false; // NEW
        const width = 190; // NEW
        const left = Math.max(0, Math.round(state.x - 60 - width)); // NEW
        entry.div.style.left = left + "px"; // NEW
        entry.div.style.top = Math.round(state.y) + "px"; // NEW
        return true; // NEW
    } // NEW

    function removeSelectedBedOverlay(cellId) { // NEW
        const entry = selectedBedOverlays.get(cellId); // NEW
        if (!entry) return; // NEW
        if (entry.div && entry.div.parentNode) entry.div.parentNode.removeChild(entry.div); // NEW
        selectedBedOverlays.delete(cellId); // NEW
    } // NEW

    function clearSelectedBedOverlays() { // NEW
        Array.from(selectedBedOverlays.keys()).forEach(removeSelectedBedOverlay); // NEW
    } // NEW

    function getSelectedGardenBedsForOverlay() { // NEW
        const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
        if (!cells.length || cells.some(function (cell) { return !isGardenBed(cell); })) return []; // NEW
        const byId = new Map(); // NEW
        cells.forEach(function (cell) { byId.set(getCellId(cell), cell); }); // NEW
        return Array.from(byId.values()); // NEW
    } // NEW

    function syncSelectedBedOverlays() { // NEW
        ensureOverlayContainer(); // NEW
        if (!graph.container) return; // NEW
        const beds = getSelectedGardenBedsForOverlay(); // NEW
        const keep = new Set(); // NEW
        beds.forEach(function (bed) { // NEW
            const id = getCellId(bed); // NEW
            if (!id) return; // NEW
            keep.add(id); // NEW
            let entry = selectedBedOverlays.get(id); // NEW
            if (!entry) { // NEW
                entry = { cell: bed, div: createSelectedBedOverlay() }; // NEW
                graph.container.appendChild(entry.div); // NEW
                selectedBedOverlays.set(id, entry); // NEW
            } // NEW
            entry.cell = bed; // NEW
            renderSelectedBedOverlay(entry); // NEW
            if (!positionSelectedBedOverlay(entry)) removeSelectedBedOverlay(id); // NEW
        }); // NEW
        Array.from(selectedBedOverlays.keys()).forEach(function (id) { // NEW
            if (!keep.has(id)) removeSelectedBedOverlay(id); // NEW
        }); // NEW
    } // NEW

    function refreshSelectedBedOverlaysSoon() { // NEW
        if (refreshSelectedBedOverlaysSoon.pending) return; // CHANGE
        refreshSelectedBedOverlaysSoon.pending = true; // CHANGE
        setTimeout(function () { refreshSelectedBedOverlaysSoon.pending = false; syncSelectedBedOverlays(); }, 0); // CHANGE
    } // NEW

    const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null; // NEW
    model.addListener && model.addListener(mxEvent.CHANGE, refreshSelectedBedOverlaysSoon); // CHANGE
    if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedBedOverlaysSoon); // NEW
    if (graph.view && graph.view.addListener) { // NEW
        graph.view.addListener(mxEvent.SCALE, refreshSelectedBedOverlaysSoon); // NEW
        graph.view.addListener(mxEvent.TRANSLATE, refreshSelectedBedOverlaysSoon); // NEW
        graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshSelectedBedOverlaysSoon); // NEW
    } // NEW
    if (graph.container && graph.container.addEventListener) graph.container.addEventListener("scroll", refreshSelectedBedOverlaysSoon, { passive: true }); // NEW
    graph.addListener && graph.addListener(mxEvent.DESTROY, clearSelectedBedOverlays); // NEW

    window.TrellisGardenBeds = { // CHANGE
        getDisplayBedConditions: getDisplayBedConditions, // CHANGE
        readBedConditions: readBedConditions, // NEW
        writeBedConditions: writeBedConditions, // NEW
        clearBedConditions: clearBedConditions, // NEW
        isGardenBed: isGardenBed, // NEW
        isBedCompatibleWithCrop: isBedCompatibleWithCrop, // NEW
        scoreBedSuitability: scoreBedSuitability, // NEW
        _test: { // NEW
            buildOverlayRows: buildOverlayRows, // NEW
            normalizeProfile: normalizeProfile, // NEW
            parseProfileRecord: parseProfileRecord, // NEW
            getDisplayBedConditions: getDisplayBedConditions, // CHANGE
            showConditionEditorDialog: showConditionEditorDialog, // NEW
            syncSelectedBedOverlays: syncSelectedBedOverlays, // NEW
            collectSelectedBeds: collectSelectedBeds // NEW
        } // NEW
    }; // NEW
    window.TrellisBedConditions = window.TrellisGardenBeds; // NEW

    refreshSelectedBedOverlaysSoon(); // NEW
}); // NEW
