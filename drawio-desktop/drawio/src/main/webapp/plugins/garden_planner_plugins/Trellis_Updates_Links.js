/**
 * Trellis Plugin: Updates & Links
 *
 * Adds a default Help menu dialog for release updates, support links, and
 * replaceable public contact placeholders.
 */
(function () {
    if (typeof window === "undefined") return;

    const ACTION_ID = "trellisUpdatesLinks";
    const ACTION_LABEL = "Trellis Updates & Links";
    const RELEASES_API_URL = "https://api.github.com/repos/Benjamin-Elon/trellis-studio/releases?per_page=10"; // CHANGE
    const CHANGELOG_URL = "plugins/garden_planner_plugins/trellis_changelog.json";
    const SUMMARY_LIMIT = 220;
    const TRELLIS_DIALOG_Z = 2000000000; // NEW

    const DEFAULT_APP_INFO = Object.freeze({
        productName: "Trellis Studio",
        version: "",
        repoUrl: "https://github.com/Benjamin-Elon/trellis-studio", // CHANGE
        releasesUrl: "https://github.com/Benjamin-Elon/trellis-studio/releases", // CHANGE
        issuesUrl: "https://github.com/Benjamin-Elon/trellis-studio/issues", // CHANGE
        isPackaged: false, // NEW
        canCheckForUpdates: false // NEW
    });

    const LINK_CONFIG = Object.freeze({
        name: "Benjamin Elon",
        patreon: "https://www.patreon.com/placeholder",
        youtube: "https://www.youtube.com/@placeholder",
        website: "https://example.com",
        email: "mailto:contact@example.com",
        phone: "tel:+10000000000"
    });

    function text(value) {
        return String(value == null ? "" : value);
    }

    function appendText(parent, value) {
        parent.appendChild(document.createTextNode(text(value)));
        return parent;
    }

    function createEl(tagName, className, value) {
        const el = document.createElement(tagName);
        if (className) el.className = className;
        if (value != null) appendText(el, value);
        return el;
    }

    function clearNode(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function elevateTrellisDialog(ui) { // NEW
        const dlg = ui && ui.dialog; // NEW
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1); // NEW
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z); // NEW
    } // NEW

    function normalizeVersion(value) {
        const match = text(value).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
        if (!match) return null;
        const prerelease = match[4] ? match[4].split(".") : [];
        const build = match[5] ? match[5].split(".") : [];
        if (!areValidSemverIdentifiers(prerelease, true) || !areValidSemverIdentifiers(build, false)) return null;
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: Number(match[3]),
            prerelease: prerelease
        };
    }

    function areValidSemverIdentifiers(parts, rejectLeadingZeroNumbers) {
        return parts.every(function (part) {
            if (!part) return false;
            if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
            if (rejectLeadingZeroNumbers && /^\d+$/.test(part) && part.length > 1 && part.charAt(0) === "0") return false;
            return true;
        });
    }

    function comparePrereleaseIdentifiers(left, right) {
        const leftNumeric = /^\d+$/.test(left);
        const rightNumeric = /^\d+$/.test(right);

        if (leftNumeric && rightNumeric) {
            const leftNumber = Number(left);
            const rightNumber = Number(right);
            return leftNumber === rightNumber ? 0 : (leftNumber > rightNumber ? 1 : -1);
        }

        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return left === right ? 0 : (left > right ? 1 : -1);
    }

    function compareVersions(left, right) {
        const a = normalizeVersion(left);
        const b = normalizeVersion(right);
        if (!a || !b) return null;

        for (const key of ["major", "minor", "patch"]) {
            if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
        }

        if (!a.prerelease.length && !b.prerelease.length) return 0;
        if (!a.prerelease.length) return 1;
        if (!b.prerelease.length) return -1;

        const maxLength = Math.max(a.prerelease.length, b.prerelease.length);
        for (let i = 0; i < maxLength; i++) {
            if (a.prerelease[i] == null) return -1;
            if (b.prerelease[i] == null) return 1;
            const comparison = comparePrereleaseIdentifiers(a.prerelease[i], b.prerelease[i]);
            if (comparison !== 0) return comparison;
        }

        return 0;
    }

    function summarizeReleaseBody(body, limit = SUMMARY_LIMIT) {
        const normalized = text(body)
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/[#>*_`[\]()]/g, "")
            .replace(/\s+/g, " ")
            .trim();

        if (normalized.length <= limit) return normalized;
        return normalized.slice(0, limit - 3).trimEnd() + "...";
    }

    function normalizeRelease(raw) {
        return {
            name: text(raw && (raw.name || raw.tag_name || "Release")),
            tag: text(raw && raw.tag_name),
            publishedAt: text(raw && raw.published_at),
            url: text(raw && raw.html_url),
            summary: summarizeReleaseBody(raw && raw.body)
        };
    }

    function newerThanInstalled(release, installedVersion) {
        const comparison = compareVersions(release.tag, installedVersion);
        return comparison == null ? null : comparison > 0;
    }

    function parseJsonText(jsonText) {
        return JSON.parse(text(jsonText) || "{}");
    }

    function requestXhrJson(url, options) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            if (options && options.headers) {
                Object.keys(options.headers).forEach(function (key) {
                    xhr.setRequestHeader(key, options.headers[key]);
                });
            }
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300 || xhr.status === 0) {
                    try {
                        resolve(parseJsonText(xhr.responseText));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error("Request failed: " + xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error("Network request failed")); };
            xhr.send();
        });
    }

    function requestRemoteJson(url, options) {
        if (typeof fetch === "function") {
            return fetch(url, options).then(function (response) {
                if (!response.ok) throw new Error("Request failed: " + response.status);
                return response.json();
            });
        }

        return requestXhrJson(url, options);
    }

    function requestLiveReleases() { // NEW
        if (window.trellisApp && typeof window.trellisApp.getReleases === "function") { // NEW
            return window.trellisApp.getReleases(); // NEW
        } // NEW

        return requestRemoteJson(RELEASES_API_URL, { headers: { Accept: "application/vnd.github+json" } }); // CHANGE
    } // NEW

    function requestLocalJson(url) {
        if (typeof mxUtils !== "undefined" && mxUtils.get) {
            return new Promise(function (resolve, reject) {
                mxUtils.get(url, function (request) {
                    try {
                        const body = request && typeof request.getText === "function" ? request.getText() : request && request.responseText;
                        resolve(parseJsonText(body));
                    } catch (e) {
                        reject(e);
                    }
                }, function () {
                    reject(new Error("Local request failed"));
                });
            });
        }

        return requestXhrJson(url);
    }

    function loadLocalChangelog(container) {
        return requestLocalJson(CHANGELOG_URL).then(function (changelog) {
            renderChangelog(container, changelog);
        }).catch(function () {
            clearNode(container);
            container.appendChild(createEl("div", "trellis-updates-status", "Local changelog could not be loaded."));
        });
    }

    function loadAppInfo() {
        if (window.trellisApp && typeof window.trellisApp.getInfo === "function") {
            return window.trellisApp.getInfo().then(function (info) {
                return Object.assign({}, DEFAULT_APP_INFO, info || {});
            }).catch(function () {
                return DEFAULT_APP_INFO;
            });
        }

        return Promise.resolve(DEFAULT_APP_INFO);
    }

    function openLink(ui, href) {
        const url = text(href);
        if (!url) return;

        if (ui && typeof ui.openLink === "function") {
            ui.openLink(url);
            return;
        }

        if (window.electron && typeof window.electron.request === "function") {
            window.electron.request({ action: "openExternal", url: url }, function () {}, function () {});
            return;
        }

        window.open(url, "_blank", "noopener");
    }

    function checkForUpdates(appInfo) { // CHANGE
        if (!appInfo || appInfo.canCheckForUpdates !== true) return; // NEW

        if (window.electron && typeof window.electron.sendMessage === "function") {
            window.electron.sendMessage("checkForUpdates");
        }
    }

    function getUpdateUnavailableReason(appInfo) { // NEW
        if (appInfo && appInfo.canCheckForUpdates === true) return ""; // NEW
        if (appInfo && appInfo.isPackaged === false) return "Update checks are disabled in developer builds."; // NEW
        return "Update checks are unavailable for this installation."; // NEW
    } // NEW

    function addStyles(root) {
        const style = createEl("style");
        style.textContent = [
            ".trellis-updates-dialog{font-family:Arial,sans-serif;color:#1f2933;padding:14px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px}",
            ".trellis-updates-title{font-size:18px;font-weight:700}",
            ".trellis-updates-panels{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.85fr);gap:14px;min-height:0;flex:1}",
            ".trellis-updates-pane{min-height:0;overflow:auto;border:1px solid #d7dde5;border-radius:4px;background:#fff;padding:12px;box-sizing:border-box}",
            ".trellis-updates-pane-title{font-size:15px;font-weight:700;margin:0 0 8px}",
            ".trellis-updates-section-title{font-size:13px;font-weight:700;margin:12px 0 6px}",
            ".trellis-updates-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}",
            ".trellis-updates-btn{border:1px solid #9fb0c2;background:#fff;padding:7px 10px;border-radius:4px;cursor:pointer}",
            ".trellis-updates-btn-primary{background:#2563eb;color:#fff;border-color:#2563eb}",
            ".trellis-updates-btn:disabled{opacity:.55;cursor:default}",
            ".trellis-updates-status{padding:8px 10px;background:#f5f7fa;border:1px solid #d7dde5;border-radius:4px;margin:8px 0}",
            ".trellis-release-list{max-height:210px;overflow:auto;border:1px solid #d7dde5;border-radius:4px;background:#fff}",
            ".trellis-release{padding:10px;border-bottom:1px solid #e6ebf1}",
            ".trellis-release:last-child{border-bottom:0}",
            ".trellis-release-title{font-weight:700}",
            ".trellis-release-meta{font-size:12px;color:#64748b;margin-top:3px}",
            ".trellis-release-summary{margin-top:6px;line-height:1.4}",
            ".trellis-link-group{border:1px solid #d7dde5;border-radius:4px;margin-top:10px;background:#fff}",
            ".trellis-link-group-title{font-weight:700;padding:8px 10px;border-bottom:1px solid #e6ebf1;background:#f8fafc}",
            ".trellis-link-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px 10px;border-bottom:1px solid #e6ebf1}",
            ".trellis-link-row:last-child{border-bottom:0}",
            ".trellis-link-title{font-weight:700;margin-bottom:4px}",
            ".trellis-link-value{font-size:12px;color:#475569;word-break:break-word}",
            ".trellis-empty{color:#64748b;font-style:italic}",
            "@media (max-width:760px){.trellis-updates-panels{grid-template-columns:1fr}.trellis-updates-pane{max-height:none}}"
        ].join("\n");
        root.appendChild(style);
    }

    function createButton(label, onClick, primary, options) { // CHANGE
        const button = createEl("button", primary ? "trellis-updates-btn trellis-updates-btn-primary" : "trellis-updates-btn", label);
        button.type = "button";
        if (options && options.disabled) button.disabled = true; // NEW
        if (options && options.title) button.title = options.title; // NEW
        button.addEventListener("click", onClick);
        return button;
    }

    function updateCheckButton(button, appInfo) { // NEW
        const reason = getUpdateUnavailableReason(appInfo); // NEW
        button.disabled = !!reason; // NEW
        button.title = reason; // NEW
    } // NEW

    function renderReleaseList(container, releases, appInfo, ui) {
        clearNode(container);
        const currentVersion = appInfo && appInfo.version;
        const normalized = Array.isArray(releases) ? releases.map(normalizeRelease) : [];
        const newer = [];
        const unknownOrCurrent = [];

        normalized.forEach(function (release) {
            const newerState = newerThanInstalled(release, currentVersion);
            if (newerState === true) newer.push(release);
            else unknownOrCurrent.push(release);
        });

        if (!normalized.length) {
            container.appendChild(createEl("div", "trellis-updates-status trellis-empty", "No GitHub releases were returned."));
            return;
        }

        const shown = newer.length ? newer.concat(unknownOrCurrent) : normalized;
        const heading = newer.length
            ? "Newer releases found: " + newer.length
            : "No newer GitHub releases were detected for this installation.";
        container.appendChild(createEl("div", "trellis-updates-status", heading));

        const list = createEl("div", "trellis-release-list");
        shown.forEach(function (release) {
            const item = createEl("div", "trellis-release");
            item.appendChild(createEl("div", "trellis-release-title", release.name));
            item.appendChild(createEl("div", "trellis-release-meta", [release.tag, formatDate(release.publishedAt)].filter(Boolean).join(" - ")));
            item.appendChild(createEl("div", "trellis-release-summary", release.summary || "No summary available."));
            if (release.url) {
                item.appendChild(createButton("Full notes", function () { openLink(ui, release.url); }, false));
            }
            list.appendChild(item);
        });
        container.appendChild(list);
    }

    function formatDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return text(value);
        return date.toISOString().slice(0, 10);
    }

    function renderChangelog(container, changelog) {
        clearNode(container);
        const entries = changelog && Array.isArray(changelog.entries) ? changelog.entries : [];
        if (!entries.length) {
            container.appendChild(createEl("div", "trellis-updates-status trellis-empty", "No local Trellis changelog entries yet."));
            return;
        }

        const list = createEl("div", "trellis-release-list");
        entries.forEach(function (entry) {
            const item = createEl("div", "trellis-release");
            item.appendChild(createEl("div", "trellis-release-title", text(entry.version || entry.title || "Local update")));
            item.appendChild(createEl("div", "trellis-release-meta", text(entry.date || "")));
            const items = Array.isArray(entry.items) ? entry.items : [];
            item.appendChild(createEl("div", "trellis-release-summary", items.join(" ")));
            list.appendChild(item);
        });
        container.appendChild(list);
    }

    function renderLinks(container, appInfo, ui) {
        clearNode(container);
        const groups = [ // CHANGE
            ["Support", [["Patreon", LINK_CONFIG.patreon], ["YouTube", LINK_CONFIG.youtube]]], // NEW
            ["Project", [["GitHub issues", appInfo.issuesUrl], ["GitHub releases", appInfo.releasesUrl]]], // NEW
            ["Contact", [["Website", LINK_CONFIG.website], ["Email", LINK_CONFIG.email], ["Phone", LINK_CONFIG.phone]]] // NEW
        ];

        container.appendChild(createEl("div", "trellis-updates-status", "Contact: " + LINK_CONFIG.name));
        groups.forEach(function (group) { // CHANGE
            const groupEl = createEl("div", "trellis-link-group"); // NEW
            groupEl.appendChild(createEl("div", "trellis-link-group-title", group[0])); // NEW
            group[1].forEach(function (entry) { // NEW
                const row = createEl("div", "trellis-link-row"); // NEW
                const content = createEl("div"); // NEW
                content.appendChild(createEl("div", "trellis-link-title", entry[0])); // NEW
                content.appendChild(createEl("div", "trellis-link-value", entry[1])); // NEW
                row.appendChild(content); // NEW
                row.appendChild(createButton("Open", function () { openLink(ui, entry[1]); }, false)); // NEW
                groupEl.appendChild(row); // NEW
            }); // NEW
            container.appendChild(groupEl); // NEW
        });
    }

    function buildDialog(ui) {
        const state = { appInfo: DEFAULT_APP_INFO };
        const root = createEl("div", "trellis-updates-dialog");
        addStyles(root);
        root.appendChild(createEl("div", "trellis-updates-title", ACTION_LABEL));

        const panels = createEl("div", "trellis-updates-panels"); // NEW
        const updatesPane = createEl("div", "trellis-updates-pane");
        const linksPane = createEl("div", "trellis-updates-pane");
        panels.appendChild(updatesPane); // NEW
        panels.appendChild(linksPane); // NEW
        root.appendChild(panels); // NEW

        const installed = createEl("div", "trellis-updates-status", "Loading app information...");
        const releaseContainer = createEl("div");
        const changelogContainer = createEl("div");
        const actions = createEl("div", "trellis-updates-actions");
        const updateButton = createButton("Check for updates", function () { checkForUpdates(state.appInfo); }, true, { disabled: true, title: getUpdateUnavailableReason(state.appInfo) }); // CHANGE
        updatesPane.appendChild(createEl("div", "trellis-updates-pane-title", "Updates")); // NEW
        actions.appendChild(updateButton); // CHANGE
        actions.appendChild(createButton("Open GitHub releases", function () { openLink(ui, state.appInfo.releasesUrl); }, false));
        updatesPane.appendChild(installed);
        updatesPane.appendChild(actions);
        updatesPane.appendChild(createEl("div", "trellis-updates-section-title", "GitHub releases")); // CHANGE
        updatesPane.appendChild(releaseContainer);
        updatesPane.appendChild(createEl("div", "trellis-updates-section-title", "Local changelog")); // CHANGE
        updatesPane.appendChild(changelogContainer);
        linksPane.appendChild(createEl("div", "trellis-updates-pane-title", "Links")); // NEW

        function updateInstalled(info) {
            clearNode(installed);
            appendText(installed, info.productName + (info.version ? " " + info.version : ""));
            const reason = getUpdateUnavailableReason(info); // NEW
            if (reason) appendText(installed, " - " + reason); // NEW
            updateCheckButton(updateButton, info); // NEW
        }

        renderChangelog(changelogContainer, { entries: [] });
        renderLinks(linksPane, state.appInfo, ui);
        loadAppInfo().then(function (appInfo) {
            state.appInfo = appInfo;
            updateInstalled(appInfo);
            renderLinks(linksPane, appInfo, ui);
            loadLiveReleases(releaseContainer, appInfo, ui);
        });
        loadLocalChangelog(changelogContainer);

        return root;
    }

    function loadLiveReleases(container, appInfo, ui) {
        clearNode(container);
        container.appendChild(createEl("div", "trellis-updates-status", "Loading GitHub releases..."));
        return requestLiveReleases().then(function (data) { // CHANGE
            renderReleaseList(container, data, appInfo, ui);
        }).catch(function () {
            clearNode(container);
            const fallback = createEl("div", "trellis-updates-status", "Live GitHub releases are unavailable right now."); // CHANGE
            fallback.appendChild(createButton("Open GitHub releases", function () { openLink(ui, appInfo.releasesUrl); }, false));
            fallback.appendChild(createButton("Retry", function () { loadLiveReleases(container, appInfo, ui); }, false));
            container.appendChild(fallback);
        });
    }

    function install(ui) {
        if (!ui || !ui.actions || ui.__trellisUpdatesLinksInstalled) return;
        ui.__trellisUpdatesLinksInstalled = true;

        ui.actions.addAction(ACTION_ID, function () {
            ui.showDialog(buildDialog(ui), 960, 620, true, true); // CHANGE
            elevateTrellisDialog(ui); // NEW
        });

        const action = ui.actions.get && ui.actions.get(ACTION_ID);
        if (action) action.label = ACTION_LABEL;

        if (ui.menus && ui.menus.get) {
            const help = ui.menus.get("help");
            if (help && !help.__trellisUpdatesLinksPatched) {
                const oldFunct = help.funct;
                help.funct = function (menu, parent) {
                    if (typeof oldFunct === "function") oldFunct.apply(this, arguments);
                    ui.menus.addMenuItems(menu, ["-", ACTION_ID], parent);
                };
                help.__trellisUpdatesLinksPatched = true;
            }
        }
    }

    window.TrellisUpdatesLinks = {
        install: install,
        _test: {
            ACTION_ID: ACTION_ID,
            LINK_CONFIG: LINK_CONFIG,
            DEFAULT_APP_INFO: DEFAULT_APP_INFO,
            compareVersions: compareVersions,
            normalizeRelease: normalizeRelease,
            summarizeReleaseBody: summarizeReleaseBody,
            newerThanInstalled: newerThanInstalled,
            requestLocalJson: requestLocalJson,
            requestLiveReleases: requestLiveReleases, // NEW
            buildDialog: buildDialog,
            getUpdateUnavailableReason: getUpdateUnavailableReason, // NEW
            renderReleaseList: renderReleaseList
        }
    };

    if (typeof Draw !== "undefined" && Draw.loadPlugin) {
        Draw.loadPlugin(install);
    }
})();
