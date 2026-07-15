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
const enhancementPath = path.join(projectRoot, "drawio/src/main/webapp/js/trellis-splash.js"); // NEW
const splashCssPath = path.join(projectRoot, "drawio/src/main/webapp/styles/trellis-splash.css"); // NEW
const bootstrapPath = path.join(projectRoot, "drawio/src/main/webapp/js/bootstrap.js"); // NEW
const indexPath = path.join(projectRoot, "drawio/src/main/webapp/index.html"); // NEW
const electronPath = path.join(projectRoot, "src/main/electron.js"); // NEW
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

    let helpCalls = 0; // NEW
    const actions = {
        new: { funct() {} },
        open: { funct() {} }
    };

    if (options.helpAction) { // NEW
        actions.trellisUpdatesLinks = { funct() { helpCalls++; } }; // NEW
    } // NEW
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
        addLanguageMenu(root) {
            if (!options.languageControl) return null; // NEW
            const language = dom.window.document.createElement("div"); // NEW
            language.className = "geAdaptiveAsset"; // NEW
            root.appendChild(language); // NEW
            return language; // NEW
        },
        actions: {
            get(id) {
                return actions[id];
            }
        },
        hideDialog() {},
        openLink() {}
    };
    vm.runInNewContext(fs.readFileSync(enhancementPath, "utf8"), context, { filename: enhancementPath }); // NEW
    context.window.TrellisSplashEnhancements.install(); // NEW
    const dialog = new context.SplashDialog(editorUi);
    return { dom, dialog, timers, context, editorUi, getHelpCalls: () => helpCalls }; // CHANGE
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
    app.showDialog = function (container, width, height, modal, closable, closeCallback, noScroll, transparent, minSize, ignoreBgClick) {
        calls.showDialog = { container, width, height, modal, closable, closeCallback, noScroll, transparent, minSize, ignoreBgClick }; // CHANGE
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

test("New oath records require a complete email without invalidating legacy records", () => { // NEW
    const legacy = loadSplashDialog({ // NEW
        savedRecord: makeSavedRecord({ email: "Barneywilson@gmail." }) // NEW
    }); // NEW
    assert.equal(legacy.dialog.isTrellisLicenseWizardComplete(), true); // NEW
    assert.match(legacy.dialog.container.textContent, /Barneywilson@gmail\./); // NEW

    const { dom, dialog } = loadSplashDialog(); // NEW
    openOath(dialog); // NEW
    const playButton = findButton(dialog.container, "Play Oath Aloud"); // NEW
    playButton.click(); // NEW
    playButton.click(); // NEW
    playButton.click(); // NEW
    findButton(dialog.container, "Manual audio override").click(); // NEW
    const inputs = dialog.container.querySelectorAll("input"); // NEW
    inputs[0].value = "New User"; // NEW
    inputs[1].value = "new@example."; // NEW
    inputs[2].value = "New User"; // NEW
    inputs[3].checked = true; // NEW
    findButton(dialog.container, "I Affirm the Oath").click(); // NEW

    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null); // NEW
    assert.match(dialog.container.textContent, /Enter a complete email address/); // NEW
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false); // NEW

    inputs[1].value = "new@example.com"; // NEW
    findButton(dialog.container, "I Affirm the Oath").click(); // NEW
    assert.equal(JSON.parse(dom.window.localStorage.getItem(wizardStorageKey)).email, "new@example.com"); // NEW
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true); // NEW
}); // NEW

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

    assert.match(dialog.container.textContent, /Saved license/); // CHANGE
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

    assert.equal(calls.showDialog.ignoreBgClick, true); // NEW
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

    assert.equal(calls.showDialog.ignoreBgClick, true); // NEW
    assert.equal(result, undefined);
    assert.equal(calls.exitRequests.length, 0);
    assert.equal(calls.exitMessages, 0);
    assert.equal(calls.createFile.length, 1);
    assert.equal(calls.createFile[0][0], "Untitled Diagram.drawio");
    assert.equal(context.Editor.useLocalStorage, true);
});

