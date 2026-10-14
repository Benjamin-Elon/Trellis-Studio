package studio.trellis.field;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity { // CHANGE: register only the fixed native field adapter.
    @Override public void onCreate(android.os.Bundle state) { registerPlugin(TrellisSyncPlugin.class); super.onCreate(state); } // NEW
}
