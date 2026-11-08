package com.fitai.coach.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.fitai.coach.MainActivity
import com.fitai.coach.R

/**
 * The notification channels, one per kind the server sends
 * (server/fcm.ts PushCategory), so an athlete can mute one kind without the
 * others. Their ids are the server's category names.
 */
internal enum class PushChannel(val id: String, val title: String, val description: String) {
    Training("training", "Training reminders", "Today's session, missed workouts and your weekly review"),
    Coach("coach", "Coach", "Messages and plan changes from your AI coach"),
    Nutrition("nutrition", "Nutrition", "Meal and fuelling reminders"),
    ;

    companion object {
        fun forCategory(category: String?): PushChannel = entries.firstOrNull { it.id == category } ?: Training
    }
}

internal fun createNotificationChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannels(
        PushChannel.entries.map { channel ->
            NotificationChannel(channel.id, channel.title, NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = channel.description
            }
        },
    )
}

/** A notification from the server: what it says, the app path a tap opens, and its kind. */
internal data class PushMessage(val title: String, val body: String, val url: String?, val category: String?)

/**
 * Shows a notification that arrived while the app was in the foreground
 * (FCM shows the others itself). Tapping it opens the app on the server's
 * path, which MainActivity checks is one of the app's own screens.
 */
internal fun showNotification(context: Context, id: Int, message: PushMessage) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    val open = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        message.url?.let { putExtra(MainActivity.EXTRA_NOTIFICATION_URL, it) }
    }
    val tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(context, PushChannel.forCategory(message.category).id)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(message.title)
        .setContentText(message.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(message.body))
        .setContentIntent(tap)
        .setAutoCancel(true)
        .build()
    try {
        manager.notify(id, notification)
    } catch (_: SecurityException) {
        // The permission was withdrawn between the check and the post.
    }
}
