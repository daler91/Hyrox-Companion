// Generates the app's Baseline Profile and measures startup and jank with
// Macrobenchmark, on a Gradle Managed Device (an emulator Gradle downloads
// and runs; .github/workflows/mobile-performance.yml). Locally:
//   ./gradlew :androidApp:generateBaselineProfile   (writes androidApp/src/release/generated/baselineProfiles)
//   ./gradlew :baselineprofile:pixel6Api34BenchmarkReleaseAndroidTest
// Both need a machine that can run an emulator (KVM). Signing in, for the
// journeys past the sign-in screen, takes a Clerk development instance's
// test account: -Pandroid.testInstrumentationRunnerArguments.fitaiTestEmail=…+clerk_test@…
plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "com.fitai.coach.baselineprofile"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        // Baseline Profile generation needs API 28 or later.
        minSdk = 28
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    targetProjectPath = ":androidApp"

    testOptions.managedDevices.localDevices {
        create("pixel6Api34") {
            device = "Pixel 6"
            apiLevel = 34
            // AOSP images can be rooted, which profile generation needs.
            systemImageSource = "aosp"
        }
    }
}

baselineProfile {
    managedDevices += "pixel6Api34"
    useConnectedDevices = false
}

dependencies {
    implementation(libs.androidx.test.junit)
    implementation(libs.androidx.uiautomator)
    implementation(libs.androidx.benchmark.macro.junit4)
}
