# Third-party licenses

This inventory covers the Kotlin desktop distribution and checked-in build tooling. Each component retains its upstream license.

## Desktop distribution

| Component | Version | License | Upstream |
| --- | --- | --- | --- |
| Lucide static icons | 1.34.0 | ISC, with MIT attribution for Feather portions | [Lucide](https://github.com/lucide-icons/lucide) |
| JSVG | 2.2.0 | MIT | [JSVG](https://github.com/weisj/jsvg) |
| Kotlin standard library | 2.4.21 | Apache-2.0 | [Kotlin](https://github.com/JetBrains/kotlin) |
| JetBrains Java Annotations | 13.0 | Apache-2.0 | [JetBrains Java Annotations](https://github.com/JetBrains/java-annotations) |

The full [Lucide notice](desktop/src/main/resources/dev/nishi/desktop/icons/LICENSE-LUCIDE) is bundled in the desktop JAR alongside the SVGs. The JSVG JAR includes its upstream license at `META-INF/LICENSE`. The desktop distribution includes the [Apache-2.0 text](LICENSE) under `licenses/`.

## Build tooling

The checked-in [Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html) is distributed under Apache-2.0. The Kotlin Gradle plugin is part of the Apache-2.0-licensed [Kotlin project](https://github.com/JetBrains/kotlin).

The dependency notices for the TypeScript release remain in [that revision’s license inventory](https://github.com/AurielSolaris/Nishi/blob/c27f6785973c2a5c3f89e7b268d39f9ae6cabecc/THIRD_PARTY_LICENSE.md).
