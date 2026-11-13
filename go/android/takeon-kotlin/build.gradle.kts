plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.signalk.takeon.kotlin"
    compileSdk = 34
    defaultConfig {
        minSdk = 24 // matches `gomobile bind -androidapi 24`
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // The wrapper compiles against the gomobile AAR but does not repackage it:
    // the consuming app adds `implementation(name = "takeon", ext = "aar")` itself.
    compileOnly(mapOf("name" to "takeon", "ext" to "aar"))
    androidTestImplementation(mapOf("name" to "takeon", "ext" to "aar"))
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
