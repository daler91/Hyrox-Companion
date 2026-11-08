package com.fitai.coach.ui.media

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Dictation with the on-device SpeechRecognizer: it listens in the app, with
 * the microphone permission asked for on the first tap. Where the device has
 * no recogniser service, the system's own speech screen is used instead.
 */
@Composable
actual fun rememberSpeechInput(onText: (String) -> Unit, onError: (String) -> Unit): SpeechInput? {
    val context = LocalContext.current
    val text by rememberUpdatedState(onText)
    val failed by rememberUpdatedState(onError)
    val fallback = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(text)
    }
    val input = remember(context) { RecognizerInput(context, { text(it) }, { failed(it) }) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) input.listen() else failed("Dictation needs the microphone. Allow it in your phone's settings.")
    }
    DisposableEffect(input) { onDispose(input::release) }
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        return remember(fallback) { SystemSpeechScreen(fallback) { failed(it) } }
    }
    return remember(input, permission) {
        object : SpeechInput {
            override val listening: Boolean get() = input.listening

            override fun start() {
                val granted =
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                if (granted) input.listen() else permission.launch(Manifest.permission.RECORD_AUDIO)
            }

            override fun stop() = input.stop()
        }
    }
}

private fun recognizeIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your workout")

private class SystemSpeechScreen(
    private val launcher: ActivityResultLauncher<Intent>,
    private val failed: (String) -> Unit,
) : SpeechInput {
    override val listening: Boolean = false

    override fun start() {
        try {
            launcher.launch(recognizeIntent())
        } catch (_: ActivityNotFoundException) {
            failed("Voice input isn't available on this device")
        }
    }

    override fun stop() = Unit
}

/** One SpeechRecognizer, created on the first listen and released with the screen. */
private class RecognizerInput(
    private val context: Context,
    private val onText: (String) -> Unit,
    private val onError: (String) -> Unit,
) : RecognitionListener {
    private var recognizer: SpeechRecognizer? = null
    var listening by mutableStateOf(false)
        private set

    fun listen() {
        val active = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(this)
            recognizer = it
        }
        listening = true
        active.startListening(recognizeIntent())
    }

    fun stop() {
        recognizer?.stopListening()
    }

    fun release() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    override fun onResults(results: Bundle?) {
        listening = false
        results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let(onText)
    }

    override fun onError(error: Int) {
        listening = false
        onError(speechErrorMessage(error))
    }

    override fun onEndOfSpeech() = Unit

    override fun onReadyForSpeech(params: Bundle?) = Unit

    override fun onBeginningOfSpeech() = Unit

    override fun onRmsChanged(rmsdB: Float) = Unit

    override fun onBufferReceived(buffer: ByteArray?) = Unit

    override fun onPartialResults(partialResults: Bundle?) = Unit

    override fun onEvent(eventType: Int, params: Bundle?) = Unit
}

private fun speechErrorMessage(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch that. Tap Dictate and try again."
    SpeechRecognizer.ERROR_NETWORK,
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
    SpeechRecognizer.ERROR_SERVER,
    -> "Dictation needs a connection right now. Try again online."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Dictation needs the microphone. Allow it in your phone's settings."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Dictation is busy. Try again in a moment."
    else -> "Dictation stopped. Try again."
}
