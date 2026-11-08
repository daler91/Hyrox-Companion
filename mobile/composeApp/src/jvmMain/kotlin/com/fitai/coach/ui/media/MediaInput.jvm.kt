package com.fitai.coach.ui.media

import androidx.compose.runtime.Composable
import com.fitai.coach.core.data.EncodedImage

// The JVM target runs tests and tools; it has no picker or recogniser.
@Composable
actual fun rememberPhotoPicker(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)? = null

@Composable
actual fun rememberSpeechInput(onText: (String) -> Unit, onError: (String) -> Unit): (() -> Unit)? = null
