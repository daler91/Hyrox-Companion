package com.fitai.coach.push

import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.push.PushRegistration
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

/** FCM's entry point: token rotations, and notifications that arrive while the app is open. */
class FitaiMessagingService : FirebaseMessagingService() {
    private val push: PushRegistration by inject()
    private val auth: AuthGateway by inject()
    private val scope = CoroutineScope(SupervisorJob())

    override fun onNewToken(token: String) {
        val userId = (auth.state.value as? AuthState.SignedIn)?.userId
        scope.launch { push.onNewToken(token, userId) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        showNotification(
            context = this,
            id = (message.messageId ?: message.sentTime.toString()).hashCode(),
            message = PushMessage(
                title = notification.title ?: "fitai.coach",
                body = notification.body.orEmpty(),
                url = message.data["url"],
                category = message.data["category"] ?: notification.channelId,
            ),
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
