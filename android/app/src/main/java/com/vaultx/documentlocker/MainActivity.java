package com.vaultx.documentlocker;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(VaultNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
