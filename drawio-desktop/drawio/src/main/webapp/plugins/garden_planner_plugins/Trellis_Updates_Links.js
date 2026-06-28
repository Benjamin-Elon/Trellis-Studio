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
    const RELEASES_API_URL = "https://api.github.com/repos/Benjamin-Elon/Trellis-for-Drawio/releases?per_page=10";
    const CHANGELOG_URL = "plugins/garden_planner_plugins/trellis_changelog.json";
    const SUMMARY_LIMIT = 220;

    const DEFAULT_APP_INFO = Object.freeze({
        productName: "Trellis for Drawio",
        version: "",
        repoUrl: "https://github.com/Benjamin-Elon/Trellis-for-Drawio",
        releasesUrl: "https://github.com/Benjamin-Elon/Trellis-for-Drawio/releases",
        issuesUrl: "https://github.com/Benjamin-Elon/Trellis-for-Drawio/issues"
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

    function checkForUpdates() {
        if (window.electron && typeof window.electron.sendMessage === "function") {
            window.electron.sendMessage("checkForUpdates");
        }
    }

    function addStyles(root) {
        const style = createEl("style");
        style.textContent = [
            ".trellis-updates-dialog{font-family:Arial,sans-serif;color:#1f2933;padding:14px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px}",
            ".trellis-updates-title{font-size:18px;font-weight:700}",
            ".trellis-updates-tabs{display:flex;gap:6px;border-bottom:1px solid #d7dde5}",
            ".trellis-updates-tab{border:1px solid #c9d2de;border-bottom:0;background:#f7f9fb;padding:7px 12px;cursor:pointer;border-radius:4px 4px 0 0}",
            ".trellis-updates-tab[aria-selected='true']{background:#fff;font-weight:700}",
            ".trellis-updates-pane{display:none;min-height:0;overflow:auto;flex:1}",
            ".trellis-updates-pane-active{display:block}",
            ".trellis-updates-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}",
            ".trellis-updates-btn{border:1px solid #9fb0c2;background:#fff;padding:7px 10px;border-radius:4px;cursor:pointer}",
            ".trellis-updates-btn-primary{background:#2563eb;color:#fff;border-color:#2563eb}",
            ".trellis-updates-status{padding:8px 10px;background:#f5f7fa;border:1px solid #d7dde5;border-radius:4px;margin:8px 0}",
            ".trellis-release-list{max-height:210px;overflow:auto;border:1px solid #d7dde5;border-radius:4px;background:#fff}",
            ".trellis-release{padding:10px;border-bottom:1px solid #e6ebf1}",
            ".trellis-release:last-child{border-bottom:0}",
            ".trellis-release-title{font-weight:700}",
            ".trellis-release-meta{font-size:12px;color:#64748b;margin-top:3px}",
            ".trellis-release-summary{margin-top:6px;line-height:1.4}",
            ".trellis-link-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}",
            ".trellis-link-card{border:1px solid #d7dde5;border-radius:4px;padding:10px;background:#fff}",
            ".trellis-link-title{font-weight:700;margin-bottom:4px}",
            ".trellis-link-value{font-size:12px;color:#475569;word-break:break-word}",
            ".trellis-empty{color:#64748b;font-style:italic}"
        ].join("\n");
        root.appendChild(style);
    }

    function createButton(label, onClick, primary) {
        const button = createEl("button", primary ? "trellis-updates-btn trellis-updates-btn-primary" : "trellis-updates-btn", label);
        button.type = "button";
        button.addEventListener("click", onClick);
        return button;
    }

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
        const links = [
            ["Patreon", LINK_CONFIG.patreon],
            ["YouTube", LINK_CONFIG.youtube],
            ["GitHub issues", appInfo.issuesUrl],
            ["GitHub releases", appInfo.releasesUrl],
            ["Website", LINK_CONFIG.website],
            ["Email", LINK_CONFIG.email],
            ["Phone", LINK_CONFIG.phone]
        ];

        container.appendChild(createEl("div", "trellis-updates-status", "Contact: " + LINK_CONFIG.name));
        const grid = createEl("div", "trellis-link-grid");
        links.forEach(function (entry) {
            const card = createEl("div", "trellis-link-card");
            card.appendChild(createEl("div", "trellis-link-title", entry[0]));
            card.appendChild(createEl("div", "trellis-link-value", entry[1]));
            card.appendChild(createButton("Open", function () { openLink(ui, entry[1]); }, false));
            grid.appendChild(card);
        });
        container.appendChild(grid);
    }

    function buildDialog(ui) {
        const state = { appInfo: DEFAULT_APP_INFO };
        const root = createEl("div", "trellis-updates-dialog");
        addStyles(root);
        root.appendChild(createEl("div", "trellis-updates-title", ACTION_LABEL));

        const tabs = createEl("div", "trellis-updates-tabs");
        const updatesTab = createButton("Updates", function () { selectTab("updates"); }, false);
        const linksTab = createButton("Links", function () { selectTab("links"); }, false);
        updatesTab.className = "trellis-updates-tab";
        linksTab.className = "trellis-updates-tab";
        updatesTab.setAttribute("role", "tab");
        linksTab.setAttribute("role", "tab");
        tabs.appendChild(updatesTab);
        tabs.appendChild(linksTab);
        root.appendChild(tabs);

        const updatesPane = createEl("div", "trellis-updates-pane");
        const linksPane = createEl("div", "trellis-updates-pane");
        root.appendChild(updatesPane);
        root.appendChild(linksPane);

        const installed = createEl("div", "trellis-updates-status", "Loading app information...");
        const releaseContainer = createEl("div");
        const changelogContainer = createEl("div");
        const actions = createEl("div", "trellis-updates-actions");
        actions.appendChild(createButton("Check for updates", checkForUpdates, true));
        actions.appendChild(createButton("Open GitHub releases", function () { openLink(ui, state.appInfo.releasesUrl); }, false));
        actions.appendChild(createButton("Retry GitHub releases", function () { loadLiveReleases(releaseContainer, state.appInfo, ui); }, false));
        updatesPane.appendChild(installed);
        updatesPane.appendChild(actions);
        updatesPane.appendChild(createEl("h3", "", "GitHub releases"));
        updatesPane.appendChild(releaseContainer);
        updatesPane.appendChild(createEl("h3", "", "Local changelog"));
        updatesPane.appendChild(changelogContainer);

        function selectTab(tabName) {
            const updatesSelected = tabName === "updates";
            updatesTab.setAttribute("aria-selected", updatesSelected ? "true" : "false");
            linksTab.setAttribute("aria-selected", updatesSelected ? "false" : "true");
            updatesPane.className = updatesSelected ? "trellis-updates-pane trellis-updates-pane-active" : "trellis-updates-pane";
            linksPane.className = updatesSelected ? "trellis-updates-pane" : "trellis-updates-pane trellis-updates-pane-active";
        }

        function updateInstalled(info) {
            clearNode(installed);
            appendText(installed, info.productName + (info.version ? " " + info.version : ""));
        }

        selectTab("updates");
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
        return requestRemoteJson(RELEASES_API_URL, { headers: { Accept: "application/vnd.github+json" } }).then(function (data) {
            renderReleaseList(container, data, appInfo, ui);
        }).catch(function () {
            clearNode(container);
            const fallback = createEl("div", "trellis-updates-status", "GitHub releases could not be loaded.");
            fallback.appendChild(createButton("Open GitHub releases", function () { openLink(ui, appInfo.releasesUrl); }, false));
            fallback.appendChild(createButton("Retry", function () { loadLiveReleases(container, appInfo, ui); }, false));
            container.appendChild(fallback);
        });
    }

    function install(ui) {
        if (!ui || !ui.actions || ui.__trellisUpdatesLinksInstalled) return;
        ui.__trellisUpdatesLinksInstalled = true;

        ui.actions.addAction(ACTION_ID, function () {
            ui.showDialog(buildDialog(ui), 720, 540, true, true);
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
            buildDialog: buildDialog,
            renderReleaseList: renderReleaseList
        }
    };

    if (typeof Draw !== "undefined" && Draw.loadPlugin) {
        Draw.loadPlugin(install);
    }
})();
