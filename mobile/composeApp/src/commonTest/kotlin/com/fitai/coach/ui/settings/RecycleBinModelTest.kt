package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.RecycleBinItem
import kotlin.test.Test
import kotlin.test.assertEquals

class RecycleBinModelTest {
    @Test
    fun theBinCountsDaysInTheAthletesCalendar() {
        assertEquals("expires today", expiryCopy("2026-11-13", "2026-11-13"))
        assertEquals("expires tomorrow", expiryCopy("2026-11-14", "2026-11-13"))
        assertEquals("expires in 87 days", expiryCopy("2027-02-08", "2026-11-13"))
        assertEquals("Deleted today", deletedCopy("2026-11-13", "2026-11-13"))
        assertEquals("Deleted yesterday", deletedCopy("2026-11-12", "2026-11-13"))
        assertEquals("Deleted 3 days ago", deletedCopy("2026-11-10", "2026-11-13"))

        val item = ApiJson.decodeFromString(
            RecycleBinItem.serializer(),
            """{"id":"r1","entityType":"workout_log","entityId":"w1","label":"Tempo run","entityDate":"2026-11-09","childCount":3,""" +
                """"deletedAt":"2026-11-10T23:30:00Z","expiresAt":"2027-02-08T23:30:00Z"}""",
        )
        // Deleted at 23:30 UTC is already the 11th in Berlin.
        assertEquals("Nov 9 · Deleted 2 days ago · expires in 88 days", recycleBinMeta(item, "2026-11-13", "Europe/Berlin"))
        assertEquals("Workout", recycleBinTypeLabel(item.entityType))
    }

    @Test
    fun aRestoreSaysWhatCouldNotComeBackAndWhyOneWasRefused() {
        assertEquals("Restored", restoredMessage(emptyList()))
        assertEquals("Restored Its plan day is gone.", restoredMessage(listOf("Its plan day is gone.")))
        assertEquals(
            "Can't restore this plan yet. Another plan already covers these dates. Archive that one first.",
            restoreFailure(ApiException(409, "PLAN_OVERLAP", "Another plan already covers 2026-11-01")),
        )
        assertEquals("That item has expired", restoreFailure(ApiException(404, "NOT_FOUND", "That item has expired")))
        assertEquals("1 item deleted forever", emptiedMessage(1))
        assertEquals("4 items deleted forever", emptiedMessage(4))
    }
}
