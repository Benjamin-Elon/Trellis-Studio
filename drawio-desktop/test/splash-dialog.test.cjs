const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const dialogsPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/Dialogs.js");
const appPath = path.join(projectRoot, "drawio/src/main/webapp/js/diagramly/App.js");
const bundledPath = path.join(projectRoot, "drawio/src/main/webapp/js/app.min.js");
const wizardStorageKey = "trellis.licenseWizard.v2";

function loadSplashDialog(options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.test/" });
    const timers = [];

    dom.window.setTimeout = function (callback, delay) {
        const id = timers.length + 1;
        timers.push({ id, callback, delay, cleared: false });
        return id;
    };
    dom.window.clearTimeout = function (id) {
        const timer = timers.find((entry) => entry.id === id);

        if (timer != null) {
            timer.cleared = true;
        }
    };

    if (options.savedRecord) {
        dom.window.localStorage.setItem(wizardStorageKey, JSON.stringify(options.savedRecord));
    }

    if (options.oldChoice) {
        dom.window.localStorage.setItem("trellis.licenseNotice.v1", JSON.stringify({ choice: options.oldChoice, version: "1" }));
    }

    const actions = {
        new: { funct() {} },
        open: { funct() {} }
    };
    const context = {
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        JSON,
        Date,
        console,
        IMAGE_PATH: "images",
        urlParams: {},
        mxClient: { IS_CHROMEAPP: false },
        mxImage: function (src, width, height) { // NEW
            return { src, width, height }; // NEW
        }, // NEW
        EditorUi: { isElectronApp: true },
        App: {
            MODE_GOOGLE: "google",
            MODE_DROPBOX: "dropbox",
            MODE_ONEDRIVE: "onedrive",
            MODE_GITHUB: "github",
            MODE_GITLAB: "gitlab",
            MODE_BROWSER: "browser",
            MODE_TRELLO: "trello",
            MODE_DEVICE: "device"
        },
        mxResources: {
            get(key) {
                return {
                    createNewDiagram: "Create New Diagram",
                    openExistingDiagram: "Open Existing Diagram",
                    device: "Device"
                }[key] || key;
            }
        },
        mxUtils: {
            write(node, value) {
                node.appendChild(dom.window.document.createTextNode(String(value)));
            },
            br(node) {
                node.appendChild(dom.window.document.createElement("br"));
            },
            button(label, callback) {
                const button = dom.window.document.createElement("button");
                button.textContent = label;
                button.addEventListener("click", callback);
                return button;
            },
            trim(value) {
                return String(value).trim();
            }
        },
        mxEvent: {
            addListener(node, eventName, callback) {
                node.addEventListener(eventName, callback);
            },
            consume(evt) {
                if (evt != null && evt.preventDefault != null) {
                    evt.preventDefault();
                }
            }
        }
    };

    vm.runInNewContext(fs.readFileSync(dialogsPath, "utf8"), context, { filename: dialogsPath });
    const editorUi = {
        mode: context.App.MODE_DEVICE,
        addLanguageMenu() {
            return null;
        },
        actions: {
            get(id) {
                return actions[id];
            }
        },
        hideDialog() {},
        openLink() {}
    };
    const dialog = new context.SplashDialog(editorUi);
    return { dom, dialog, timers };
}

function findButton(root, label) {
    return Array.from(root.querySelectorAll("button")).find((button) => button.textContent.includes(label));
}

function openOath(dialog, pathLabel = "Personal / Noncommercial") {
    findButton(dialog.container, pathLabel).click();
    return findButton(dialog.container, "I Affirm the Oath");
}

function setAffirmButtonRect(button) {
    button.getBoundingClientRect = () => ({
        left: 100,
        top: 100,
        right: 220,
        bottom: 140,
        width: 120,
        height: 40
    });
}

function dispatchMouseMove(dom, target, clientX, clientY) {
    target.dispatchEvent(new dom.window.MouseEvent("mousemove", {
        bubbles: true,
        clientX,
        clientY
    }));
}

