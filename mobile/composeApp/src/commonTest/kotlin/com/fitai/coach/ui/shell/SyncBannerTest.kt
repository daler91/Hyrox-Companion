package com.fitai.coach.ui.shell

import com.fitai.coach.core.data.SyncEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The offline and sync banner (OfflineIndicator). */
@OptIn(ExperimentalCoroutinesApi::class)
class SyncBannerTest {
    private val online = MutableStateFlow(true)
    private val pending = MutableStateFlow(0)
    private val events = MutableSharedFlow<SyncEvent>()
    private val synced = mutableListOf<Int>()

    private fun TestScope.watch() {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { watchReconnectSyncs(online, pending, events) { synced += it } }
    }

    @Test
    fun aSendThatLandsTheMomentTheNetworkReturnsCountsAsWhatWaited() = runTest {
        watch()
        online.value = false
        pending.value = 1

        // Back online, and the queued write goes before anything else has run.
        online.value = true
        events.emit(SyncEvent.Synced(1))
        pending.value = 0

        assertEquals(listOf(1), synced)
    }

    @Test
    fun anEverydaySendOnlineSaysNothing() = runTest {
        watch()
        pending.value = 1
        events.emit(SyncEvent.Synced(1))
        pending.value = 0

        assertEquals(emptyList(), synced)
    }

    @Test
    fun writesDroppedAfterReconnectingDontLabelALaterSend() = runTest {
        watch()
        online.value = false
        pending.value = 1
        online.value = true
        // Dropped, not sent: the outbox empties with no send.
        pending.value = 0
        advanceTimeBy(6_000)

        pending.value = 1
        events.emit(SyncEvent.Synced(1))

        assertEquals(emptyList(), synced)
    }

    @Test
    fun offlineComesFirstThenWhatJustWentThenWritesThatAreStuck() {
        assertEquals(SyncBanner.Offline(2), syncBanner(online = false, pending = 2, stuck = true, justSynced = 3))
        assertEquals(SyncBanner.Synced(3), syncBanner(online = true, pending = 1, stuck = true, justSynced = 3))
        assertEquals(SyncBanner.Waiting(1), syncBanner(online = true, pending = 1, stuck = true, justSynced = null))
    }

    @Test
    fun aWriteWaitingAMomentOnlineShowsNothing() {
        assertNull(syncBanner(online = true, pending = 1, stuck = false, justSynced = null))
        assertNull(syncBanner(online = true, pending = 0, stuck = true, justSynced = null))
    }

    @Test
    fun itSaysWhatWaitsInTheWebsWords() {
        assertEquals("You're offline" to null, syncBannerText(SyncBanner.Offline(0)))
        assertEquals("You're offline" to "1 change will sync when you reconnect", syncBannerText(SyncBanner.Offline(1)))
        assertEquals("Sync pending - 3 changes waiting" to null, syncBannerText(SyncBanner.Waiting(3)))
        assertEquals("Back online — 2 changes synced" to null, syncBannerText(SyncBanner.Synced(2)))
    }
}
