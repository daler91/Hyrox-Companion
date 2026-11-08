package com.fitai.coach.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.fitai.coach.ui.theme.FitaiTheme

/** What a signed-in user sees. The privacy notice and navigation shell replace this (Phase 3, steps 5–6). */
@Composable
fun SignedInRoot() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("signed in", style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
    }
}
