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

// Firebase Cloud Messaging identifies the app by these values from the
// Firebase console (Project settings → Your apps). They are public, like the
// Clerk key, but per project, so they come from the build too:
// `fitai.firebase.<name>` or FIREBASE_<NAME>. Without them push is off and
// Settings says so.
fun firebase(name: String, env: String): String =
    providers.gradleProperty("fitai.firebase.$name").orElse(providers.environmentVariable(env)).getOrElse("")
val firebaseAppId = firebase("appId", "FIREBASE_APP_ID")
val firebaseApiKey = firebase("apiKey", "FIREBASE_API_KEY")
val firebaseProjectId = firebase("projectId", "FIREBASE_PROJECT_ID")
val firebaseSenderId = firebase("senderId", "FIREBASE_SENDER_ID")
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
        buildConfigField("String", "FIREBASE_APP_ID", "\"$firebaseAppId\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"$firebaseApiKey\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"$firebaseProjectId\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"$firebaseSenderId\"")
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
    implementation(libs.firebase.messaging)
    implementation(libs.glance.appwidget)
}
