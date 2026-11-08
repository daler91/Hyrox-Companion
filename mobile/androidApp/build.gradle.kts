import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Clerk's publishable key identifies the Clerk instance and is public, but it
// differs per environment, so it comes from the build: the Gradle property
// `fitai.clerkPublishableKey` (e.g. in ~/.gradle/gradle.properties) or the
// CLERK_PUBLISHABLE_KEY environment variable. `fitai.apiBaseUrl` points a build
// at another server, e.g. http://10.0.2.2:5000 for a local one from the emulator.
val clerkPublishableKey: String = providers.gradleProperty("fitai.clerkPublishableKey")
    .orElse(providers.environmentVariable("CLERK_PUBLISHABLE_KEY"))
    .getOrElse("")
val apiBaseUrl: String = providers.gradleProperty("fitai.apiBaseUrl").getOrElse("https://fitai.coach")
// The domain whose links open in the app (App Links); the API server's by default.
val appLinkHost: String = providers.gradleProperty("fitai.appLinkHost").getOrElse(URI(apiBaseUrl).host)

android {
    namespace = "com.fitai.coach"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        // Permanent once published (docs/mobile-app-plan.md, open decisions).
        applicationId = "com.fitai.coach"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "CLERK_PUBLISHABLE_KEY", "\"$clerkPublishableKey\"")
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        manifestPlaceholders["appLinkHost"] = appLinkHost
    }

    buildTypes {
        release {
            // R8 shrinks and obfuscates the release build. The libraries ship
            // their own keep rules (kotlinx.serialization, Room, Ktor, Koin,
            // Clerk); proguard-rules.pro holds what they don't cover.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":composeApp"))
    implementation(project(":core"))
    implementation(libs.androidx.activity.compose)
    implementation(libs.clerk.android.api)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.koin.android)
    implementation(libs.play.app.update.ktx)
}
