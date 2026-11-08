package com.fitai.coach.push

import android.content.Context
import androidx.core.content.edit
import com.fitai.coach.BuildConfig
import com.fitai.coach.core.push.PushPreference
import com.fitai.coach.core.push.PushTokens
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Starts Firebase from the build's configuration (androidApp/build.gradle.kts).
 * Returns false, leaving push off, in a build without it.
 */
internal fun startFirebase(context: Context): Boolean {
    val values =
        listOf(BuildConfig.FIREBASE_APP_ID, BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_PROJECT_ID, BuildConfig.FIREBASE_SENDER_ID)
    if (values.any { it.isBlank() }) return false
    if (FirebaseApp.getApps(context).isEmpty()) {
        val options = FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
    }
    return true
}

/**
 * The install's FCM token. Auto-init is off in the manifest, so no token
 * exists until the athlete turns push on; deleting it turns FCM off again.
 */
internal class FcmTokens : PushTokens {
    private val messaging get() = FirebaseMessaging.getInstance()

    override suspend fun current(): String {
        messaging.isAutoInitEnabled = true
        return messaging.token.await()
    }

    override suspend fun delete() {
        messaging.isAutoInitEnabled = false
        messaging.deleteToken().await()
    }
}

/** Who turned push on here, kept in the app's private preferences. */
internal class SharedPreferencesPushPreference(context: Context) : PushPreference {
    private val prefs = context.getSharedPreferences("push", Context.MODE_PRIVATE)

    override var enabledFor: String?
        get() = prefs.getString(KEY, null)
        set(value) {
            prefs.edit { if (value == null) remove(KEY) else putString(KEY, value) }
        }

    private companion object {
        const val KEY = "enabled_for"
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        if (task.isSuccessful) {
            continuation.resume(task.result)
        } else {
            continuation.resumeWithException(task.exception ?: IllegalStateException("FCM task failed"))
        }
    }
}
