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
const enhancementPath = path.join(projectRoot, "drawio/src/main/webapp/js/trellis-splash.js");
const splashCssPath = path.join(projectRoot, "drawio/src/main/webapp/styles/trellis-splash.css");
const bootstrapPath = path.join(projectRoot, "drawio/src/main/webapp/js/bootstrap.js");
const indexPath = path.join(projectRoot, "drawio/src/main/webapp/index.html");
const electronPath = path.join(projectRoot, "src/main/electron.js");
const wizardStorageKey = "trellis.licenseWizard.v2";
const avatarStorageKey = "trellis.splash.avatar.v1";

function loadSplashDialog(options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.test/" });
    const timers = [];
    const alerts = [];

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

    if (options.avatarRecord) {
        dom.window.localStorage.setItem(avatarStorageKey, JSON.stringify(options.avatarRecord));
    }

    if (options.oldChoice) {
        dom.window.localStorage.setItem("trellis.licenseNotice.v1", JSON.stringify({ choice: options.oldChoice, version: "1" }));
    }

    dom.window.alert = function (message) {
        alerts.push(String(message));
    };

    let helpCalls = 0;
    const actions = {
        new: { funct() {} },
        open: { funct() {} }
    };

    if (options.helpAction) {
        actions.trellisUpdatesLinks = { funct() { helpCalls++; } };
    }
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
        mxImage: function (src, width, height) {
            return { src, width, height };
        },
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
            if (!options.languageControl) return null;
            const language = dom.window.document.createElement("div");
            language.className = "geAdaptiveAsset";
            root.appendChild(language);
            return language;
        },
        actions: {
            get(id) {
                return actions[id];
            }
        },
        hideDialog() {},
        openLink() {}
    };
    vm.runInNewContext(fs.readFileSync(enhancementPath, "utf8"), context, { filename: enhancementPath });
    context.window.TrellisSplashEnhancements.install();
    const dialog = new context.SplashDialog(editorUi);
    return { dom, dialog, timers, context, editorUi, getHelpCalls: () => helpCalls, getAlerts: () => alerts };
}

function findButton(root, label) {
    return Array.from(root.querySelectorAll("button")).find((button) => button.textContent.includes(label));
}

