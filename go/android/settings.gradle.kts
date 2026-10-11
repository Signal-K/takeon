pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google(); mavenCentral()
        // takeon.aar is the gomobile build output: `go/scripts/build.sh android` writes it to go/dist.
        flatDir { dirs("../dist") }
    }
}
rootProject.name = "takeon-android"
include(":takeon-kotlin")
