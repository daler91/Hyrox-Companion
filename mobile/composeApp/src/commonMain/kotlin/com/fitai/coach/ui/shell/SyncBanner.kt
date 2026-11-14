package com.fitai.coach.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fitai.coach.core.data.SyncEvent
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.launch

/** What the sync banner says (OfflineIndicator); none while all is sent. */
sealed interface SyncBanner {
    /** No network: [pending] writes wait for it. */
    data class Offline(val pending: Int) : SyncBanner

    /** Online, but [pending] writes have waited a while (the server keeps failing them). */
    data class Waiting(val pending: Int) : SyncBanner

    /** Back online, and the [count] writes that waited went. */
    data class Synced(val count: Int) : SyncBanner
}

/**
 * Which banner shows: offline first, then what just went after reconnecting
 * ([justSynced]), then writes that are [stuck]. The app sends every change
 * through the outbox, so a write waiting a moment online is normal and shows
 * nothing.
 */
fun syncBanner(online: Boolean, pending: Int, stuck: Boolean, justSynced: Int?): SyncBanner? = when {
    !online -> SyncBanner.Offline(pending)
    justSynced != null -> SyncBanner.Synced(justSynced)
    stuck && pending > 0 -> SyncBanner.Waiting(pending)
    else -> null
}

/** "1 change", "3 changes". */
fun changesText(count: Int): String = "$count change${if (count == 1) "" else "s"}"

/** The banner's line and, offline with writes waiting, the line under it (the web's copy). */
fun syncBannerText(banner: SyncBanner): Pair<String, String?> = when (banner) {
    is SyncBanner.Offline ->
        "You're offline" to
            banner.pending.takeIf { it > 0 }?.let { "${changesText(it)} will sync when you reconnect" }
    is SyncBanner.Waiting -> "Sync pending - ${changesText(banner.pending)} waiting" to null
    is SyncBanner.Synced -> "Back online — ${changesText(banner.count)} synced" to null
}

/**
 * What went once the network came back (OfflineIndicator's "Back online"):
 * each send that took writes queued while offline, given to [onSynced].
 * Worked out from the flows themselves, not from the screen's recomposition,
 * so a send that lands the moment the network returns still counts. Writes
 * that were dropped instead of sent stop counting a few seconds after the
 * outbox empties.
 */
suspend fun watchReconnectSyncs(online: Flow<Boolean>, pending: Flow<Int>, events: Flow<SyncEvent>, onSynced: (Int) -> Unit) {
    coroutineScope {
        val waited = MutableStateFlow(false)
        launch {
            combine(online, pending, ::Pair).collectLatest { (isOnline, count) ->
                if (!isOnline && count > 0) waited.value = true
                if (isOnline && count == 0) {
                    delay(SETTLE_MS)
                    waited.value = false
                }
            }
        }
        events.filterIsInstance<SyncEvent.Synced>().collect { event ->
            if (waited.getAndUpdate { false }) onSynced(event.count)
        }
    }
}

/**
 * Across the top of the app (OfflineIndicator): offline, and how many changes
 * will go on reconnecting; what went once back online, for a few seconds;
 * and changes still waiting after a while online.
 */
@Composable
fun SyncStatusBanner(session: UserSession) {
    val online by session.online.collectAsStateWithLifecycle()
    val pending by session.sync.pendingCount.collectAsStateWithLifecycle(0)
    var stuck by remember { mutableStateOf(false) }
    var justSynced by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(online, pending > 0) {
        stuck = false
        if (online && pending > 0) {
            delay(STUCK_AFTER_MS)
            stuck = true
        }
    }
    LaunchedEffect(session) {
        watchReconnectSyncs(session.online, session.sync.pendingCount, session.sync.events) { justSynced = it }
    }
    LaunchedEffect(justSynced) {
        if (justSynced == null) return@LaunchedEffect
        delay(SYNCED_SHOWS_MS)
        justSynced = null
    }
    syncBanner(online, pending, stuck, justSynced)?.let { SyncBannerRow(it) }
}

@Composable
private fun SyncBannerRow(banner: SyncBanner) {
    val colors = FitaiTheme.colors
    val (container: Color, content: Color, icon: ImageVector) = when (banner) {
        is SyncBanner.Offline -> Triple(colors.danger, colors.onDanger, LucideIcons.WifiOff)
        is SyncBanner.Waiting -> Triple(colors.warning, colors.onWarning, LucideIcons.CloudUpload)
        is SyncBanner.Synced -> Triple(colors.success, colors.onSuccess, LucideIcons.CircleCheck)
    }
    val (line, detail) = syncBannerText(banner)
    Row(
        Modifier
            .fillMaxWidth()
            .background(container)
            .padding(horizontal = Spacing.Lg, vertical = Spacing.Sm)
            // Informational, not an alert: work goes on being queued.
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
        Column {
            Text(line, style = FitaiTheme.typography.label, color = content)
            detail?.let { Text(it, style = FitaiTheme.typography.bodySm, color = content) }
        }
    }
}

/** A write still waiting this long online is news (normally it goes within a second). */
private const val STUCK_AFTER_MS = 5_000L

/** How long after the outbox empties online a send can still count as the one that took what waited. */
private const val SETTLE_MS = 5_000L

/** How long "Back online — N changes synced" stays (the web's 3.5 s). */
private const val SYNCED_SHOWS_MS = 3_500L
