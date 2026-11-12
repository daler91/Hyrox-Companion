package com.fitai.coach.ui.media

import androidx.compose.runtime.Composable
import com.fitai.coach.core.data.EncodedImage

/** The longest side a photo is scaled to before upload, as the web's lib/image.ts does. */
const val MAX_IMAGE_DIMENSION: Int = 1600

/** JPEG quality for an uploaded photo (0–100); the web uses 0.8. */
const val IMAGE_QUALITY: Int = 80

/** The largest source image accepted, before scaling. */
const val MAX_SOURCE_BYTES: Long = 20L * 1024 * 1024

/**
 * Remembers a launcher for the platform's photo picker. The picked photo
 * arrives scaled and JPEG-encoded through [onPicked]; [onError] gets a
 * sentence to show. Null where the platform has no picker.
 */
@Composable
expect fun rememberPhotoPicker(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)?

/**
 * Remembers a launcher for the camera: the photo taken arrives scaled and
 * JPEG-encoded through [onPicked], as from the picker. Null where there is no camera.
 */
@Composable
expect fun rememberCamera(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)?

/** Dictation: [start] listens until the athlete stops talking (or [stop]); the transcript goes to onText. */
interface SpeechInput {
    val listening: Boolean

    fun start()

    fun stop()
}

/**
 * Remembers the platform's speech recogniser; the transcript arrives
 * through [onText]. Null where the platform has none.
 */
@Composable
expect fun rememberSpeechInput(onText: (String) -> Unit, onError: (String) -> Unit): SpeechInput?

/**
 * Remembers a launcher for the platform's barcode scanner, for the codes on
 * food packets (EAN-13, EAN-8, UPC-A, UPC-E). The scanned digits arrive
 * through [onScanned]; [onError] gets a sentence to show. A cancelled scan
 * calls neither. Null where there is no scanner: typing the number works
 * everywhere.
 */
@Composable
expect fun rememberBarcodeScanner(onScanned: (String) -> Unit, onError: (String) -> Unit): (() -> Unit)?