function setInputValue(dom, input, value) {
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function openOath(dialog, pathLabel = "Personal / Noncommercial") {
    const continueButton = findButton(dialog.container, "Continue to License");
    if (continueButton) continueButton.click();
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

function makeAvatarRecord(overrides = {}) {
    return {
        version: "1",
        dataUrl: "data:image/png;base64,avatar",
        mimeType: "image/png",
        updatedAt: "2026-08-10T00:00:00.000Z",
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
        calls.showDialog = { container, width, height, modal, closable, closeCallback, noScroll, transparent, minSize, ignoreBgClick };
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
    setInputValue(dom, inputs[0], "Test User");
    setInputValue(dom, inputs[1], "test@example.com");
    setInputValue(dom, inputs[2], "Test Project");
    setInputValue(dom, inputs[3], "Test User");
    inputs[4].checked = true;

    findButton(dialog.container, "I Affirm the Oath").click();
}

test("SplashDialog renders the personal project intro before license selection", () => {
    const { dialog, timers } = loadSplashDialog();
    const text = dialog.container.textContent;

    assert.match(text, /Hello, I am Benjamin/);
    assert.match(text, /Trellis is a name pun/);
    assert.match(text, /Mystery Lawn/);
    assert.match(text, /LifeCycler/);
    assert.match(text, /Trellis Studio/);
    assert.match(text, /Commercial collaboration, issue reports, testing notes, gardening data, and feedback/);
    assert.ok(findButton(dialog.container, "Continue to License"));
    assert.equal(dialog.container.querySelector(".trellis-splash-actions").style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(timers.length, 0);
});

test("SplashDialog routes from project intro to usage wizard", () => {
    const { dialog } = loadSplashDialog();

    findButton(dialog.container, "Continue to License").click();

    assert.match(dialog.container.textContent, /Choose your path/);
    assert.match(dialog.container.textContent, /Personal \/ Noncommercial/);
    assert.match(dialog.container.textContent, /Education \/ Nonprofit \/ Public-interest/);
    assert.match(dialog.container.textContent, /Commercial \/ Client \/ Company/);
    assert.match(dialog.container.textContent, /Not sure/);
});

test("Commercial path shows contact guidance and the Grand Oath gate", () => {
    const { dialog } = loadSplashDialog();

    findButton(dialog.container, "Continue to License").click();
    findButton(dialog.container, "Commercial / Client / Company").click();

    assert.ok(dialog.container.querySelector(".trellis-license-contact-panel"));
    assert.ok(dialog.container.querySelector(".trellis-license-card"));
    assert.ok(dialog.container.querySelector(".trellis-support-card"));
    assert.match(dialog.container.textContent, /Selected path/);
    assert.match(dialog.container.textContent, /Support & contact/);
    assert.equal(dialog.container.querySelector(".trellis-support-card .trellis-card-heading").textContent, "Support & contact");
    assert.equal(dialog.container.querySelectorAll(".trellis-contact-row").length, 3);
    assert.ok(dialog.container.querySelector(".trellis-contact-row-email .trellis-contact-icon-email"));
    assert.ok(dialog.container.querySelector(".trellis-contact-row-phone .trellis-contact-icon-phone"));
    assert.ok(dialog.container.querySelector(".trellis-contact-row-github .trellis-contact-icon-github"));
    assert.match(dialog.container.textContent, /People should have access to tools that increase shared regenerative capacity/);
    assert.match(dialog.container.querySelector(".trellis-license-agreement-preview").textContent, /We, \[Organization\], agree that people should have access to tools that increase shared regenerative capacity/);
    assert.doesNotMatch(dialog.container.textContent, /I agree that people should have access to tools that increase shared regenerative capacity/);
    assert.match(dialog.container.textContent, /Written approval is still required before commercial use of Trellis plugin files\./);
    assert.doesNotMatch(dialog.container.querySelector(".trellis-contact-column").textContent, /Patreon/i);
    assert.match(dialog.container.querySelector(".trellis-contact-column").textContent, /GitHub: Issues and feedback/);
    assert.match(dialog.container.textContent, /The Grand Oath of Paying Attention/);
    assert.ok(findButton(dialog.container, "Play Oath Aloud"));
    assert.ok(findButton(dialog.container, "Skip the Oath"));
    assert.ok(findButton(dialog.container, "I Affirm the Oath"));
    assert.ok(findButton(dialog.container, "Change license"));
    assert.equal(findButton(dialog.container, "Change answer"), undefined);
});

test("Nonprofit path shows the short obligation copy before oath completion", () => {
    const { dialog } = loadSplashDialog();

    findButton(dialog.container, "Continue to License").click();
    findButton(dialog.container, "Education / Nonprofit / Public-interest").click();

    assert.ok(dialog.container.querySelector(".trellis-license-contact-panel"));
    assert.ok(dialog.container.querySelector(".trellis-license-card"));
    assert.ok(dialog.container.querySelector(".trellis-support-card"));
    assert.equal(dialog.container.querySelector(".trellis-license-card .trellis-card-heading").textContent, "Selected path");
    assert.equal(dialog.container.querySelector(".trellis-license-obligation-italic").textContent, "People should have access to tools that increase shared regenerative capacity.");
    assert.match(dialog.container.querySelector(".trellis-license-obligation").textContent, /Written approval is required before commercial use of Trellis plugin files\./);
    assert.doesNotMatch(dialog.container.querySelector(".trellis-license-obligation").textContent, /still required/);
    assert.doesNotMatch(dialog.container.querySelector(".trellis-contact-column").textContent, /Patreon/i);
});

test("Skip oath decoy evades pointer proximity only before gate completion", () => {
    const { dom, dialog } = loadSplashDialog();
    openOath(dialog);
    const skipButton = findButton(dialog.container, "Skip the Oath");
    const gateSection = skipButton.parentNode.parentNode;

    setAffirmButtonRect(skipButton);
    dispatchMouseMove(dom, gateSection, 400, 400);
    assert.equal(skipButton.style.transform, "");

    dispatchMouseMove(dom, gateSection, 90, 120);
    assert.equal(skipButton.style.transform, "translate(90px,18px)");

    findButton(dialog.container, "Play Oath Aloud").click();
    assert.equal(skipButton.style.display, "none");
    findButton(dialog.container, "Play Oath Aloud").click();
    findButton(dialog.container, "Play Oath Aloud").click();
    findButton(dialog.container, "Manual audio override").click();
    const inputs = dialog.container.querySelectorAll("input");
    inputs[0].value = "Test User";
    inputs[1].value = "test@example.com";
    inputs[3].value = "Test User";
    inputs[4].checked = true;

    assert.equal(skipButton.style.transform, "translate(0,0)");
    dispatchMouseMove(dom, gateSection, 90, 120);
    assert.equal(skipButton.style.transform, "translate(0,0)");
});

test("Skip oath decoy caps non-pointer evasions before the oath is ready", () => {
    const { dom, dialog } = loadSplashDialog();
    openOath(dialog);
    const skipButton = findButton(dialog.container, "Skip the Oath");

    skipButton.dispatchEvent(new dom.window.Event("focus", { bubbles: false, cancelable: true }));
    assert.equal(skipButton.style.transform, "translate(90px,18px)");

    skipButton.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
    assert.equal(skipButton.style.transform, "translate(-90px,-18px)");

    skipButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        keyCode: 13
    }));
    const cappedTransform = skipButton.style.transform;
    assert.equal(cappedTransform, "translate(90px,18px)");

    skipButton.click();
    skipButton.click();

    assert.equal(skipButton.style.transform, cappedTransform);
    assert.match(dialog.container.textContent, /out of hiding places/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
});

test("Real affirm button stays put and reports missing oath requirements", () => {
    const { dialog } = loadSplashDialog();
    const affirmButton = openOath(dialog);

    affirmButton.click();

    assert.equal(affirmButton.style.transform, "");
    assert.match(dialog.container.textContent, /The oath has to be heard before affirming/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
});

test("Oath agreement preview personalizes individual and commercial paths", () => {
    const personal = loadSplashDialog();
    openOath(personal.dialog);
    let inputs = personal.dialog.container.querySelectorAll("input");

    setInputValue(personal.dom, inputs[0], "Test User");
    assert.match(personal.dialog.container.querySelector(".trellis-license-agreement-preview").textContent, /I, Test User, agree that people should have access to tools that increase shared regenerative capacity/);

    const commercial = loadSplashDialog();
    openOath(commercial.dialog, "Commercial / Client / Company");
    inputs = commercial.dialog.container.querySelectorAll("input");

    setInputValue(commercial.dom, inputs[2], "Test Project");
    assert.match(commercial.dialog.container.querySelector(".trellis-license-agreement-preview").textContent, /We, Test Project, agree that people should have access to tools that increase shared regenerative capacity/);
});

test("Commercial oath requires organization before affirmation", () => {
    const { dom, dialog } = loadSplashDialog();

    openOath(dialog, "Commercial / Client / Company");
    const playButton = findButton(dialog.container, "Play Oath Aloud");
    playButton.click();
    playButton.click();
    playButton.click();
    findButton(dialog.container, "Manual audio override").click();

    const inputs = dialog.container.querySelectorAll("input");
    setInputValue(dom, inputs[0], "Test User");
    setInputValue(dom, inputs[1], "test@example.com");
    setInputValue(dom, inputs[3], "Test User");
    inputs[4].checked = true;

    findButton(dialog.container, "I Affirm the Oath").click();
    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null);
    assert.match(dialog.container.textContent, /Enter an organization name for commercial use before affirming/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);

    setInputValue(dom, inputs[2], "Test Project");
    assert.match(dialog.container.querySelector(".trellis-license-agreement-preview").textContent, /We, Test Project, agree/);
    findButton(dialog.container, "I Affirm the Oath").click();
    assert.equal(JSON.parse(dom.window.localStorage.getItem(wizardStorageKey)).organization, "Test Project");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
});

test("Oath completion stores the wizard record and reveals actions after two seconds", () => {
    const { dom, dialog, timers } = loadSplashDialog();
    const actions = dialog.container.querySelector(".trellis-splash-actions");

    findButton(dialog.container, "Continue to License").click();
    findButton(dialog.container, "Commercial / Client / Company").click();
    completeVisibleOath(dom, dialog);

    const record = JSON.parse(dom.window.localStorage.getItem(wizardStorageKey));
    assert.equal(record.path, "commercial");
    assert.equal(record.contactGuidance, true);
    assert.equal(record.name, "Test User");
    assert.equal(record.email, "test@example.com");
    assert.equal(record.organization, "Test Project");
    assert.equal(record.signature, "Test User");
    assert.equal(record.version, "2");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.match(dialog.container.textContent, /License/);
    assert.doesNotMatch(dialog.container.textContent, /The Grand Oath of Paying Attention/);
    assert.equal(actions.style.display, "none");
	const status = dialog.container.querySelector(".trellis-license-status");
	assert.equal(status.textContent, "Diagram options will be ready shortly.");
    assert.equal(timers.at(-1).delay, 2000);

    timers.at(-1).callback();
    assert.equal(actions.style.display, "");
	assert.equal(status.style.display, "none");
	assert.equal(status.textContent, "");
    assert.doesNotMatch(dialog.container.textContent, /Diagram options are ready/);
});

test("New oath records require a complete email without invalidating legacy records", () => {
    const legacy = loadSplashDialog({
        savedRecord: makeSavedRecord({ email: "Barneywilson@gmail." })
    });
    assert.equal(legacy.dialog.isTrellisLicenseWizardComplete(), true);
    assert.match(legacy.dialog.container.textContent, /Barneywilson@gmail\./);

    const { dom, dialog } = loadSplashDialog();
    openOath(dialog);
    const playButton = findButton(dialog.container, "Play Oath Aloud");
    playButton.click();
    playButton.click();
    playButton.click();
    findButton(dialog.container, "Manual audio override").click();
    const inputs = dialog.container.querySelectorAll("input");
    inputs[0].value = "New User";
    inputs[1].value = "new@example.";
    inputs[3].value = "New User";
    inputs[4].checked = true;
    findButton(dialog.container, "I Affirm the Oath").click();

    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null);
    assert.match(dialog.container.textContent, /Enter a complete email address/);
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);

    inputs[1].value = "new@example.com";
    findButton(dialog.container, "I Affirm the Oath").click();
    assert.equal(JSON.parse(dom.window.localStorage.getItem(wizardStorageKey)).email, "new@example.com");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
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

    assert.match(dialog.container.textContent, /License/);
    assert.ok(dialog.container.querySelector(".trellis-license-contact-panel"));
    assert.ok(dialog.container.querySelector(".trellis-license-card"));
    assert.ok(dialog.container.querySelector(".trellis-support-card"));
    assert.equal(dialog.container.querySelector(".trellis-license-card .trellis-card-heading").textContent, "License");
    assert.equal(dialog.container.querySelector(".trellis-support-card .trellis-card-heading").textContent, "Support & contact");
    assert.equal(dialog.container.querySelectorAll(".trellis-contact-row").length, 3);
    assert.equal(dialog.container.querySelector(".trellis-license-completed-agreement"), null);
    assert.match(dialog.container.querySelector(".trellis-license-obligation").textContent, /We, \[Organization\], agree that people should have access to tools that increase shared regenerative capacity/);
    assert.match(dialog.container.textContent, /Written approval is still required before commercial use of Trellis plugin files\./);
    assert.doesNotMatch(dialog.container.querySelector(".trellis-contact-column").textContent, /Patreon/i);
    assert.doesNotMatch(dialog.container.textContent, /License oath completed/);
    assert.doesNotMatch(dialog.container.textContent, /Diagram options are ready/);
    const status = dialog.container.querySelector(".trellis-license-status");
    assert.equal(status.textContent, "Diagram options will be ready shortly.");
    assert.equal(status.style.display, "");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.equal(actions.style.display, "none");
    assert.equal(timers[0].delay, 2000);

    timers[0].callback();
    assert.equal(actions.style.display, "");
    assert.equal(status.style.display, "none");
    assert.equal(status.textContent, "");
    assert.doesNotMatch(dialog.container.textContent, /Diagram options are ready/);

    findButton(dialog.container, "Change license").click();
    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null);
    assert.match(dialog.container.textContent, /Hello, I am Benjamin/);
    assert.equal(actions.style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
});

