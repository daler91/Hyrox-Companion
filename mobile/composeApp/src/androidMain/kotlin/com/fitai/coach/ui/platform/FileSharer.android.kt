package com.fitai.coach.ui.platform

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File

/**
 * Writes the file to the cache (replacing the last one of that name) and
 * offers it through the app's FileProvider, readable only by the app the
 * athlete picks.
 */
@Composable
actual fun rememberFileSharer(): FileSharer? {
    val context = LocalContext.current
    return remember(context) {
        FileSharer { fileName, mimeType, content ->
            val file = File(File(context.cacheDir, "exports").apply { mkdirs() }, fileName)
            file.writeText(content)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
            val send = Intent(Intent.ACTION_SEND)
                .setType(mimeType)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val chooser = Intent.createChooser(send, "Export your training data").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(chooser) }
        }
    }
}
