package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.AthleteFact
import com.fitai.coach.core.api.generated.PatchAthleteFactsByIdRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AthleteCardModelTest {
    private fun fact(id: String, reviewOn: String = "2099-01-01", active: Boolean = true, category: String = "constraint") =
        ApiJson.decodeFromString(
            AthleteFact.serializer(),
            """{"id":"$id","userId":"u1","fact":"Fact $id","dedupeKey":"$id","category":"$category","source":"athlete",""" +
                """"active":$active,"reviewOn":"$reviewOn","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}""",
        )

    @Test
    fun factsDueForACheckComeFirstOldestFirstThenTheRestAsStated() {
        val card = groupAthleteFacts(
            listOf(
                fact("a"),
                fact("b", reviewOn = "2026-11-10"),
                fact("c", active = false),
                fact("d", reviewOn = "2026-11-13"),
                fact("e", reviewOn = "2026-10-01"),
            ),
            today = "2026-11-13",
        )

        assertEquals(listOf("e", "b", "d", "a"), card.active.map { it.id })
        assertEquals(listOf("c"), card.retired.map { it.id })
        assertTrue(isAthleteFactDue("2026-11-13", "2026-11-13"))
        assertFalse(isAthleteFactDue("2026-11-14", "2026-11-13"))
        assertFalse(card.atCap)
        assertTrue(groupAthleteFacts((1..MAX_ACTIVE_ATHLETE_FACTS).map { fact("f$it") }, "2026-11-13").atCap)
    }

    @Test
    fun anEditSendsOnlyWhatChanged() {
        val stated = fact("a")
        assertNull(FactEdit.of(stated).changes(stated))
        assertNull(FactEdit.of(stated).copy(text = "  Fact a ").changes(stated))

        val reworded = FactEdit.of(stated).copy(text = " Bad left knee ").changes(stated)
        assertEquals(PatchAthleteFactsByIdRequest(fact = "Bad left knee"), reworded)

        val moved = FactEdit.of(stated).copy(category = AthleteFact.Category.Equipment).changes(stated)
        assertEquals(PatchAthleteFactsByIdRequest(category = PatchAthleteFactsByIdRequest.Category.Equipment), moved)
    }

    @Test
    fun theCardSaysWhatHappenedInTheWebsWords() {
        assertEquals("Kept on your athlete card", updatedFactMessage(PatchAthleteFactsByIdRequest(confirm = true)))
        assertEquals("Fact retired", updatedFactMessage(PatchAthleteFactsByIdRequest(active = false)))
        assertEquals("Fact restored", updatedFactMessage(PatchAthleteFactsByIdRequest(active = true)))
        assertEquals("Fact updated", updatedFactMessage(PatchAthleteFactsByIdRequest(fact = "x")))

        assertEquals("Note added to your athlete card", importedNoteMessage(added = 3, skipped = 0))
        assertEquals(
            "Your card is full. Added 2 of 5. Your note stays until you retire facts to make room for the rest.",
            importedNoteMessage(added = 2, skipped = 3),
        )
        // A category from a newer server reads as Other, and is never sent back.
        assertEquals("Other", athleteFactCategoryLabel(fact("a", category = "medical").category))
        assertEquals("Injury or limit", athleteFactCategoryLabel(AthleteFact.Category.Constraint))
    }
}
