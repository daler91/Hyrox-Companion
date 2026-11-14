package com.fitai.coach.ui.shell

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The offline and sync banner (OfflineIndicator). */
class SyncBannerTest {
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
