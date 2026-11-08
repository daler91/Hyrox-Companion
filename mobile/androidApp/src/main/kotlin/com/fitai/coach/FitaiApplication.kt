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
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
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
            modules(appModule)
        }
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
}
