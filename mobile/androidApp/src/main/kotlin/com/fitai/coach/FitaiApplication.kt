package com.fitai.coach

import android.app.Application
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
import com.fitai.coach.ui.uiModule
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.SupervisorJob
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
        startKoin {
            androidContext(this@FitaiApplication)
            modules(appModule, uiModule)
        }
        // Opens the signed-in user's database and outbox, and closes them when
        // they go. Off the main thread: refreshes decode whole timelines.
        get<SessionManager>().start(CoroutineScope(SupervisorJob() + Dispatchers.Default))
    }
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