test("SplashDialog source and bundle use oath wizard storage, close hook, validation, and card dimensions", () => { // CHANGE
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
	assert.match(dialogSource, /isTrellisNewEmailValid/); // NEW
    assert.match(dialogSource, /pointerRunawayDistance = 120/);
    assert.match(dialogSource, /I Affirm the Oath/);
	assert.match(appSource, /showDialog\(dlg\.container, 700, 630[\s\S]*true, null, null, true/); // CHANGE
    assert.match(appSource, /showTrellisExitMessage/);
    assert.match(bundledSource, /trellis\.licenseWizard\.v/);
    assert.ok(bundledBindingIndex >= 0);
    assert.ok(bundledHookIndex > bundledBindingIndex);
    assert.match(bundledSource, /isTrellisLicenseWizardComplete/);
    assert.match(bundledSource, /isTrellisWizardRecordValid/);
	assert.match(bundledSource, /isTrellisNewEmailValid/); // NEW
    assert.match(bundledSource, /pointerRunawayDistance = 120/);
	assert.match(bundledSource, /showDialog\(p\.container,700,630[\s\S]*!0,null,null,!0/); // CHANGE
});

test("Trellis splash enhancement adds the branded shell, saved-state structure, and actions without the Help row", () => { // CHANGE
    const { dialog, getHelpCalls } = loadSplashDialog({ // NEW
		savedRecord: makeSavedRecord({ email: "Barneywilson@gmail." }), // CHANGE
        helpAction: true, // NEW
        languageControl: true // NEW
    }); // NEW
    const createButton = findButton(dialog.container, "Create New Diagram"); // NEW
    const openButton = findButton(dialog.container, "Open Existing Diagram"); // NEW
    const helpButton = findButton(dialog.container, "Help"); // NEW

    assert.ok(dialog.container.classList.contains("trellis-splash-root")); // NEW
    assert.equal(dialog.container.querySelector(".geAdaptiveAsset"), null); // NEW
    assert.equal(dialog.container.querySelector(".trellis-splash-tagline").textContent, "Build systems that grow."); // NEW
	assert.match(dialog.container.textContent, /Saved license/); // NEW
	assert.match(dialog.container.textContent, /Saved User/); // NEW
	assert.match(dialog.container.textContent, /Barneywilson@gmail\./); // CHANGE
	assert.ok(dialog.container.classList.contains("trellis-saved-state")); // NEW
	assert.equal(dialog.container.querySelector(".trellis-splash-state-intro").hidden, true); // NEW
	assert.equal(dialog.container.querySelector(".trellis-saved-license-path").textContent, "Path: Personal / Noncommercial."); // NEW
	assert.equal(dialog.container.querySelector(".trellis-saved-license-signer").textContent, "Signed by Saved User using Barneywilson@gmail."); // NEW
    assert.ok(dialog.container.querySelector(".trellis-saved-license-card .trellis-license-icon")); // NEW
    assert.ok(createButton.classList.contains("trellis-primary-action")); // NEW
    assert.ok(openButton.classList.contains("trellis-secondary-action")); // NEW
    assert.ok(createButton.querySelector("svg")); // NEW
    assert.ok(openButton.querySelector("svg")); // NEW
    assert.equal(helpButton, undefined); // CHANGE
    assert.equal(dialog.container.querySelector(".trellis-splash-footer"), null); // NEW
    assert.equal(getHelpCalls(), 0); // CHANGE
    assert.doesNotMatch(dialog.container.textContent, /Settings|Language/); // NEW
}); // NEW

test("Trellis splash outer decoration stays below app chrome and applies a validated background", () => { // NEW
    const { dom, dialog, context, editorUi } = loadSplashDialog({ savedRecord: makeSavedRecord() }); // NEW
    const outerContainer = dom.window.document.createElement("div"); // NEW
    const backdrop = dom.window.document.createElement("div"); // NEW
    const closeButton = dom.window.document.createElement("div"); // NEW
    const requests = []; // NEW

    closeButton.className = "geButton"; // NEW
    outerContainer.appendChild(closeButton); // NEW
	editorUi.diagramContainer = { // CHANGE
		getBoundingClientRect() { return { left: 0, top: 98, width: 1536, height: 718 }; } // NEW
	}; // CHANGE
    context.electron = { // NEW
        request(payload, callback) { // NEW
            requests.push(payload); // NEW
            callback("garden view.webp"); // NEW
        } // NEW
    }; // NEW
    dom.window.Image = class { // NEW
        set src(value) { // NEW
            this.loadedSource = value; // NEW
            this.onload(); // NEW
        } // NEW
    }; // NEW

    context.window.TrellisSplashEnhancements.decorateOuterDialog( // NEW
        editorUi, dialog, { container: outerContainer, bg: backdrop }); // NEW

    assert.ok(outerContainer.classList.contains("trellis-splash-dialog")); // NEW
    assert.ok(backdrop.classList.contains("trellis-splash-backdrop")); // NEW
    assert.ok(backdrop.classList.contains("trellis-splash-has-image")); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-top"), "98px"); // CHANGE
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-center-x"), "768px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-center-y"), "457px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "603.12px"); // NEW
    assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false); // NEW
    assert.equal(requests[0].action, "getTrellisSplashBackground"); // NEW
    assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /garden%20view\.webp/); // NEW
    assert.match(backdrop.querySelector(".trellis-splash-bg-image").getAttribute("src"), /garden%20view\.webp/); // NEW
    assert.equal(closeButton.getAttribute("aria-label"), "Continue with a blank diagram"); // NEW
}); // NEW

