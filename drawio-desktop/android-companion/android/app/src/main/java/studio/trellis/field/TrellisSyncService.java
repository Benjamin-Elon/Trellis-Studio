package studio.trellis.field;
import android.app.*;
import android.content.Intent;
import android.os.IBinder;
import android.net.ConnectivityManager; // NEW
import android.net.Network; // NEW
import android.net.NetworkCapabilities; // NEW
import java.util.concurrent.ExecutorService; // NEW
import java.util.concurrent.Executors; // NEW
import java.util.concurrent.RejectedExecutionException; // NEW
/** Visible foreground lifetime for native transfer; Android may still suspend it. // NEW */
public class TrellisSyncService extends Service {
    private final ExecutorService networkWorker = Executors.newSingleThreadExecutor(); // NEW
    private ConnectivityManager connectivity; private ConnectivityManager.NetworkCallback networkCallback; private Network currentNetwork; // NEW
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("trellis-sync", "Garden synchronization", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(1, new Notification.Builder(this, "trellis-sync").setContentTitle("Trellis field synchronization").setContentText("Offline edits remain saved until desktop acknowledges them.").setSmallIcon(android.R.drawable.stat_notify_sync).setContentIntent(pending).build());
        watchNetwork(); // NEW: policy enforcement must continue while the web view is suspended or logged out.
    }
    /** Use callback capabilities directly; synchronous network queries inside callbacks can race Android handoffs. */ // NEW
    private void watchNetwork() { // NEW
        connectivity = getSystemService(ConnectivityManager.class); // NEW
        networkCallback = new ConnectivityManager.NetworkCallback() { // NEW
            @Override public void onAvailable(Network network) { currentNetwork = network; } // CHANGE: Android 8+ immediately supplies capabilities; availability alone does not identify the transport.
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { if (network.equals(currentNetwork)) applyNetwork(capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)); } // NEW
            @Override public void onLost(Network network) { if (network.equals(currentNetwork)) { currentNetwork = null; applyNetwork(false); } } // NEW
        }; // NEW
        connectivity.registerDefaultNetworkCallback(networkCallback); // NEW
    } // NEW
    /** Run process work away from Android's connectivity callback thread. */ // NEW
    private void applyNetwork(boolean wifiAvailable) { // NEW
        try { networkWorker.execute(() -> { if (getSharedPreferences("trellis-sync", 0).getBoolean("wifiOnly", false) && !wifiAvailable) TrellisSyncPlugin.suspendAll(); else TrellisSyncPlugin.resumeAll(); }); } // NEW
        catch (RejectedExecutionException ignored) { /* Service shutdown owns the final process stop. */ } // NEW
    } // NEW
    @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_NOT_STICKY; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTimeout(int startId, int fgsType) { TrellisSyncPlugin.stopAll(); stopSelf(); } // CHANGE
    @Override public void onDestroy() { if (networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback); networkWorker.shutdownNow(); TrellisSyncPlugin.stopAll(); super.onDestroy(); } // CHANGE: unregister the service-owned callback before releasing engines.
}
