package com.fitai.coach.ui.platform

import androidx.compose.runtime.Composable

/** Hands a file to the system's share sheet (save to Drive, email it, …). */
fun interface FileSharer {
    fun share(fileName: String, mimeType: String, content: String)
}

/** Null where the platform has no share sheet. */
@Composable
expect fun rememberFileSharer(): FileSharer?