function makeSavedRecord(overrides = {}) {
    return {
        path: "personal",
        contactGuidance: false,
        name: "Saved User",
        email: "saved@example.com",
        signature: "Saved User",
        oathCompletedAt: "2026-07-03T00:00:00.000Z",
        version: "2",
        ...overrides
    };
}

function loadShowSplashHarness(options = {}) {
    const appSource = fs.readFileSync(appPath, "utf8");
    const start = appSource.indexOf("App.prototype.showSplash = function(force)");
    const end = appSource.indexOf("App.prototype.createFileSystemOptions", start);
    const calls = {
        createFile: [],
        exitRequests: [],
        exitMessages: 0,
        windowClosed: 0,
        showDialog: null
    };

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    function App() {}

    const splashDialog = {
        container: { id: "splash" },
        isTrellisLicenseWizardComplete() {
            return !!options.complete;
        },
        showTrellisExitMessage() {
            calls.exitMessages++;
        }
    };
    const context = {
        App,
        SplashDialog: function () {
            return splashDialog;
        },
        StorageDialog: function () {
            throw new Error("StorageDialog should not be created for Electron splash tests");
        },
        EditorUi: { isElectronApp: options.electronApp !== false },
        Editor: { useLocalStorage: true },
        mxClient: { IS_CHROMEAPP: false },
        mxResources: {
            get(key) {
                return key;
            }
        },
        mxUtils: {
            bind(scope, fn) {
                return fn.bind(scope);
            }
        },
        urlParams: {},
        electron: {
            request(payload) {
                calls.exitRequests.push(payload);
            }
        },
        window: {
            close() {
                calls.windowClosed++;
            }
        }
    };

    vm.runInNewContext(appSource.slice(start, end), context, { filename: appPath });

    const app = Object.create(context.App.prototype);
    app.defaultFilename = "Untitled Diagram";
    app.editor = {
        isChromelessView() {
            return false;
        }
    };
    app.getServiceCount = () => 1;
    app.showDialog = function (container, width, height, modal, closable, closeCallback) {
        calls.showDialog = { container, width, height, modal, closable, closeCallback };
    };
    app.createFile = function (...args) {
        calls.createFile.push(args);
    };
    app.handleError = function () {
        throw new Error("handleError should not be called");
    };

    app.showSplash();
    assert.ok(calls.showDialog);

    return { calls, context };
}

function completeVisibleOath(dom, dialog) {
    const playButton = findButton(dialog.container, "Play Oath Aloud");

    playButton.click();
    playButton.click();
    playButton.click();

    const overrideButton = findButton(dialog.container, "Manual audio override");
    assert.equal(overrideButton.style.display, "");
    overrideButton.click();

    const inputs = dialog.container.querySelectorAll("input");
    inputs[0].value = "Test User";
    inputs[1].value = "test@example.com";
    inputs[2].value = "Test User";
    inputs[3].checked = true;

    findButton(dialog.container, "I Affirm the Oath").click();
}