test("Incomplete or corrupt saved wizard records are ignored", () => {
    const missingSignature = loadSplashDialog({
        savedRecord: makeSavedRecord({ signature: "" })
    });
    assert.match(missingSignature.dialog.container.textContent, /Hello, I am Benjamin/);
    assert.equal(missingSignature.dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(missingSignature.timers.length, 0);

    const mismatchedGuidance = loadSplashDialog({
        savedRecord: makeSavedRecord({ path: "commercial", contactGuidance: false })
    });
    assert.match(mismatchedGuidance.dialog.container.textContent, /Hello, I am Benjamin/);
    assert.equal(mismatchedGuidance.dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(mismatchedGuidance.timers.length, 0);
});

test("Saved commercial wizard records show the completed organization agreement", () => {
    const { dialog } = loadSplashDialog({
        savedRecord: makeSavedRecord({
            path: "commercial",
            contactGuidance: true,
            organization: "Saved Org"
        })
    });

    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.equal(dialog.container.querySelector(".trellis-license-completed-agreement"), null);
    assert.match(dialog.container.querySelector(".trellis-license-obligation").textContent, /We, Saved Org, agree that people should have access to tools that increase shared regenerative capacity/);
    assert.match(dialog.container.textContent, /Signed by Saved User using saved@example\.com\. Project: Saved Org\./);
});

test("SplashDialog ignores old v1 license acknowledgements", () => {
    const { dialog, timers } = loadSplashDialog({ oldChoice: "community" });

    assert.match(dialog.container.textContent, /Hello, I am Benjamin/);
    assert.equal(dialog.container.querySelector(".trellis-splash-actions").style.display, "none");
    assert.equal(dialog.isTrellisLicenseWizardComplete(), false);
    assert.equal(timers.length, 0);
});

test("Incomplete splash dismissal requests exit and does not create a blank diagram", () => {
    const { calls } = loadShowSplashHarness({ complete: false });
    const result = calls.showDialog.closeCallback(true, false);

    assert.equal(calls.showDialog.ignoreBgClick, true);
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

    assert.equal(calls.showDialog.ignoreBgClick, true);
    assert.equal(result, undefined);
    assert.equal(calls.exitRequests.length, 0);
    assert.equal(calls.exitMessages, 0);
    assert.equal(calls.createFile.length, 1);
    assert.equal(calls.createFile[0][0], "Untitled Diagram.drawio");
    assert.equal(context.Editor.useLocalStorage, true);
});

test("SplashDialog source and bundle use oath wizard storage, close hook, validation, and card dimensions", () => {
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
    assert.match(dialogSource, /isTrellisNewEmailValid/);
    assert.match(dialogSource, /pointerRunawayDistance = 120/);
    assert.match(dialogSource, /Hello, I am Benjamin/);
    assert.match(dialogSource, /Mystery Lawn/);
    assert.match(dialogSource, /LifeCycler/);
    assert.match(dialogSource, /Skip the Oath/);
    assert.match(dialogSource, /Organization \/ Project \(optional\)/);
    assert.match(dialogSource, /I Affirm the Oath/);
    assert.doesNotMatch(dialogSource, /License oath completed/);
    assert.doesNotMatch(dialogSource, /Diagram options are ready/);
    assert.match(dialogSource, /Diagram options will be ready shortly/);
    assert.match(dialogSource, /createTrellisLicenseSupportLayout/);
    assert.match(dialogSource, /trellisCommunityObligationItalicText/);
    assert.match(dialogSource, /Explore & Support My Projects/);
    assert.match(dialogSource, /https:\/\/patreon\.com\/Benjamin980/);
    assert.doesNotMatch(dialogSource, /Placeholder Contact Name|patreon: 'https:\/\/www\.patreon\.com\/placeholder'|appendTrellisContactGuidance|Support on Patreon|Support: Patreon/);
    assert.match(appSource, /showDialog\(dlg\.container, 700, 630[\s\S]*true, null, null, true/);
    assert.match(appSource, /showTrellisExitMessage/);
    assert.match(bundledSource, /trellis\.licenseWizard\.v/);
    assert.ok(bundledBindingIndex >= 0);
    assert.ok(bundledHookIndex > bundledBindingIndex);
    assert.match(bundledSource, /isTrellisLicenseWizardComplete/);
    assert.match(bundledSource, /isTrellisWizardRecordValid/);
    assert.match(bundledSource, /isTrellisNewEmailValid/);
    assert.match(bundledSource, /pointerRunawayDistance = 120/);
    assert.match(bundledSource, /Hello, I am Benjamin/);
    assert.match(bundledSource, /Mystery Lawn/);
    assert.match(bundledSource, /LifeCycler/);
    assert.match(bundledSource, /Skip the Oath/);
    assert.match(bundledSource, /Organization \/ Project \(optional\)/);
    assert.doesNotMatch(bundledSource, /License oath completed/);
    assert.doesNotMatch(bundledSource, /Diagram options are ready/);
    assert.match(bundledSource, /Diagram options will be ready shortly/);
    assert.match(bundledSource, /createTrellisLicenseSupportLayout/);
    assert.match(bundledSource, /trellisCommunityObligationItalicText/);
    assert.match(bundledSource, /Explore & Support My Projects/);
    assert.match(bundledSource, /https:\/\/patreon\.com\/Benjamin980/);
    assert.doesNotMatch(bundledSource, /Placeholder Contact Name|patreon: 'https:\/\/www\.patreon\.com\/placeholder'|appendTrellisContactGuidance|Support on Patreon|Support: Patreon/);
    assert.match(bundledSource, /showDialog\(p\.container,700,630[\s\S]*!0,null,null,!0/);
});

test("Trellis splash enhancement adds the branded shell, saved-state structure, and actions without the Help row", () => {
    const { dom, dialog, getHelpCalls } = loadSplashDialog({
		savedRecord: makeSavedRecord({ email: "Barneywilson@gmail." }),
        helpAction: true,
        languageControl: true
    });
    const createButton = findButton(dialog.container, "Create New Garden");
    const supportButton = findButton(dialog.container, "Explore & Support My Projects");
    const openButton = findButton(dialog.container, "Open Existing Garden");
    const helpButton = findButton(dialog.container, "Help");

    assert.ok(dialog.container.classList.contains("trellis-splash-root"));
    assert.equal(dialog.container.querySelector(".geAdaptiveAsset"), null);
    assert.ok(dialog.container.querySelector(".trellis-splash-identity"));
    assert.ok(dialog.container.querySelector(".trellis-splash-brand-mark"));
    assert.equal(dialog.container.querySelector(".trellis-splash-title").textContent, "Trellis Studio");
    assert.equal(dialog.container.querySelector(".trellis-splash-tagline").textContent, "Build systems that grow.");
	assert.ok(dialog.container.querySelector(".trellis-splash-tagline").compareDocumentPosition(dialog.container.querySelector(".trellis-saved-license-card")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
	assert.match(dialog.container.textContent, /License/);
	assert.match(dialog.container.textContent, /Saved User/);
	assert.match(dialog.container.textContent, /Barneywilson@gmail\./);
	assert.ok(dialog.container.classList.contains("trellis-saved-state"));
	assert.equal(dialog.container.querySelector(".trellis-splash-state-intro"), null);
	assert.equal(dialog.container.querySelector(".trellis-saved-license-path").textContent, "Path: Personal / Noncommercial.");
	assert.equal(dialog.container.querySelector(".trellis-saved-license-signer").textContent, "Signed by Saved User using Barneywilson@gmail.");
    assert.equal(dialog.container.querySelector(".trellis-license-completed-agreement"), null);
    assert.equal(dialog.container.querySelector(".trellis-license-obligation-italic"), null);
    assert.match(dialog.container.querySelector(".trellis-license-obligation").textContent, /I, Saved User, agree that people should have access to tools that increase shared regenerative capacity/);
    assert.match(dialog.container.querySelector(".trellis-license-obligation").textContent, /Written approval is still required before commercial use of Trellis plugin files\./);
    const avatarControl = dialog.container.querySelector(".trellis-saved-license-card .trellis-avatar-control");
    assert.ok(avatarControl);
    assert.ok(avatarControl.classList.contains("trellis-license-icon"));
    assert.equal(avatarControl.getAttribute("aria-label"), "Set avatar");
    assert.equal(dialog.container.querySelector(".trellis-avatar-image"), null);
    assert.equal(dialog.container.querySelector(".trellis-avatar-remove").hidden, true);
    assert.equal(dialog.container.querySelector(".trellis-license-card .trellis-card-heading").textContent, "License");
    assert.equal(dialog.container.querySelector(".trellis-support-card .trellis-card-heading").textContent, "Support & contact");
    assert.equal(dialog.container.querySelectorAll(".trellis-contact-row").length, 3);
    assert.equal(dialog.container.querySelector(".trellis-contact-row-email .trellis-contact-row-text").textContent, "Benjaminyelon@gmail.com");
    assert.equal(dialog.container.querySelector(".trellis-contact-row-phone .trellis-contact-row-text").textContent, "+1 (236) 878 7411");
    assert.equal(dialog.container.querySelector(".trellis-contact-row-github .trellis-contact-row-text").textContent, "GitHub: Issues and feedback");
    assert.ok(dialog.container.querySelector(".trellis-contact-row-email .trellis-contact-icon-email"));
    assert.ok(dialog.container.querySelector(".trellis-contact-row-phone .trellis-contact-icon-phone"));
    assert.ok(dialog.container.querySelector(".trellis-contact-row-github .trellis-contact-icon-github"));
    const changeButton = dialog.container.querySelector(".trellis-saved-license-card > .geBtn");
    assert.ok(changeButton);
    assert.ok(dialog.container.querySelector(".trellis-saved-license-copy").compareDocumentPosition(changeButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(supportButton.classList.contains("trellis-support-action"));
    assert.equal(supportButton.classList.contains("trellis-button-open"), false);
    assert.equal(supportButton.getAttribute("data-trellis-url"), "https://patreon.com/Benjamin980?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink");
    assert.ok(createButton.classList.contains("trellis-primary-action"));
    assert.ok(createButton.classList.contains("trellis-button-add"));
    assert.ok(openButton.classList.contains("trellis-secondary-action"));
    assert.ok(openButton.classList.contains("trellis-button-open"));
    assert.ok(createButton.compareDocumentPosition(openButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(openButton.compareDocumentPosition(supportButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(supportButton.querySelector("svg"));
    assert.ok(createButton.querySelector("svg"));
    assert.ok(openButton.querySelector("svg"));
    assert.equal(helpButton, undefined);
    assert.equal(dialog.container.querySelector(".trellis-splash-footer"), null);
    assert.equal(getHelpCalls(), 0);
    assert.doesNotMatch(dialog.container.textContent, /Settings|Language/);
});

test("Trellis splash renders a saved local avatar without changing license state", () => {
    const { dom, dialog } = loadSplashDialog({
        savedRecord: makeSavedRecord(),
        avatarRecord: makeAvatarRecord()
    });
    const avatarControl = dialog.container.querySelector(".trellis-avatar-control");
    const avatarImage = dialog.container.querySelector(".trellis-avatar-image");
    const removeButton = dialog.container.querySelector(".trellis-avatar-remove");

    assert.equal(dialog.isTrellisLicenseWizardComplete(), true);
    assert.equal(avatarControl.getAttribute("aria-label"), "Change avatar");
    assert.equal(avatarImage.getAttribute("src"), "data:image/png;base64,avatar");
    assert.equal(removeButton.hidden, false);

    findButton(dialog.container, "Change license").click();
    assert.equal(dom.window.localStorage.getItem(wizardStorageKey), null);
    assert.equal(JSON.parse(dom.window.localStorage.getItem(avatarStorageKey)).dataUrl, "data:image/png;base64,avatar");
});

test("Trellis splash ignores corrupt local avatar data", () => {
    const { dom, dialog } = loadSplashDialog({
        savedRecord: makeSavedRecord(),
        avatarRecord: { version: "1", dataUrl: "javascript:alert(1)", mimeType: "image/png" }
    });
    const avatarControl = dialog.container.querySelector(".trellis-avatar-control");
    const removeButton = dialog.container.querySelector(".trellis-avatar-remove");

    assert.equal(dom.window.localStorage.getItem(avatarStorageKey), JSON.stringify({ version: "1", dataUrl: "javascript:alert(1)", mimeType: "image/png" }));
    assert.equal(avatarControl.getAttribute("aria-label"), "Set avatar");
    assert.equal(dialog.container.querySelector(".trellis-avatar-image"), null);
    assert.equal(removeButton.hidden, true);
});

test("Trellis splash remove avatar control clears local avatar storage", () => {
    const { dom, dialog } = loadSplashDialog({
        savedRecord: makeSavedRecord(),
        avatarRecord: makeAvatarRecord()
    });
    const removeButton = dialog.container.querySelector(".trellis-avatar-remove");

    removeButton.click();

    assert.equal(dom.window.localStorage.getItem(avatarStorageKey), null);
    assert.equal(dialog.container.querySelector(".trellis-avatar-control").getAttribute("aria-label"), "Set avatar");
    assert.equal(dialog.container.querySelector(".trellis-avatar-image"), null);
    assert.equal(removeButton.hidden, true);
});

test("Trellis splash avatar click opens an image file picker", () => {
    const { dialog } = loadSplashDialog({ savedRecord: makeSavedRecord() });
    const avatarControl = dialog.container.querySelector(".trellis-avatar-control");
    let pickerClicks = 0;

    avatarControl.click();
    avatarControl.trellisAvatarInput.click = function () {
        pickerClicks++;
    };
    avatarControl.click();

    assert.equal(pickerClicks, 1);
    assert.equal(avatarControl.trellisAvatarInput.type, "file");
    assert.equal(avatarControl.trellisAvatarInput.accept, "image/png,image/jpeg,image/webp");
});

test("Trellis splash avatar upload crops, stores, and renders the compact image", () => {
    const { dom, dialog, getAlerts } = loadSplashDialog({ savedRecord: makeSavedRecord() });
    const avatarControl = dialog.container.querySelector(".trellis-avatar-control");
    const originalCreateElement = dom.window.document.createElement.bind(dom.window.document);
    const drawCalls = [];

    dom.window.FileReader = class {
        readAsDataURL(file) {
            assert.equal(file.name, "photo.jpg");
            this.onload({ target: { result: "data:image/jpeg;base64,source" } });
        }
    };
    dom.window.Image = class {
        set src(value) {
            assert.equal(value, "data:image/jpeg;base64,source");
            this.naturalWidth = 400;
            this.naturalHeight = 200;
            this.onload();
        }
    };
    dom.window.document.createElement = function (tagName) {
        if (tagName === "canvas") {
            return {
                width: 0,
                height: 0,
                getContext(type) {
                    assert.equal(type, "2d");
                    return {
                        clearRect() {},
                        drawImage(...args) {
                            drawCalls.push(args);
                        }
                    };
                },
                toDataURL(type) {
                    assert.equal(type, "image/png");
                    assert.equal(this.width, 96);
                    assert.equal(this.height, 96);
                    return "data:image/png;base64,cropped";
                }
            };
        }
        return originalCreateElement(tagName);
    };

    avatarControl.click();
    Object.defineProperty(avatarControl.trellisAvatarInput, "files", {
        configurable: true,
        value: [{ name: "photo.jpg", type: "image/jpeg", size: 1234 }]
    });
    avatarControl.trellisAvatarInput.dispatchEvent(new dom.window.Event("change"));

    const saved = JSON.parse(dom.window.localStorage.getItem(avatarStorageKey));
    assert.equal(saved.version, "1");
    assert.equal(saved.mimeType, "image/png");
    assert.equal(saved.dataUrl, "data:image/png;base64,cropped");
    assert.deepEqual(drawCalls[0].slice(1), [100, 0, 200, 200, 0, 0, 96, 96]);
    assert.equal(dialog.container.querySelector(".trellis-avatar-image").getAttribute("src"), "data:image/png;base64,cropped");
    assert.equal(dialog.container.querySelector(".trellis-avatar-remove").hidden, false);
    assert.deepEqual(getAlerts(), []);
});

test("Trellis splash outer decoration stays below app chrome and applies a validated background", () => {
    const { dom, dialog, context, editorUi } = loadSplashDialog({ savedRecord: makeSavedRecord() });
    const outerContainer = dom.window.document.createElement("div");
    const backdrop = dom.window.document.createElement("div");
    const closeButton = dom.window.document.createElement("div");
    const requests = [];

    closeButton.className = "geButton";
    outerContainer.appendChild(closeButton);
	editorUi.diagramContainer = {
		getBoundingClientRect() { return { left: 0, top: 98, width: 1536, height: 718 }; }
	};
    context.electron = {
        request(payload, callback) {
            requests.push(payload);
            callback("garden view.webp");
        }
    };
    dom.window.Image = class {
        set src(value) {
            this.loadedSource = value;
            this.onload();
        }
    };

    context.window.TrellisSplashEnhancements.decorateOuterDialog(
        editorUi, dialog, { container: outerContainer, bg: backdrop });
	const backgroundLayer = backdrop.querySelector(".trellis-splash-bg-image");
	backgroundLayer.onload();

    assert.ok(outerContainer.classList.contains("trellis-splash-dialog"));
    assert.ok(backdrop.classList.contains("trellis-splash-backdrop"));
    assert.ok(backdrop.classList.contains("trellis-splash-has-image"));
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-top"), "98px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-center-x"), "768px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-center-y"), "457px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "603.12px");
    assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false);
    assert.equal(requests[0].action, "getTrellisSplashBackground");
    assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /garden%20view\.webp/);
    assert.match(backgroundLayer.getAttribute("src"), /garden%20view\.webp/);
    assert.equal(closeButton.getAttribute("aria-label"), "Continue with a blank diagram");
});

test("Trellis splash eats percentage margins before compact mode and removes its resize listener", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog({ savedRecord: makeSavedRecord() });
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	let bounds = { left: 0, top: 98, width: 1536, height: 718 };
	let boundsReads = 0;
	let closeCalls = 0;
	editorUi.diagramContainer = {
		getBoundingClientRect() {
			boundsReads++;
			return bounds;
		}
	};
	const outerDialog = {
		container: outerContainer,
		bg: backdrop,
		close() { closeCalls++; }
	};

	context.window.TrellisSplashEnhancements.decorateOuterDialog(editorUi, dialog, outerDialog);
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false);
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "603.12px");

	bounds = { left: 0, top: 98, width: 1536, height: 1000 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false);
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "760px");

	bounds = { left: 0, top: 98, width: 1536, height: 688 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false);
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "600px");

	bounds = { left: 10, top: 110, width: 900, height: 700 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), false);
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-left"), "10px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-workspace-height"), "700px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "760px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "600px");

	bounds = { left: 10, top: 110, width: 820, height: 700 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(outerContainer.classList.contains("trellis-splash-compact"), true);
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-width"), "820px");
	assert.equal(outerContainer.style.getPropertyValue("--trellis-splash-dialog-height"), "700px");

	outerDialog.close();
	const readsAfterClose = boundsReads;
	bounds = { left: 0, top: 98, width: 600, height: 500 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(boundsReads, readsAfterClose);
	assert.equal(closeCalls, 1);
});

test("Trellis splash hides top chrome only while the splash dialog remains active", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog({ savedRecord: makeSavedRecord() });
	const splashCss = fs.readFileSync(splashCssPath, "utf8");
	const editorRoot = dom.window.document.createElement("div");
	const menubarContainer = dom.window.document.createElement("div");
	const toolbarContainer = dom.window.document.createElement("div");
	const sidebarContainer = dom.window.document.createElement("div");
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	let bounds = { left: 0, top: 98, width: 1536, height: 718 };
	let boundsReads = 0;
	let closeShouldFail = true;
	let closeCalls = 0;

	editorRoot.className = "geEditor";
	menubarContainer.className = "geMenubarContainer";
	toolbarContainer.className = "geToolbarContainer";
	sidebarContainer.className = "geSidebarContainer";
	editorRoot.appendChild(menubarContainer);
	editorRoot.appendChild(toolbarContainer);
	editorRoot.appendChild(sidebarContainer);
	editorUi.container = editorRoot;
	editorUi.diagramContainer = {
		getBoundingClientRect() {
			boundsReads++;
			return bounds;
		}
	};
	const outerDialog = {
		container: outerContainer,
		bg: backdrop,
		close() {
			closeCalls++;
			return closeShouldFail ? false : undefined;
		}
	};

	assert.match(splashCss, /\.geEditor\.trellis-splash-active > \.geMenubarContainer,\s*\.geEditor\.trellis-splash-active > \.geToolbarContainer[\s\S]*display: none !important/);
	assert.doesNotMatch(splashCss, /\.geEditor\.trellis-splash-active > \.geSidebarContainer/);

	context.window.TrellisSplashEnhancements.decorateOuterDialog(editorUi, dialog, outerDialog);
	assert.equal(editorRoot.classList.contains("trellis-splash-active"), true);
	assert.equal(outerDialog.close(), false);
	assert.equal(editorRoot.classList.contains("trellis-splash-active"), true);
	bounds = { left: 0, top: 98, width: 600, height: 500 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.ok(boundsReads > 1);

	closeShouldFail = false;
	outerDialog.close();
	const readsAfterClose = boundsReads;
	bounds = { left: 0, top: 98, width: 500, height: 400 };
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	assert.equal(editorRoot.classList.contains("trellis-splash-active"), false);
	assert.equal(boundsReads, readsAfterClose);
	assert.equal(closeCalls, 2);
});

test("Trellis splash rejects unsafe background filenames and keeps the gradient fallback", () => {
    const { dom, dialog, context, editorUi } = loadSplashDialog();
    const outerContainer = dom.window.document.createElement("div");
    const backdrop = dom.window.document.createElement("div");
    const closeButton = dom.window.document.createElement("div");
    closeButton.className = "geButton";
    outerContainer.appendChild(closeButton);
    context.electron = { request(payload, callback) { callback("../outside.png"); } };

    context.window.TrellisSplashEnhancements.decorateOuterDialog(
        editorUi, dialog, { container: outerContainer, bg: backdrop });

    assert.equal(backdrop.style.getPropertyValue("--trellis-splash-image"), "");
    assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false);
    assert.equal(closeButton.getAttribute("aria-label"), "Exit Trellis Studio");
});

test("Trellis splash tries the packaged default before Electron selection", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog();
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	const requestedSources = [];
	context.electron = { request(payload, callback) { callback(null); } };
	dom.window.Image = class {
		set src(value) {
			requestedSources.push(value);
			this.onload();
		}
	};

	context.window.TrellisSplashEnhancements.decorateOuterDialog(
		editorUi, dialog, { container: outerContainer, bg: backdrop });
	const backgroundLayer = backdrop.querySelector(".trellis-splash-bg-image");
	backgroundLayer.onload();

	assert.deepEqual(requestedSources, ["images/trellis-splash/trellis-garden-sunrise.png"]);
	assert.ok(backdrop.classList.contains("trellis-splash-has-image"));
	assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /trellis-garden-sunrise\.png/);
	assert.match(backgroundLayer.getAttribute("src"), /trellis-garden-sunrise\.png/);
});

test("Trellis splash reveals a loaded background on the next animation frame", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog();
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	const animationFrames = [];
	context.electron = { request(payload, callback) { callback(null); } };
	dom.window.requestAnimationFrame = function(callback) {
		animationFrames.push(callback);
		return animationFrames.length;
	};
	dom.window.Image = class {
		set src(_value) {
			this.onload();
		}
	};

	context.window.TrellisSplashEnhancements.decorateOuterDialog(
		editorUi, dialog, { container: outerContainer, bg: backdrop });
	const backgroundLayer = backdrop.querySelector(".trellis-splash-bg-image");

	assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /trellis-garden-sunrise\.png/);
	assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false);
	assert.match(backgroundLayer.getAttribute("src"), /trellis-garden-sunrise\.png/);
	backgroundLayer.onload();
	assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false);
	animationFrames[0]();
	assert.equal(backdrop.classList.contains("trellis-splash-has-image"), true);
});

