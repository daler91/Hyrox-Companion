package com.fitai.coach

import android.app.Application
import androidx.glance.appwidget.updateAll
import com.clerk.api.Clerk
import com.fitai.coach.auth.ClerkAuth
import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiConfig
import com.fitai.coach.core.api.AppIdentity
import com.fitai.coach.core.api.createHttpClient
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthTokenProvider
import com.fitai.coach.core.data.AndroidUserDatabaseStore
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.push.PushRegistration
import com.fitai.coach.push.FcmTokens
import com.fitai.coach.push.SharedPreferencesPushPreference
import com.fitai.coach.push.createNotificationChannels
import com.fitai.coach.push.startFirebase
import com.fitai.coach.ui.uiModule
import com.fitai.coach.widget.TodayWidget
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import org.koin.android.ext.android.get
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.dsl.binds
import org.koin.dsl.module

class FitaiApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // The publishable key is public (it identifies the Clerk instance);
        // it comes from the build, never from source (see androidApp/build.gradle.kts).
        Clerk.initialize(this, BuildConfig.CLERK_PUBLISHABLE_KEY)
        createNotificationChannels(this)
        val pushAvailable = startFirebase(this)
        startKoin {
            androidContext(this@FitaiApplication)
            modules(appModule, uiModule, pushModule(pushAvailable))
        }
        // Opens the signed-in user's database and outbox, and closes them when
        // they go. Off the main thread: refreshes decode whole timelines.
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        get<SessionManager>().start(scope)
        refreshWidgetOnTimelineChange(scope)
    }
}

/** The home-screen widget follows the stored timeline, and the signed-in user. */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
private fun FitaiApplication.refreshWidgetOnTimelineChange(scope: CoroutineScope) {
    val sessions = get<SessionManager>()
    scope.launch {
        sessions.session
            .flatMapLatest { session -> session?.timeline?.entries?.map { } ?: flowOf(Unit) }
            .debounce(WIDGET_REFRESH_DEBOUNCE_MS)
            .collect { runCatching { TodayWidget().updateAll(this@refreshWidgetOnTimelineChange) } }
    }
}

private const val WIDGET_REFRESH_DEBOUNCE_MS = 1_000L

private fun pushModule(available: Boolean) = module {
    single { PushRegistration(get(), if (available) FcmTokens() else null, SharedPreferencesPushPreference(androidContext())) }
}

private val appModule = module {
    single<CoroutineScope> { MainScope() }
    single { ClerkAuth(get()) } binds arrayOf(AuthGateway::class, AuthTokenProvider::class)
    single {
        ApiConfig(
            baseUrl = BuildConfig.API_BASE_URL,
            identity = AppIdentity(platform = "android", version = BuildConfig.VERSION_NAME),
        )
    }
    single { createHttpClient(OkHttp.create(), get(), get<AuthTokenProvider>()) }
    single { ApiClient(get()) }
    single {
        SessionManager(
            auth = get(),
            databases = AndroidUserDatabaseStore(androidContext()),
            api = get(),
            online = NetworkMonitor(androidContext()).online,
        )
    }
}