test("SplashDialog renders the usage wizard and hides diagram actions before oath completion", () => {
    const { dialog, timers } = loadSplashDialog();
    const text = dialog.container.textContent;

    assert.match(text, /Choose your path/);
    assert.match(text, /Personal \/ Noncommercial/);
    assert.match(text, /Education \/ Nonprofit \/ Public-interest/);
    assert.match(text, /Commercial \/ Client \/ Company/);
    assert.match(text, /Not sure/);
    assert.equal(dialog.container.querySelector(".trellis-splash-actions").style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(timers.length, 0);
});

test("Commercial path shows contact guidance and the Grand Oath gate", () => {
    const { dialog } = loadSplashDialog();

    findButton(dialog.container, "Commercial / Client / Company").click();

    assert.match(dialog.container.textContent, /Contact before relying on commercial permission/);
    assert.match(dialog.container.textContent, /Placeholder Contact Name/);
    assert.match(dialog.container.textContent, /The Grand Oath of Paying Attention/);
    assert.ok(findButton(dialog.container, "Play Oath Aloud"));
    assert.ok(findButton(dialog.container, "I Affirm the Oath"));
});

test("Affirm button evades pointer proximity only before oath completion", () => {
    const { dom, dialog } = loadSplashDialog();
    const affirmButton = openOath(dialog);
    const gateSection = affirmButton.parentNode.parentNode;

    setAffirmButtonRect(affirmButton);
    dispatchMouseMove(dom, gateSection, 400, 400);
    assert.equal(affirmButton.style.transform, "");

    dispatchMouseMove(dom, gateSection, 90, 120);
    assert.equal(affirmButton.style.transform, "translate(90px,18px)");

    findButton(dialog.container, "Play Oath Aloud").click();
    findButton(dialog.container, "Play Oath Aloud").click();
    findButton(dialog.container, "Play Oath Aloud").click();
    findButton(dialog.container, "Manual audio override").click();

    assert.equal(affirmButton.style.transform, "translate(0,0)");
    dispatchMouseMove(dom, gateSection, 90, 120);
    assert.equal(affirmButton.style.transform, "translate(0,0)");
});

test("Affirm button caps non-pointer evasions before the oath is ready", () => {
    const { dom, dialog } = loadSplashDialog();
    const affirmButton = openOath(dialog);

    affirmButton.dispatchEvent(new dom.window.Event("focus", { bubbles: false, cancelable: true }));
    assert.equal(affirmButton.style.transform, "translate(90px,18px)");

    affirmButton.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
    assert.equal(affirmButton.style.transform, "translate(-90px,-18px)");

    affirmButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        keyCode: 13
    }));
    const cappedTransform = affirmButton.style.transform;
    assert.equal(cappedTransform, "translate(90px,18px)");

    affirmButton.click();
    affirmButton.click();

    assert.equal(affirmButton.style.transform, cappedTransform);
    assert.match(dialog.container.textContent, /out of hiding places/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
});

test("Oath completion stores the wizard record and reveals actions after two seconds", () => {
    const { dom, dialog, timers } = loadSplashDialog();
    const actions = dialog.container.querySelector(".trellis-splash-actions");

    findButton(dialog.container, "Commercial / Client / Company").click();
    completeVisibleOath(dom, dialog);

    const record = JSON.parse(dom.window.localStorage.getItem(wizardStorageKey));
    assert.equal(record.path, "commercial");
    assert.equal(record.contactGuidance, true);
    assert.equal(record.name, "Test User");
    assert.equal(record.email, "test@example.com");
    assert.equal(record.signature, "Test User");
    assert.equal(record.version, "2");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.equal(actions.style.display, "none");
    assert.equal(timers.at(-1).delay, 2000);

    timers.at(-1).callback();
    assert.equal(actions.style.display, "");
});

