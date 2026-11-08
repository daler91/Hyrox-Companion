package com.fitai.coach.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.fitai.coach.MainActivity
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.core.widget.TodayCard
import com.fitai.coach.core.widget.todayCard
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.koin.core.context.GlobalContext

/**
 * "Today's session" on the home screen. It reads the timeline the app keeps
 * in Room, so it needs no network and holds no credentials; tapping it opens
 * the app.
 */
class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val card = loadCard()
        provideContent { GlanceTheme { Card(card) } }
    }

    private suspend fun loadCard(): TodayCard {
        val sessions = GlobalContext.get().get<SessionManager>()
        // A process started for the widget opens the signed-in user's database first.
        val session = withTimeoutOrNull(SESSION_WAIT_MS) { sessions.session.filterNotNull().first() } ?: return TodayCard.SignedOut
        val timeZone = session.preferences.preferences.first()?.userTimezone
        return todayCard(session.timeline.entries.first(), todayIn(timeZone))
    }

    private companion object {
        const val SESSION_WAIT_MS = 3_000L
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

@Composable
private fun Card(card: TodayCard) {
    val colors = GlanceTheme.colors
    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(colors.widgetBackground)
            .cornerRadius(16.dp)
            .padding(14.dp)
            .clickable(actionStartActivity<MainActivity>()),
    ) {
        Text(
            if (card.state == TodayCard.State.Done) "Today · done" else "Today",
            style = TextStyle(color = colors.onSurfaceVariant, fontSize = 12.sp),
        )
        Spacer(GlanceModifier.height(4.dp))
        Text(card.title, maxLines = 2, style = TextStyle(color = colors.onSurface, fontSize = 17.sp, fontWeight = FontWeight.Bold))
        card.detail?.let {
            Spacer(GlanceModifier.height(4.dp))
            Text(it, maxLines = 3, style = TextStyle(color = colors.onSurfaceVariant, fontSize = 13.sp))
        }
        if (card.more > 0) {
            Spacer(GlanceModifier.height(4.dp))
            Text("+${card.more} more today", style = TextStyle(color = colors.primary, fontSize = 12.sp))
        }
    }
}
