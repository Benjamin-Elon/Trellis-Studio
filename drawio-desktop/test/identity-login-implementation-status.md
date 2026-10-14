# Home remembered identity login <!-- NEW -->

Home login, identity creation, and approved-setup import now offer **Keep me logged in on this device**, checked by default. The native checkbox has an accessible label and supports keyboard toggling; form submission includes its boolean value. A delayed identity-list response cannot erase an opened form. <!-- NEW -->

`create` and `unlock` accept `keepLoggedIn`; omission preserves temporary sessions for existing callers. Successful authentication may return `persistenceWarning` when OS protection or writing the remembered credential fails. Home retains that notice after rendering the logged-in controls, including after password changes. `lock` is asynchronous and callers must await it: successful logout means the remembered credential has been removed. Canceled logout leaves both the active session and remembered credential intact. <!-- NEW -->

The identity service stores one `remembered-session.json` under the desktop identity root, outside synchronized metadata. Its OS-encrypted content contains the identity/device identifiers, authenticated password-event heads, and independent vault key. Restoration verifies the installed trust anchor, signed events, current membership, credential version, device vault, and matching signing key. Passwords and signing keys are never persisted in the remembered file or exposed through the public session. Protection functions are injected for testing; production uses Electron `safeStorage` and rejects unavailable encryption and Linux's `basic_text` backend. <!-- NEW -->

Login, restoration, logout, password changes, signing, and revocation checks share the existing operation queue. Local password changes retain the current login and persistence preference; received password changes and device removal clear access and remembered credentials. Background invalidation preserves unsaved editor documents. Self-removal clears credentials before transport configuration, so transport failure cannot retain access. Corrupt or undecryptable remembered records return to password login and are removed when possible. Credential deletion failures are reported rather than presented as successful logout or temporary login. <!-- NEW -->

Remembered access has no expiry. OS-account access remains sufficient to reopen it; Windows protection also permits other applications running as that user to decrypt stored material. Offline devices detect password changes and revocation after synchronization. Existing sessions are only remembered after a subsequent checked authentication. Diagram PIN login and Android behavior are unchanged. <!-- NEW -->

Verification uses temporary profiles and sample identities exclusively. All 142 regression tests passed, covering Home flows, notices, restoration, opt-out, wrong passwords, corruption, unavailable protection, disk write/delete errors, concurrent operations, identity switching, password conflicts, local/remote password changes, and device removal. The full-app Electron smoke passed across three actual processes using the production main process, Home module, preload, identity service, OS storage, and logout handshake: checked creation, restart restoration, canceled logout preserving an unsaved managed diagram, completed logout, and the subsequent signed-out restart. The real two-desktop Syncthing pairing/catalog/download test also passed. <!-- NEW -->

Reproduce from `drawio-desktop`: <!-- NEW -->

```powershell
node --test test/trellis-identity.test.mjs test/trellis-garden-home.test.cjs test/trellis-garden-library.test.mjs test/trellis-field-service.test.mjs test/trellis-users.test.cjs # NEW
$env:TRELLIS_IDENTITY_LOGIN_ELECTRON_TEST='1'; node --test test/trellis-identity-login-electron.test.cjs # NEW
Remove-Item Env:TRELLIS_IDENTITY_LOGIN_ELECTRON_TEST # NEW
$env:TRELLIS_SYNCTHING_RUNTIME_TEST='1'; node --test test/trellis-identity-runtime.test.mjs # NEW
```

Electron renderer launch requires execution outside the restricted command sandbox on this host. The full-app helper additionally exercises the current main process, actual splash, a sample managed diagram with unsaved changes, and native shutdown; sample discard prompts are answered only inside that isolated process. It writes phase records to `.test-artifacts/identity-login/`. Existing unrelated workspace changes are preserved. <!-- NEW -->