test("Trellis splash eats percentage margins before compact mode and removes its resize listener", () => { // CHANGE
	const { dom, dialog, context, editorUi } = loadSplashDialog({ savedRecord: makeSavedRecord() }); // NEW
	const outerContainer = dom.window.document.createElement("div"); // NEW
	const backdrop = dom.window.document.createElement("div"); // NEW
	let bounds = { left: 0, top: 98, width: 1536, height: 718 }; // NEW
	let boundsReads = 0; // NEW
	let closeCalls = 0; // NEW
	editorUi.diagramContainer = { // NEW
		getBoundingClientRect() { // NEW
			boundsReads++; // NEW
			return bounds; // NEW
		} // NEW
	}; // NEW
	const outerDialog = { // NEW
		container: outerContainer, // NEW
		bg: backdrop, // NEW
		close() { closeCalls++; } // NEW
	}; // NEW

	context.window.TrellisSplashEnhancements.decorateOuterDialog(editorUi, dialog, outerDialog); // NEW
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "603.12px"); // NEW

	bounds = { left: 0, top: 98, width: 1536, height: 688 }; // NEW
	dom.window.dispatchEvent(new dom.window.Event("resize")); // NEW
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false); // CHANGE
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "600px"); // NEW

	bounds = { left: 10, top: 110, width: 900, height: 700 }; // NEW
	dom.window.dispatchEvent(new dom.window.Event("resize")); // NEW
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-left"), "10px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-height"), "700px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "600px"); // NEW

	bounds = { left: 10, top: 110, width: 820, height: 700 }; // NEW
	dom.window.dispatchEvent(new dom.window.Event("resize")); // NEW
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), true); // CHANGE
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "820px"); // NEW
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "700px"); // NEW

	outerDialog.close(); // NEW
	const readsAfterClose = boundsReads; // NEW
	bounds = { left: 0, top: 98, width: 600, height: 500 }; // NEW
	dom.window.dispatchEvent(new dom.window.Event("resize")); // NEW
	assert.equal(boundsReads, readsAfterClose); // NEW
	assert.equal(closeCalls, 1); // NEW
}); // NEW

test("Trellis splash rejects unsafe background filenames and keeps the gradient fallback", () => { // NEW
    const { dom, dialog, context, editorUi } = loadSplashDialog(); // NEW
    const outerContainer = dom.window.document.createElement("div"); // NEW
    const backdrop = dom.window.document.createElement("div"); // NEW
    const closeButton = dom.window.document.createElement("div"); // NEW
    closeButton.className = "geButton"; // NEW
    outerContainer.appendChild(closeButton); // NEW
    context.electron = { request(payload, callback) { callback("../outside.png"); } }; // NEW

    context.window.TrellisSplashEnhancements.decorateOuterDialog( // NEW
        editorUi, dialog, { container: outerContainer, bg: backdrop }); // NEW

    assert.equal(backdrop.style.getPropertyValue("--trellis-splash-image"), ""); // NEW
    assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false); // NEW
    assert.equal(closeButton.getAttribute("aria-label"), "Exit Trellis Studio"); // NEW
}); // NEW

