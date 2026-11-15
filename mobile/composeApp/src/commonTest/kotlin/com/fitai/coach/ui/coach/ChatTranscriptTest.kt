package com.fitai.coach.ui.coach

import kotlin.test.Test
import kotlin.test.assertEquals

class ChatTranscriptTest {
    @Test
    fun aDayIsTodayYesterdayOrItsDateWithTheYearWhenItIsntThisOne() {
        assertEquals("Today", chatDayLabel("2026-11-18", "2026-11-18"))
        assertEquals("Yesterday", chatDayLabel("2026-11-17", "2026-11-18"))
        assertEquals("Tue, Sep 29", chatDayLabel("2026-09-29", "2026-11-18"))
        assertEquals("Mon, Dec 29, 2025", chatDayLabel("2025-12-29", "2026-01-02"))
    }

    @Test
    fun eachDaysFirstMessageHasTheDayAboveItAndTheGreetingNone() {
        val items = listOf(
            welcomeItem(),
            ChatItem("a", ChatRole.User, "hi", sentAt = "2026-11-17T09:00:00Z"),
            ChatItem("b", ChatRole.Assistant, "hello", sentAt = "2026-11-17T09:01:00Z"),
            ChatItem("c", ChatRole.User, "again", sentAt = "2026-11-18T07:00:00Z"),
        )

        val rows = buildTranscript(items, "2026-11-18") { it.take(10) }

        assertEquals(
            listOf("message welcome", "day Yesterday", "message a", "message b", "day Today", "message c"),
            rows.map { if (it is TranscriptRow.Day) "day ${it.label}" else "message ${(it as TranscriptRow.Message).item.id}" },
        )
    }
}