test("Trellis splash skips duplicate pending Electron background selection", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog();
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	const images = [];
	const requestedSources = [];
	context.electron = { request(payload, callback) { callback("trellis-garden-sunrise.png"); } };
	dom.window.Image = class {
		set src(value) {
			requestedSources.push(value);
			images.push(this);
		}
	};

	context.window.TrellisSplashEnhancements.decorateOuterDialog(
		editorUi, dialog, { container: outerContainer, bg: backdrop });

	assert.deepEqual(requestedSources, ["images/trellis-splash/trellis-garden-sunrise.png"]);
	assert.equal(backdrop.style.getPropertyValue("--trellis-splash-image"), "");
	images[0].onload();
	const backgroundLayer = backdrop.querySelector(".trellis-splash-bg-image");
	backgroundLayer.onload();
	assert.ok(backdrop.classList.contains("trellis-splash-has-image"));
	assert.match(backdrop.style.getPropertyValue("--trellis-splash-image"), /trellis-garden-sunrise\.png/);
	assert.match(backgroundLayer.getAttribute("src"), /trellis-garden-sunrise\.png/);
});

test("Trellis splash handles image load failures without setting the background", () => {
	const { dom, dialog, context, editorUi } = loadSplashDialog();
	const outerContainer = dom.window.document.createElement("div");
	const backdrop = dom.window.document.createElement("div");
	dom.window.Image = class {
		set src(_value) {
			this.onerror({ type: "error" });
		}
	};

	context.window.TrellisSplashEnhancements.decorateOuterDialog(
		editorUi, dialog, { container: outerContainer, bg: backdrop });

	assert.equal(backdrop.style.getPropertyValue("--trellis-splash-image"), "");
	assert.equal(backdrop.classList.contains("trellis-splash-has-image"), false);
	assert.equal(backdrop.querySelector(".trellis-splash-bg-image").hasAttribute("src"), false);
});

