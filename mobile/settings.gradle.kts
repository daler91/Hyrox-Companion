// The native app (docs/mobile-app-plan.md). Phase 2 has the `core` module only;
// Phase 3 adds `composeApp` and `androidApp`, and the Android and iOS targets.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "fitai-mobile"

include(":core")
