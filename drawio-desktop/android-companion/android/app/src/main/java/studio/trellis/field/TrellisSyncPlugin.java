package studio.trellis.field;

import android.content.Intent;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Native file/daemon boundary. Web content never receives the daemon API key. // NEW */
@CapacitorPlugin(name = "TrellisSync")
public class TrellisSyncPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final Map<String, Daemon> daemons = new java.util.concurrent.ConcurrentHashMap<>(); // CHANGE: activity recreation reuses the foreground transport.
    private static final Object engineLock = new Object(); // NEW: service network events and activity calls share process ownership.
    private static volatile boolean transportBlocked; // NEW: a network-loss stop cannot wait behind native API startup.
    private static final java.util.concurrent.atomic.AtomicLong engineGeneration = new java.util.concurrent.atomic.AtomicLong(); // NEW: service shutdown invalidates startup work already in flight.
    private static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final class Daemon { File home; volatile Process process; ProcessBuilder launch; volatile boolean suspended; int port; String apiKey; String deviceId; } // CHANGE: service callbacks see the current child during native startup.
    private String safe(String value) throws IOException {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,160}")) throw new IOException("Invalid identity identifier.");
        return value;
    }
    private File home(String id) throws IOException { return new File(getContext().getFilesDir(), "identities/" + safe(id)); }
    private File binary() throws IOException {
        File file = new File(getContext().getApplicationInfo().nativeLibraryDir, "libsyncthing.so");
        if (!file.isFile()) throw new IOException("Bundled Syncthing engine is unavailable for this device architecture.");
        return file;
    }
    private void execute(PluginCall call, Callable<JSObject> task) {
        worker.execute(() -> { try { call.resolve(task.call()); } catch (Exception error) { call.reject(error.getMessage(), error); } });
    }
    private void atomic(File file, String text) throws IOException {
        if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) throw new IOException("Could not create package folder.");
        File temporary = new File(file.getPath() + ".tmp-" + UUID.randomUUID());
        try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(text.getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
        Files.move(temporary.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }
    /** Read a bounded stream using APIs supported by every supported Android release. */ // NEW
    private byte[] readBounded(InputStream input) throws IOException { // NEW
        if (input == null) throw new IOException("Could not open package."); // NEW
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count; // NEW
        while ((count = input.read(buffer)) != -1) { // NEW
            if (output.size() + count > MAX_BYTES) throw new IOException("Package is too large."); // NEW
            output.write(buffer, 0, count); // NEW
        } // NEW
        return output.toByteArray(); // NEW
    } // NEW
    /** Native package reads share the same size bound as document imports. */ // NEW
    private String readText(File file) throws IOException { // NEW
        try (InputStream input = new FileInputStream(file)) { return new String(readBounded(input), StandardCharsets.UTF_8); } // NEW
    } // NEW
    private JSONObject rest(Daemon daemon, String endpoint, String method, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)new URL("http://127.0.0.1:" + daemon.port + "/rest/" + endpoint).openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(10000); connection.setRequestMethod(method);
        connection.setRequestProperty("X-API-Key", daemon.apiKey);
        if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); try (OutputStream stream = connection.getOutputStream()) { stream.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
        try {
            int code = connection.getResponseCode(); if (code < 200 || code > 299) throw new IOException("Syncthing request failed: " + code);
            String text; try (InputStream input = connection.getInputStream()) { text = new String(readBounded(input), StandardCharsets.UTF_8); } // CHANGE
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally { connection.disconnect(); }
    }
    /** Disk access remains available when the user's network policy blocks transport. */ // NEW
    private boolean waitingForWifi() { // NEW
        if (!getContext().getSharedPreferences("trellis-sync", 0).getBoolean("wifiOnly", false)) return false; // NEW
        android.net.ConnectivityManager manager = getContext().getSystemService(android.net.ConnectivityManager.class); // NEW
        android.net.NetworkCapabilities caps = manager.getNetworkCapabilities(manager.getActiveNetwork()); // NEW
        return caps == null || !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI); // NEW
    } // NEW
    private Daemon start(String id) throws Exception { // CHANGE
        synchronized (engineLock) { // NEW
            if (waitingForWifi()) { suspendAll(); throw new IOException("Waiting for Wi-Fi."); } // CHANGE
            transportBlocked = false; // NEW: a permitted foreground restart recovers after a service timeout or process death.
            long generation = engineGeneration.get(); Daemon daemon = startAllowed(id, generation); // CHANGE
            if (generation != engineGeneration.get()) { daemon.process.destroyForcibly(); throw new IOException("Synchronization stopped. Reopen the app to resume."); } // NEW
            if (transportBlocked || waitingForWifi()) { suspendAll(); throw new IOException("Waiting for Wi-Fi."); } // CHANGE: a handoff during startup cannot leave a mobile-data engine running.
            return daemon; // NEW
        } // NEW
    } // NEW
    /** Called only under engineLock, after the current network policy permits transfers. */ // NEW
    private Daemon startAllowed(String id, long generation) throws Exception { // CHANGE
        Daemon existing = daemons.get(id);
        if (existing != null && existing.process.isAlive()) return existing;
        if (existing != null && existing.suspended) { // CHANGE
            if (transportBlocked) throw new IOException("Waiting for Wi-Fi."); // NEW
            existing.process = existing.launch.start(); existing.suspended = false; // NEW
            try { awaitReady(existing); return existing; } catch (Exception error) { existing.suspended = true; existing.process.destroyForcibly(); throw error; } // NEW: a failed resume remains retryable and cannot leave an unmonitored engine.
        } // NEW
        File directory = home(id), transport = new File(directory, "transport"); transport.mkdirs();
        File configuration = new File(transport, "config.xml");
        if (!configuration.exists()) {
            Process generator = new ProcessBuilder(binary().getPath(), "generate", "--home=" + transport.getPath()).redirectErrorStream(true).redirectOutput(new File(directory, "generate.log")).start();
            if (!generator.waitFor(20, TimeUnit.SECONDS)) { generator.destroyForcibly(); throw new IOException("Device generation timed out."); }
            if (generator.exitValue() != 0) throw new IOException("Device generation failed.");
        }
        Daemon daemon = new Daemon(); daemon.home = directory;
        File keyFile = new File(transport, "api-key");
        if (keyFile.exists()) daemon.apiKey = readText(keyFile); // CHANGE
        else { byte[] random = new byte[32]; new SecureRandom().nextBytes(random); daemon.apiKey = Base64.encodeToString(random, Base64.NO_WRAP); atomic(keyFile, daemon.apiKey); }
        try (ServerSocket server = new ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"))) { daemon.port = server.getLocalPort(); }
        ProcessBuilder launch = new ProcessBuilder(binary().getPath(), "serve", "--home=" + transport.getPath(), "--gui-address=127.0.0.1:" + daemon.port, "--no-browser", "--no-upgrade", "--no-restart", "--log-file=" + new File(directory, "sync.log"), "--log-max-size=1048576", "--log-max-old-files=2");
        launch.environment().put("STGUIAPIKEY", daemon.apiKey); launch.environment().put("STNOUPGRADE", "1"); launch.environment().put("STMONITORED", "yes"); launch.environment().put("HOME", directory.getPath());
        if (generation != engineGeneration.get()) throw new IOException("Synchronization startup was stopped."); // NEW
        getContext().startForegroundService(new Intent(getContext(), TrellisSyncService.class)); // CHANGE: a rejected Android background start must not leave an unmonitored child process.
        launch.redirectErrorStream(true).redirectOutput(new File("/dev/null")); daemon.launch = launch; daemon.process = launch.start(); // CHANGE: preserve the launch for native network recovery.
        daemons.put(id, daemon); // NEW: network loss can stop the child while its API and initial configuration are still loading.
        try { // NEW
            if (transportBlocked || generation != engineGeneration.get()) throw new IOException("Synchronization startup was stopped."); awaitReady(daemon); // CHANGE
            JSONObject config = rest(daemon, "config", "GET", null); // CHANGE
            JSONArray retained = new JSONArray(), folders = config.getJSONArray("folders"); // CHANGE
            for (int i = 0; i < folders.length(); i++) if (folders.getJSONObject(i).getString("id").startsWith("trellis-identity-")) retained.put(folders.getJSONObject(i)); // CHANGE
            config.put("folders", retained); // CHANGE
            config.getJSONObject("options").put("autoUpgradeIntervalH", 0).put("urAccepted", -1).put("crashReportingEnabled", false).put("startBrowser", false); // CHANGE
            try (ServerSocket listener = new ServerSocket(0)) { int syncPort = listener.getLocalPort(); config.getJSONObject("options").put("listenAddresses", new JSONArray().put("tcp://0.0.0.0:" + syncPort).put("quic://0.0.0.0:" + syncPort).put("dynamic+https://relays.syncthing.net/endpoint")); } // CHANGE: separate identities must not compete for the default sync port.
            rest(daemon, "config", "PUT", config); // CHANGE
            return daemon; // CHANGE
        } catch (Exception error) { daemons.remove(id, daemon); daemon.process.destroyForcibly(); throw error; } // NEW: initialization or configuration failure owns its child cleanup.
    }
    /** Initial starts and native network resumes share the same bounded readiness check. */ // NEW
    private void awaitReady(Daemon daemon) throws Exception { // NEW
        Exception failure = null;
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20); // NEW
        while (System.nanoTime() < deadline) { // CHANGE: a local API timeout cannot create an unbounded startup wait.
            try { daemon.deviceId = rest(daemon, "system/status", "GET", null).getString("myID"); failure = null; break; }
            catch (Exception error) { failure = error; if (!daemon.process.isAlive()) break; Thread.sleep(200); }
        }
        if (failure != null) throw failure; // CHANGE
    } // NEW
    @PluginMethod public void createRequest(PluginCall call) {
        execute(call, () -> { String requestId = UUID.randomUUID().toString(); Daemon daemon = start("pending-" + requestId); return new JSObject().put("requestId", requestId).put("syncthingId", daemon.deviceId); });
    }
    @PluginMethod public void configureIdentity(PluginCall call) {
        execute(call, () -> {
            String id = safe(call.getString("identityId")), requestId = call.getString("requestId");
            if (requestId != null) {
                synchronized (engineLock) { // NEW: a Wi-Fi callback cannot restart a provisional engine while its profile is adopted.
                    String provisional = "pending-" + safe(requestId); Daemon old = daemons.remove(provisional);
                    if (old != null) { old.process.destroy(); if (!old.process.waitFor(5, TimeUnit.SECONDS)) old.process.destroyForcibly(); }
                    File source = home(provisional), destination = home(id);
                    if (source.exists() && !destination.exists()) Files.move(source.toPath(), destination.toPath());
                } // NEW
            }
            if (waitingForWifi()) { suspendAll(); return new JSObject().put("ok", true).put("waitingForWifi", true); } // NEW: approved setup and local outbox writes can finish without a permitted network.
            Daemon daemon = start(id); JSONObject config = rest(daemon, "config", "GET", null); // CHANGE
            JSONArray devices = call.getArray("devices"), peers = new JSONArray(), folders = new JSONArray();
            JSONArray configuredDevices = new JSONArray();
            for (int i = 0; i < devices.length(); i++) {
                JSONObject device = devices.getJSONObject(i); String deviceId = device.getString("syncthingId");
                if (!deviceId.matches("[A-Z2-7-]{63}")) throw new IOException("Invalid Syncthing device identity.");
                configuredDevices.put(new JSONObject().put("deviceID", deviceId).put("name", device.optString("name")).put("addresses", new JSONArray().put("dynamic")).put("paused", false).put("introducer", false).put("autoAcceptFolders", false));
                peers.put(new JSONObject().put("deviceID", deviceId));
            }
            File metadata = new File(daemon.home, "metadata"); metadata.mkdirs();
            folders.put(new JSONObject().put("id", "trellis-identity-" + id).put("label", "Trellis field library").put("path", metadata.getPath()).put("type", "sendreceive").put("paused", false).put("devices", peers).put("fsWatcherEnabled", true).put("fsWatcherDelayS", 1).put("rescanIntervalS", 300).put("maxConflicts", -1));
            config.put("devices", configuredDevices).put("folders", folders); rest(daemon, "config", "PUT", config);
            getContext().getSharedPreferences("trellis-sync", 0).edit().putString("identityId", id).apply();
            return new JSObject().put("ok", true).put("syncthingId", daemon.deviceId);
        });
    }
    private File metadataFile(String identityId, String relative) throws Exception {
        File root = new File(home(identityId), "metadata").getCanonicalFile();
        if (relative == null || !relative.matches("(?:events|catalog|field)/[A-Za-z0-9_./:-]+\\.json") || relative.contains("..")) throw new IOException("Invalid package path.");
        File file = new File(root, relative).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("Package is outside managed storage.");
        return file;
    }
    @PluginMethod public void writeRecord(PluginCall call) {
        execute(call, () -> {
            File file = metadataFile(safe(call.getString("identityId")), call.getString("relative")); String text = call.getString("text");
            if (text == null || text.length() > MAX_BYTES) throw new IOException("Package is too large.");
            if (file.exists() && !readText(file).equals(text)) throw new IOException("Immutable record already exists."); // CHANGE
            if (!file.exists()) atomic(file, text); return new JSObject().put("ok", true);
        });
    }
    private void collect(File directory, File root, JSONArray result) throws Exception {
        File[] entries = directory.listFiles(); if (entries == null) return;
        for (File entry : entries) {
            if (Files.isSymbolicLink(entry.toPath())) continue;
            if (entry.isDirectory()) collect(entry, root, result);
            else if (entry.getName().matches("[A-Za-z0-9_-]+\\.json") && entry.length() <= MAX_BYTES) result.put(new JSONObject().put("relative", root.toPath().relativize(entry.toPath()).toString().replace('\\', '/')).put("text", readText(entry))); // CHANGE
        }
    }
    @PluginMethod public void readRecords(PluginCall call) {
        execute(call, () -> { // CHANGE
            String id = safe(call.getString("identityId")); boolean waiting = waitingForWifi(); if (waiting) suspendAll(); else start(id); File root = new File(home(id), "metadata"); JSONArray result = new JSONArray(); // CHANGE: cached signed records stay readable while Wi-Fi-only blocks transport.
            for (String name : Arrays.asList("events", "catalog", "field")) collect(new File(root, name), root, result); // CHANGE
            android.net.ConnectivityManager manager = (android.net.ConnectivityManager)getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE); // NEW
            return new JSObject().put("records", result).put("networkAvailable", manager.getActiveNetwork() != null).put("waitingForWifi", waiting); // CHANGE
        }); // CHANGE
    }
    @PluginMethod public void setWifiOnly(PluginCall call) {
        execute(call, () -> {
            boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
            getContext().getSharedPreferences("trellis-sync", 0).edit().putBoolean("wifiOnly", enabled).apply();
            if (waitingForWifi()) suspendAll(); else resumeAll(); // CHANGE: applying a setting immediately affects every identity's native transport.
            return new JSObject().put("ok", true);
        });
    }
    private SecretKey storageKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("trellis-pairing")) {
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("trellis-pairing", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey();
        }
        return (SecretKey)store.getKey("trellis-pairing", null);
    }
    @PluginMethod public void protectPending(PluginCall call) {
        execute(call, () -> { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, storageKey()); return new JSObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("data", Base64.encodeToString(cipher.doFinal(call.getString("text").getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP)); });
    }
    @PluginMethod public void unprotectPending(PluginCall call) {
        execute(call, () -> { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, storageKey(), new GCMParameterSpec(128, Base64.decode(call.getString("iv"), Base64.NO_WRAP))); return new JSObject().put("text", new String(cipher.doFinal(Base64.decode(call.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8)); });
    }
    @PluginMethod public void importFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"); startActivityForResult(call, intent, "fileSelected");
    }
    @ActivityCallback private void fileSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("canceled", true)); return; }
        execute(call, () -> { try (InputStream input = getContext().getContentResolver().openInputStream(result.getData().getData())) { return new JSObject().put("text", new String(readBounded(input), StandardCharsets.UTF_8)); } }); // CHANGE
    }
    @PluginMethod public void exportFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, call.getString("filename", "trellis-package.json")); startActivityForResult(call, intent, "fileCreated");
    }
    @ActivityCallback private void fileCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("canceled", true)); return; }
        execute(call, () -> { try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData())) { stream.write(call.getString("text").getBytes(StandardCharsets.UTF_8)); return new JSObject().put("ok", true); } });
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); super.handleOnDestroy(); }
    /** Android timeout/shutdown cannot leave an unmonitored native child alive. */ // NEW
    static void stopAll() { engineGeneration.incrementAndGet(); transportBlocked = true; for (Daemon daemon : daemons.values()) daemon.process.destroyForcibly(); daemons.clear(); } // CHANGE: Android's service timeout cannot wait behind the engine-startup lock.
    /** Stop traffic without discarding native identity or Syncthing's resumable download state. */ // NEW
    static void suspendAll() { // NEW
        transportBlocked = true; // NEW
        for (Daemon daemon : daemons.values()) { daemon.suspended = true; Process process = daemon.process; process.destroyForcibly(); try { process.waitFor(5, TimeUnit.SECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } } // CHANGE: do not wait for the startup lock before stopping traffic.
    } // NEW
    /** Resume only engines already owned by the living foreground service; never start a new service from a network callback. */ // NEW
    static void resumeAll() { // NEW
        transportBlocked = false; // NEW
        synchronized (engineLock) { // NEW
            for (Daemon daemon : daemons.values()) if (daemon.suspended && !transportBlocked && !daemon.process.isAlive()) { // CHANGE
                try { daemon.process = daemon.launch.start(); daemon.suspended = false; if (transportBlocked) { daemon.suspended = true; daemon.process.destroyForcibly(); } } // CHANGE: a simultaneous handoff must win over engine resume.
                catch (IOException error) { android.util.Log.w("TrellisSync", "Native transfer will retry when the app resumes.", error); } // NEW
            } // NEW
        } // NEW
    } // NEW
}
