package com.fitai.coach.ui.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.data.AnalyticsRepository
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class MafTrendState(val tests: GetMafTestsResponse? = null, val loading: Boolean = true, val failed: Boolean = false)

/** The MAF tests, shown from the device at once and refreshed (MafTrendTab). */
@Suppress("TooGenericExceptionCaught")
class MafTrendViewModel(private val analytics: AnalyticsRepository) : ViewModel() {
    private val status = MutableStateFlow(Status(loading = true))

    val state: StateFlow<MafTrendState> = combine(analytics.mafTests, status) { tests, st ->
        // A failed fetch is not "no tests yet": with nothing on the device it shows as an error.
        MafTrendState(tests, loading = tests == null && st.loading, failed = tests == null && st.failed)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), MafTrendState())

    init {
        retry()
    }

    fun retry() {
        status.value = Status(loading = true)
        viewModelScope.launch {
            val ok = try {
                analytics.refreshMafTests()
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                false
            }
            status.value = Status(failed = !ok)
        }
    }

    private data class Status(val loading: Boolean = false, val failed: Boolean = false)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}

/** MAF ceiling compliance and pace across tagged MAF tests, with the test history. */
@Composable
fun MafTrendPanel(timeZone: String?, distanceUnit: String?) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "maf-trend-${session.userId}") { MafTrendViewModel(session.analytics) }
    val state by vm.state.collectAsStateWithLifecycle()
    val tests = state.tests
    when {
        state.failed -> ErrorState("Couldn't load your MAF tests", onRetry = vm::retry)
        tests == null -> LoadingState(Modifier.fillMaxWidth())
        else -> MafTrend(tests, timeZone, distanceUnit)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MafTrend(tests: GetMafTestsResponse, timeZone: String?, distanceUnit: String?) {
    val rows = remember(tests, timeZone) { mafRows(tests, timeZone) }
    if (rows.isEmpty()) {
        EmptyState(
            title = "No MAF tests yet",
            message = "Run a fixed distance or time at your MAF heart-rate ceiling, then open that workout and tag it as a MAF test. " +
                "Your compliance trend builds here over time.",
        )
        return
    }
    val colors = FitaiTheme.colors
    val compliance = remember(tests, timeZone) { mafComplianceTrend(tests, timeZone) }
    val pace = remember(rows, distanceUnit) { mafPaceTrend(rows, distanceUnit) }
    val latest = rows.first()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiBadge(mafCountLabel(rows.size))
            mafLatestLabel(latest)?.let { FitaiBadge(it, tone = mafClassification(latest.classification).second) }
        }
        latest.date?.let { lastUpdatedNote(mafTestDate(it), stale = false) }?.let {
            Text(it, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
        FitaiCard(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                ChartTitle("MAF ceiling compliance (%)")
                if (compliance.isLine()) {
                    LineChart(listOf(LineSeries("Compliance", compliance, SeriesColor.Green)), "MAF ceiling compliance (%)")
                } else {
                    Text(
                        "Log at least two MAF tests with heart-rate data to see your compliance trend.",
                        style = FitaiTheme.typography.bodySm,
                        color = colors.textMuted,
                    )
                }
                if (pace.isLine()) {
                    val label = "Pace (min/${if (distanceUnit == "miles") "mi" else "km"}) — lower is faster"
                    ChartTitle(label)
                    LineChart(listOf(LineSeries("Pace", pace, SeriesColor.Blue)), label, format = ::formatSplit)
                }
            }
        }
        FitaiCard(Modifier.fillMaxWidth()) {
            ChartTitle("Test history")
            rows.forEachIndexed { i, row ->
                if (i > 0) HorizontalDivider(color = colors.border)
                TestRow(row, distanceUnit)
            }
        }
    }
}

@Composable
private fun TestRow(row: MafRow, distanceUnit: String?) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(Modifier.fillMaxWidth().padding(vertical = Spacing.Sm), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(mafTestDate(row.date), style = type.label, color = colors.text)
            mafRowDetail(row, distanceUnit).takeIf { it.isNotEmpty() }?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
        }
        if (row.compliancePct == null) {
            Text("No HR data", style = type.bodySm, color = colors.textMuted)
        } else {
            val (label, tone) = mafClassification(row.classification)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text("${row.compliancePct}%", style = type.body, color = colors.text)
                FitaiBadge(label, tone = tone)
            }
        }
    }
}
