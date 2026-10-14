package studio.trellis.field; // NEW

import java.lang.reflect.*; // NEW
import java.nio.file.*; // NEW
import java.util.*; // NEW
import java.util.concurrent.*; // NEW

/** Host test of the compiled native engine ownership methods; Android network callbacks require a physical test. */ // NEW
public final class NativeEnginePolicyTest { // NEW
    private static final List<Process> children = new ArrayList<>(); // NEW
    /** The disposable child records progress without accessing a device, credential, or installed profile. */ // NEW
    private static void child(String id, Path directory) throws Exception { // NEW
        Files.createDirectories(directory); Path identity = directory.resolve("identity"), progress = directory.resolve("progress"); // NEW
        if (!Files.exists(identity)) Files.writeString(identity, id, StandardOpenOption.CREATE_NEW); // NEW
        if (!Files.readString(identity).equals(id)) throw new AssertionError("Restart changed the configured identity."); // NEW
        while (true) { Files.writeString(progress, "x", StandardOpenOption.CREATE, StandardOpenOption.APPEND); Thread.sleep(100); } // NEW
    } // NEW
    private static Field field(Class<?> type, String name) throws Exception { Field value = type.getDeclaredField(name); value.setAccessible(true); return value; } // NEW
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); } // NEW
    private static void awaitProgress(Path file, long previous) throws Exception { // NEW
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10); // NEW
        while (System.nanoTime() < deadline) { if (Files.exists(file) && Files.size(file) > previous) return; Thread.sleep(50); } // NEW
        throw new AssertionError("Owned child did not resume its persisted progress."); // NEW
    } // NEW
    @SuppressWarnings("unchecked") // NEW
    public static void main(String[] args) throws Exception { // NEW
        if (args[0].equals("--child")) { child(args[1], Path.of(args[2])); return; } // NEW
        Path output = Path.of(args[0]).toAbsolutePath(); Files.createDirectories(output); // NEW
        Class<?> daemonType = Class.forName("studio.trellis.field.TrellisSyncPlugin$Daemon"); // NEW
        Constructor<?> constructor = daemonType.getDeclaredConstructor(); constructor.setAccessible(true); // NEW
        Map<String, Object> daemons = (Map<String, Object>)field(TrellisSyncPlugin.class, "daemons").get(null); // NEW
        Object lock = field(TrellisSyncPlugin.class, "engineLock").get(null); // NEW
        String java = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java").toString(); // NEW
        Map<String, Long> paused = new HashMap<>(); // NEW
        try { // NEW
            for (String id : List.of("sample-a", "sample-b")) { // NEW
                Object daemon = constructor.newInstance(); Path directory = output.resolve(id); // NEW
                ProcessBuilder launch = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), NativeEnginePolicyTest.class.getName(), "--child", id, directory.toString()).redirectErrorStream(true).redirectOutput(directory.resolveSibling(id + ".log").toFile()); // NEW
                Process process = launch.start(); children.add(process); field(daemonType, "launch").set(daemon, launch); field(daemonType, "process").set(daemon, process); daemons.put(id, daemon); // NEW
                awaitProgress(directory.resolve("progress"), 0); // NEW
            } // NEW
            CountDownLatch held = new CountDownLatch(1); // NEW
            Thread startup = new Thread(() -> { synchronized (lock) { held.countDown(); try { Thread.sleep(3000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } } }); startup.start(); held.await(); // NEW
            long before = System.nanoTime(); TrellisSyncPlugin.suspendAll(); long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - before); // NEW
            check(elapsed < 2500, "Network loss waited behind the startup lock."); // NEW
            for (String id : daemons.keySet()) { Object daemon = daemons.get(id); check(!((Process)field(daemonType, "process").get(daemon)).isAlive(), "A blocked identity still has a running child."); paused.put(id, Files.size(output.resolve(id).resolve("progress"))); } // NEW
            Thread.sleep(250); for (String id : paused.keySet()) check(Files.size(output.resolve(id).resolve("progress")) == paused.get(id), "A suspended child kept writing."); // NEW
            startup.join(); TrellisSyncPlugin.resumeAll(); // NEW
            for (String id : daemons.keySet()) { Process process = (Process)field(daemonType, "process").get(daemons.get(id)); children.add(process); check(process.isAlive(), "Wi-Fi return did not restart an owned child."); awaitProgress(output.resolve(id).resolve("progress"), paused.get(id)); check(Files.readString(output.resolve(id).resolve("identity")).equals(id), "Restart lost the identity configuration."); } // NEW
            Map<String, Process> resumed = new HashMap<>(); for (String id : daemons.keySet()) resumed.put(id, (Process)field(daemonType, "process").get(daemons.get(id))); // NEW
            TrellisSyncPlugin.resumeAll(); for (String id : daemons.keySet()) check(resumed.get(id) == field(daemonType, "process").get(daemons.get(id)), "Repeated availability launched a duplicate child."); // NEW
            CountDownLatch shutdownHeld = new CountDownLatch(1); Thread shutdownStartup = new Thread(() -> { synchronized (lock) { shutdownHeld.countDown(); try { Thread.sleep(3000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } } }); shutdownStartup.start(); shutdownHeld.await(); // NEW
            before = System.nanoTime(); TrellisSyncPlugin.stopAll(); elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - before); check(elapsed < 2500, "Android service shutdown waited behind the startup lock."); // NEW
            check(daemons.isEmpty(), "Service shutdown retained process ownership."); for (Process process : resumed.values()) { process.waitFor(5, TimeUnit.SECONDS); check(!process.isAlive(), "Service shutdown left a child alive."); } shutdownStartup.join(); // CHANGE
            System.out.println("{\"ok\":true,\"identities\":2,\"pauseDuringStartup\":true,\"persistedResume\":true,\"idempotentResume\":true,\"shutdownDuringStartup\":true,\"shutdownStoppedChildren\":true,\"androidNetworkCallbackTested\":false}"); // CHANGE
        } finally { for (Process process : children) if (process.isAlive()) process.destroyForcibly(); TrellisSyncPlugin.stopAll(); } // NEW
    } // NEW
} // NEW
