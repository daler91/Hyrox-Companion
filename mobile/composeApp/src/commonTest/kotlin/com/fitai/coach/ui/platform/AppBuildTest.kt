package com.fitai.coach.ui.platform

import kotlin.test.Test
import kotlin.test.assertEquals

class AppBuildTest {
    @Test
    fun aTestBuildShowsItsLabelAfterTheVersion() {
        assertEquals("Version 0.1.0 · test build #42 (abc1234)", AppBuild("0.1.0", "test build #42 (abc1234)").description)
    }

    @Test
    fun aReleaseShowsJustItsVersion() {
        assertEquals("Version 1.2.0", AppBuild("1.2.0").description)
    }

    @Test
    fun nothingShowsWhenThePlatformDidntSay() {
        assertEquals("", AppBuild().description)
    }
}
