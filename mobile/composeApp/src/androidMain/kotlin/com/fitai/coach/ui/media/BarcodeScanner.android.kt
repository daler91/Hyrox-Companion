package com.fitai.coach.ui.media

import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Google's code scanner: Play services shows the camera and hands back the
 * code, so the app needs no camera permission. Its scanning module downloads
 * on first use (or at install, as the manifest asks).
 */
@Composable
actual fun rememberBarcodeScanner(onScanned: (String) -> Unit, onError: (String) -> Unit): (() -> Unit)? {
    val context = LocalContext.current
    val scanned by rememberUpdatedState(onScanned)
    val failed by rememberUpdatedState(onError)
    val hasCamera = remember(context) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    val scanner = remember(context) {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .build()
        GmsBarcodeScanning.getClient(context, options)
    }
    if (!hasCamera) return null
    return {
        scanner.startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let { scanned(it) } }
            .addOnFailureListener { failed("Couldn't open the barcode scanner. Enter the number instead.") }
    }
}
