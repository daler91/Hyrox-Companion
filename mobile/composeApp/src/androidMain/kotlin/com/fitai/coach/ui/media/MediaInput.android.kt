package com.fitai.coach.ui.media

import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.fitai.coach.core.data.EncodedImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
actual fun rememberPhotoPicker(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)? {
    val encode = rememberImageEncoder(onPicked, onError)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { encode(it) {} } }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

/**
 * The camera app writes its photo to a file in the cache, handed over through
 * the app's FileProvider; it is encoded like a picked photo, then deleted.
 */
@Composable
actual fun rememberCamera(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (() -> Unit)? {
    val context = LocalContext.current
    val encode = rememberImageEncoder(onPicked, onError)
    val failed by rememberUpdatedState(onError)
    val photo = remember(context) { File(File(context.cacheDir, "camera"), "photo.jpg") }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        if (saved) encode(Uri.fromFile(photo)) { photo.delete() } else photo.delete()
    }
    val hasCamera = remember(context) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    if (!hasCamera) return null
    return {
        photo.parentFile?.mkdirs()
        val uri = FileProvider.getUriForFile(context, fileProviderAuthority(context), photo)
        try {
            launcher.launch(uri)
        } catch (_: ActivityNotFoundException) {
            failed("No camera app is available")
        }
    }
}

/** The app's FileProvider (androidApp's manifest). */
internal fun fileProviderAuthority(context: Context): String = "${context.packageName}.files"

/** Encodes an image off the main thread and reports it, or a sentence about why not; [then] runs either way. */
@Composable
private fun rememberImageEncoder(onPicked: (EncodedImage) -> Unit, onError: (String) -> Unit): (Uri, () -> Unit) -> Unit {
    val resolver = LocalContext.current.contentResolver
    val scope = rememberCoroutineScope()
    val picked by rememberUpdatedState(onPicked)
    val failed by rememberUpdatedState(onError)
    return remember(resolver, scope) {
        { uri, then ->
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
                } finally {
                    then()
                }
            }
        }
    }
}

private class ImageTooLarge : IOException("Image too large (max 20MB).")

/** Reads [uri], scales it so the longest side is at most [MAX_IMAGE_DIMENSION] (never up), and encodes JPEG. */
private fun encodeImage(resolver: ContentResolver, uri: Uri): EncodedImage {
    val size = if (uri.scheme == "file") {
        uri.path?.let { File(it).length() }
    } else {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
        }
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
