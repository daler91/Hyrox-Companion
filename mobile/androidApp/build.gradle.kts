import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.play.publisher)
    alias(libs.plugins.baselineprofile)
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

// Release versioning comes from CI (.github/workflows/mobile-release.yml),
// which derives both from the mobile-v<major>.<minor>.<patch> tag; local
// builds stay at 0.1.0 (1).
val appVersionName: String = providers.gradleProperty("fitai.versionName")
    .orElse(providers.environmentVariable("APP_VERSION_NAME"))
    .getOrElse("0.1.0")
val appVersionCode: Int = providers.gradleProperty("fitai.versionCode")
    .orElse(providers.environmentVariable("APP_VERSION_CODE"))
    .getOrElse("1")
    .toInt()

// The upload key (Play App Signing re-signs with the app signing key Google
// holds). CI decodes it from a secret; without it a release build is left
// unsigned, which is all a local or PR build needs.
val uploadKeystore: String? = providers.environmentVariable("ANDROID_UPLOAD_KEYSTORE").orNull
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
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "CLERK_PUBLISHABLE_KEY", "\"$clerkPublishableKey\"")
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
        manifestPlaceholders["appLinkHost"] = appLinkHost
        buildConfigField("String", "FIREBASE_APP_ID", "\"$firebaseAppId\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"$firebaseApiKey\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"$firebaseProjectId\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"$firebaseSenderId\"")
    }

    signingConfigs {
        if (uploadKeystore != null) {
            create("upload") {
                storeFile = file(uploadKeystore)
                storePassword = providers.environmentVariable("ANDROID_UPLOAD_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_UPLOAD_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_UPLOAD_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            if (uploadKeystore != null) signingConfig = signingConfigs.getByName("upload")
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

    lint {
        // targetSdk 36 is what Play requires of new apps and updates now
        // (docs/mobile-play-console.md); moving to 37 is its own change,
        // tested against Android 17's behaviour changes.
        disable += "OldTargetApi"
    }
}

// Gradle Play Publisher: CI uploads the release bundle to the internal track
// and promotes it from there (mobile-release.yml, mobile-promote.yml). The
// service account's JSON key comes from ANDROID_PUBLISHER_CREDENTIALS.
play {
    defaultToAppBundles.set(true)
    track.set("internal")
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
    implementation(libs.health.connect.client)
    implementation(libs.work.runtime.ktx)
    // Installs the Baseline Profile (compiled ahead of time) where Play's cloud profiles don't reach.
    implementation(libs.androidx.profileinstaller)
    baselineProfile(project(":baselineprofile"))
}

// The profile is generated on demand (it needs an emulator), then committed
// under src/release/generated/baselineProfiles; release builds only read it.
baselineProfile {
    automaticGenerationDuringBuild = false
    dexLayoutOptimization = true
}
