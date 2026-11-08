package com.fitai.coach.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.components.NexusMark
import com.fitai.coach.ui.theme.FitaiTheme

/** The app's root composable, shared by every platform's entry point. */
@Composable
fun App() {
    FitaiTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = FitaiTheme.colors.background) {
            Box(contentAlignment = Alignment.Center) {
                NexusMark(size = 96.dp)
            }
        }
    }
}