test("Trellis splash tries the packaged default before Electron selection", () => { // NEW
	const { dom, dialog, context, editorUi } = loadSplashDialog(); // NEW
	const outerContainer = dom.window.document.createElement("div"); // NEW
	const backdrop = dom.window.document.createElement("div"); // NEW
	const requestedSources = []; // NEW
	context.electron = { request(payload, callback) { callback(null); } }; // NEW
	dom.window.Image = class { // NEW
		set src(value) { // NEW
			requestedSources.push(value); // NEW
			this.onload(); // NEW
		} // NEW
	}; // NEW

	context.window.TrellisSplashEnhancements.decorateOuterDialog( // NEW
		editorUi, dialog, { container: outerContainer, bg: backdrop }); // NEW

	assert.deepEqual(requestedSources, ["images/trellis-splash/trellis-garden-sunrise.png"]); // NEW
	assert.ok(backdrop.classList.contains("trellis-splash-has-image")); // NEW
	assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /trellis-garden-sunrise\.png/); // NEW
	assert.match(backdrop.querySelector(".trellis-splash-bg-image").getAttribute("src"), /trellis-garden-sunrise\.png/); // NEW
}); // NEW

test("Trellis splash handles image load failures without setting the background", () => { // CHANGE
	const { dom, dialog, context, editorUi } = loadSplashDialog(); // NEW
	const outerContainer = dom.window.document.createElement("div"); // NEW
	const backdrop = dom.window.document.createElement("div"); // NEW
	dom.window.Image = class { // NEW
		set src(_value) { // NEW
			this.onerror({ type: "error" }); // NEW
		} // NEW
	}; // NEW

	context.window.TrellisSplashEnhancements.decorateOuterDialog( // NEW
		editorUi, dialog, { container: outerContainer, bg: backdrop }); // NEW

	assert.equal(backdrop.style.getPropertyValue("--trellis-splash-image"), ""); // NEW
	assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false); // NEW
	assert.equal(backdrop.querySelector(".trellis-splash-bg-image"), null); // NEW
}); // NEW

test("Trellis splash assets and bootstrap wire the same enhancement into packaged runtime", () => { // NEW
    const enhancementSource = fs.readFileSync(enhancementPath, "utf8"); // NEW
    const splashCss = fs.readFileSync(splashCssPath, "utf8"); // NEW
    const bootstrapSource = fs.readFileSync(bootstrapPath, "utf8"); // NEW
    const indexSource = fs.readFileSync(indexPath, "utf8"); // NEW
    const electronSource = fs.readFileSync(electronPath, "utf8"); // NEW
    const enhancementIndex = indexSource.indexOf('src="js/trellis-splash.js"'); // NEW
    const bootstrapIndex = indexSource.indexOf('src="js/bootstrap.js"'); // NEW

	assert.match(enhancementSource, /Build systems that grow/); // NEW
	assert.match(enhancementSource, /getTrellisSplashBackground/); // NEW
	assert.match(splashCss, /trellis-splash-dialog\.trellis-splash-compact/); // CHANGE
	assert.match(splashCss, /trellis-splash-backdrop::before/); // CHANGE
	assert.match(splashCss, /\.trellis-splash-bg-image/); // NEW
	assert.match(splashCss, /object-fit: cover/); // NEW
	assert.match(splashCss, /\.trellis-splash-tagline[\s\S]*text-align: center/); // NEW
	assert.match(splashCss, /width: var\(--trellis-workspace-width, 100%\)/); // CHANGE
	assert.match(enhancementSource, /trellis-splash-bg-image/); // NEW
	assert.doesNotMatch(splashCss, /max-height: 820px/); // NEW
	assert.match(splashCss, /top: var\(--trellis-workspace-top/); // NEW
	assert.match(splashCss, /height: var\(--trellis-splash-dialog-height, 690px\) !important/); // CHANGE
	assert.match(splashCss, /trellis-license-status::after/); // NEW
    assert.match(splashCss, /#fbf8ed/); // NEW
    assert.match(indexSource, /styles\/trellis-splash\.css/); // NEW
    assert.ok(enhancementIndex >= 0 && enhancementIndex < bootstrapIndex); // NEW
    assert.match(bootstrapSource, /TrellisSplashEnhancements\.install\(\)/); // NEW
    assert.match(electronSource, /case 'getTrellisSplashBackground': \/\/ NEW/); // NEW
}); // NEW