test("Saved wizard records show summary, contact guidance, Change license, and delayed actions", () => {
    const savedRecord = {
        path: "unsure",
        contactGuidance: true,
        name: "Saved User",
        email: "saved@example.com",
        signature: "Saved User",
        oathCompletedAt: "2026-07-03T00:00:00.000Z",
        version: "2"
    };
    const { dom, dialog, timers } = loadSplashDialog({ savedRecord });
    const actions = dialog.container.querySelector(".trellis-splash-actions");

    assert.match(dialog.container.textContent, /Saved license path/);
    assert.match(dialog.container.textContent, /Placeholder Contact Name/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.equal(actions.style.display, "none");
    assert.equal(timers[0].delay, 2000);

    timers[0].callback();
    assert.equal(actions.style.display, "");

    findButton(dialog.container, "Change license").click();
    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null);
    assert.match(dialog.container.textContent, /Choose your path/);
    assert.equal(actions.style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
});

test("Incomplete or corrupt saved wizard records are ignored", () => {
    const missingSignature = loadSplashDialog({
        savedRecord: makeSavedRecord({ signature: "" })
    });
    assert.match(missingSignature.dialog.container.textContent, /Choose your path/);
    assert.equal(missingSignature.dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(missingSignature.timers.length, 0);

    const mismatchedGuidance = loadSplashDialog({
        savedRecord: makeSavedRecord({ path: "commercial", contactGuidance: false })
    });
    assert.match(mismatchedGuidance.dialog.container.textContent, /Choose your path/);
    assert.equal(mismatchedGuidance.dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(mismatchedGuidance.timers.length, 0);
});

test("SplashDialog ignores old v1 license acknowledgements", () => {
    const { dialog, timers } = loadSplashDialog({ oldChoice: "community" });

    assert.match(dialog.container.textContent, /Choose your path/);
    assert.equal(dialog.container.querySelector(".trellis-splash-actions").style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(timers.length, 0);
});

test("Incomplete splash dismissal requests exit and does not create a blank diagram", () => {
    const { calls } = loadShowSplashHarness({ complete: false });
    const result = calls.showDialog.closeCallback(true, false);

    assert.equal(result, false);
    assert.equal(calls.exitRequests.length, 1);
    assert.equal(calls.exitRequests[0].action, "exit");
    assert.equal(calls.windowClosed, 0);
    assert.equal(calls.exitMessages, 1);
    assert.equal(calls.createFile.length, 0);
});

test("Completed splash dismissal preserves blank diagram creation", () => {
    const { calls, context } = loadShowSplashHarness({ complete: true });
    const result = calls.showDialog.closeCallback(true, false);

    assert.equal(result, undefined);
    assert.equal(calls.exitRequests.length, 0);
    assert.equal(calls.exitMessages, 0);
    assert.equal(calls.createFile.length, 1);
    assert.equal(calls.createFile[0][0], "Untitled Diagram.drawio");
    assert.equal(context.Editor.useLocalStorage, true);
});

test("SplashDialog source and bundle use oath wizard storage, close hook, and expanded dimensions", () => {
    const appSource = fs.readFileSync(appPath, "utf8");
    const bundledSource = fs.readFileSync(bundledPath, "utf8");
    const dialogSource = fs.readFileSync(dialogsPath, "utf8");
    const dialogBindingIndex = dialogSource.indexOf("var trellisSplashDialog = this;");
    const dialogHookIndex = dialogSource.indexOf("trellisSplashDialog.isTrellisLicenseWizardComplete");
    const bundledBindingIndex = bundledSource.indexOf("var trellisSplashDialog = this;");
    const bundledHookIndex = bundledSource.indexOf("trellisSplashDialog.isTrellisLicenseWizardComplete");

    assert.match(dialogSource, /trellis\.licenseWizard\.v/);
    assert.ok(dialogBindingIndex >= 0);
    assert.ok(dialogHookIndex > dialogBindingIndex);
    assert.match(dialogSource, /isTrellisLicenseWizardComplete/);
    assert.match(dialogSource, /isTrellisWizardRecordValid/);
    assert.match(dialogSource, /pointerRunawayDistance = 120/);
    assert.match(dialogSource, /I Affirm the Oath/);
    assert.match(appSource, /showDialog\(dlg\.container, 760, 720/);
    assert.match(appSource, /showTrellisExitMessage/);
    assert.match(bundledSource, /trellis\.licenseWizard\.v/);
    assert.ok(bundledBindingIndex >= 0);
    assert.ok(bundledHookIndex > bundledBindingIndex);
    assert.match(bundledSource, /isTrellisLicenseWizardComplete/);
    assert.match(bundledSource, /isTrellisWizardRecordValid/);
    assert.match(bundledSource, /pointerRunawayDistance = 120/);
    assert.match(bundledSource, /showDialog\(p\.container,760,720/);
});
