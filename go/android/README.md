# takeon-android (Kotlin wrapper over takeon.aar)

`takeon-kotlin` wraps the gomobile `com.signalk.takeon.mobile.Engine` with a Kotlin API
(`TakeonEngine`: `step` -> events, `order`, `orderMine`, `bank`, `missionProgress`, `window`, `snapshot`/`restore`).

```bash
export ANDROID_HOME=...   # SDK with platform 34 + NDK
../scripts/build.sh android          # writes ../dist/takeon.aar (this module compiles against it via flatDir)
./gradlew :takeon-kotlin:assembleDebug
./gradlew :takeon-kotlin:connectedDebugAndroidTest   # needs an arm64/x86_64 emulator or device
```

The library does not repackage the AAR; the consuming app adds `implementation(name = "takeon", ext = "aar")`.
`TakeonEngineInstrumentedTest` proves `libgojni.so` loads and the engine steps, mines and reports mission progress.
A JVM unit test is not possible: the AAR's native libraries only run on Android.
The Go engine is not goroutine-safe: call it from one thread.