test("Trellis splash assets and bootstrap wire the same enhancement into packaged runtime", () => {
    const enhancementSource = fs.readFileSync(enhancementPath, "utf8");
    const splashCss = fs.readFileSync(splashCssPath, "utf8");
    const bootstrapSource = fs.readFileSync(bootstrapPath, "utf8");
    const indexSource = fs.readFileSync(indexPath, "utf8");
    const electronSource = fs.readFileSync(electronPath, "utf8");
    const enhancementIndex = indexSource.indexOf('src="js/trellis-splash.js"');
    const bootstrapIndex = indexSource.indexOf('src="js/bootstrap.js"');

	assert.match(enhancementSource, /Build systems that grow/);
	assert.match(enhancementSource, /getTrellisSplashBackground/);
	assert.match(enhancementSource, /trellis-splash-active/);
	assert.match(enhancementSource, /trellis\.splash\.avatar\.v1/);
	assert.match(enhancementSource, /image\/png,image\/jpeg,image\/webp/);
	assert.match(enhancementSource, /drawImage\(image, cropX, cropY, cropSize, cropSize/);
	assert.match(splashCss, /trellis-splash-dialog\.trellis-splash-compact/);
	assert.match(splashCss, /\.trellis-avatar-control/);
	assert.match(splashCss, /\.trellis-avatar-remove/);
	assert.match(splashCss, /\.trellis-avatar-image[\s\S]*object-fit: cover/);
	assert.match(splashCss, /grid-template-columns: 76px minmax\(0, 1fr\)/);
	assert.match(splashCss, /grid-template-columns: 68px minmax\(0, 1fr\)/);
	assert.match(splashCss, /\.trellis-card-heading[\s\S]*color: #0d3f2d/);
	assert.match(splashCss, /\.trellis-contact-row[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\)/);
	assert.match(splashCss, /\.trellis-contact-icon-github[\s\S]*fill: #106139/);
	assert.match(splashCss, /\.trellis-splash-actions button:last-child[\s\S]*margin-bottom: 0 !important/);
	assert.match(splashCss, /trellis-splash-backdrop::before/);
	assert.doesNotMatch(splashCss, /trellis-splash-backdrop::after/);
	assert.doesNotMatch(splashCss, /background-image: var\(--trellis-splash-image\)/);
	assert.match(splashCss, /trellis-splash-has-image \.trellis-splash-bg-image[\s\S]*opacity: 1/);
	assert.doesNotMatch(splashCss, /trellis-splash-has-image::before[\s\S]*opacity: 0/);
	assert.match(splashCss, /\.geEditor\.trellis-splash-active > \.geMenubarContainer/);
	assert.match(splashCss, /\.geEditor\.trellis-splash-active > \.geToolbarContainer/);
	assert.match(splashCss, /\.trellis-splash-bg-image/);
	assert.match(splashCss, /object-fit: cover/);
	assert.match(splashCss, /\.trellis-splash-identity[\s\S]*display: flex/);
	assert.match(splashCss, /\.trellis-splash-brand-mark[\s\S]*trellis-splash-icon\.png/);
	assert.match(splashCss, /\.trellis-license-obligation-italic[\s\S]*font-style: italic/);
	assert.match(enhancementSource, /email: \['M4 6h16v12H4z'/);
	assert.match(enhancementSource, /github: \['M12 2a10 10/);
	assert.match(splashCss, /width: var\(--trellis-workspace-width, 100%\)/);
	assert.match(enhancementSource, /trellis-splash-bg-image/);
	assert.doesNotMatch(splashCss, /max-height: 820px/);
	assert.match(splashCss, /top: var\(--trellis-workspace-top/);
	assert.match(splashCss, /height: var\(--trellis-splash-dialog-height, 690px\) !important/);
	assert.match(splashCss, /trellis-license-status::after/);
    assert.match(splashCss, /#fbf8ed/);
    assert.match(indexSource, /styles\/trellis-splash\.css/);
    assert.ok(enhancementIndex >= 0 && enhancementIndex < bootstrapIndex);
    assert.match(bootstrapSource, /TrellisSplashEnhancements\.install\(\)/);
    assert.match(electronSource, /case 'getTrellisSplashBackground':/);
});
