package com.fitai.coach.ui.media

import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.fitai.coach.core.data.EncodedImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
actual fun rememberPhotoPicker(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)? {
    val resolver = LocalContext.current.contentResolver
    val scope = rememberCoroutineScope()
    val picked by rememberUpdatedState(onPicked)
    val failed by rememberUpdatedState(onError)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                try {
                    picked(withContext(Dispatchers.IO) { encodeImage(resolver, uri) })
                } catch (e: CancellationException) {
                    throw e
                } catch (e: ImageTooLarge) {
                    failed(e.message ?: "Image too large (max 20MB).")
                } catch (_: IOException) {
                    failed("Couldn't prepare that image")
                } catch (_: IllegalArgumentException) {
                    failed("Couldn't prepare that image")
                }
            }
        }
    }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

private class ImageTooLarge : IOException("Image too large (max 20MB).")

/** Reads [uri], scales it so the longest side is at most [MAX_IMAGE_DIMENSION] (never up), and encodes JPEG. */
private fun encodeImage(resolver: ContentResolver, uri: Uri): EncodedImage {
    val size = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
    }
    if (size != null && size > MAX_SOURCE_BYTES) throw ImageTooLarge()
    val bitmap = decode(resolver, uri)
    val scale = minOf(1f, MAX_IMAGE_DIMENSION.toFloat() / max(bitmap.width, bitmap.height))
    val scaled = if (scale < 1f) {
        Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).roundToInt().coerceAtLeast(1),
            (bitmap.height * scale).roundToInt().coerceAtLeast(1),
            true,
        )
    } else {
        bitmap
    }
    val bytes = ByteArrayOutputStream().use { out ->
        scaled.compress(Bitmap.CompressFormat.JPEG, IMAGE_QUALITY, out)
        out.toByteArray()
    }
    return EncodedImage(Base64.encodeToString(bytes, Base64.NO_WRAP), "image/jpeg")
}

// ImageDecoder applies the photo's EXIF rotation; BitmapFactory (before API 28) doesn't.
private fun decode(resolver: ContentResolver, uri: Uri): Bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val longest = max(info.size.width, info.size.height)
        if (longest > MAX_IMAGE_DIMENSION * 2) {
            val sample = longest / MAX_IMAGE_DIMENSION
            decoder.setTargetSize(info.size.width / sample, info.size.height / sample)
        }
    }
} else {
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: throw IOException("unreadable image")
}

@Composable
actual fun rememberSpeechInput(onText: (String) -> Unit, onError: (String) -> Unit): (() -> Unit)? {
    val text by rememberUpdatedState(onText)
    val failed by rememberUpdatedState(onError)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(text)
    }
    return {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your workout")
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            failed("Voice input isn't available on this device")
        }
    }
}
