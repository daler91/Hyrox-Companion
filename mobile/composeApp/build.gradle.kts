plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

kotlin {
    // A JVM target runs commonTest (view-model logic) without Robolectric, and
    // keeps Android-only APIs out of commonMain until the iOS targets join.
    jvm()

    android {
        namespace = "com.fitai.coach.ui"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
        androidResources { enable = true }
        // Host (JVM) tests run the Roborazzi screenshot tests under Robolectric;
        // Compose resources (the fonts) load as Android resources there.
        withHostTest { isIncludeAndroidResources = true }
    }

    jvmToolchain(21)

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core"))
            implementation(libs.compose.runtime)
            implementation(libs.compose.foundation)
            implementation(libs.compose.ui)
            implementation(libs.compose.material3)
            implementation(libs.compose.components.resources)
            implementation(libs.compose.ui.tooling.preview)
            implementation(libs.jb.lifecycle.viewmodel.compose)
            implementation(libs.jb.lifecycle.runtime.compose)
            implementation(libs.koin.compose)
            implementation(libs.koin.compose.viewmodel)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
        getByName("androidHostTest").dependencies {
            implementation(libs.junit4)
            implementation(libs.robolectric)
            implementation(libs.roborazzi)
            implementation(libs.roborazzi.compose)
        }
    }
}

// Robolectric runs offline: Gradle downloads its Android runtime jar as a
// verified dependency (gradle/verification-metadata.xml) instead of Robolectric
// fetching it from Maven Central at test time. The version is the one
// Robolectric maps to @Config(sdk = [35]); it changes with Robolectric upgrades.
val robolectricRuntime by configurations.creating
dependencies {
    robolectricRuntime(libs.robolectric.android.all)
}
val robolectricJars = tasks.register<Sync>("robolectricJars") {
    from(robolectricRuntime)
    into(layout.buildDirectory.dir("robolectric-jars"))
}
val robolectricJarsDir = layout.buildDirectory.dir("robolectric-jars").map { it.asFile.absolutePath }
tasks.withType<Test>().configureEach {
    dependsOn(robolectricJars)
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", robolectricJarsDir.get())
}

compose.resources {
    packageOfResClass = "com.fitai.coach.ui.resources"
    publicResClass = false
    generateResClass = always
}

// Reference screenshots live in the repository: `recordRoborazzi…` rewrites
// them, `verifyRoborazzi…` (CI) fails when a render differs.
roborazzi {
    outputDir.set(file("src/androidHostTest/snapshots"))
}
