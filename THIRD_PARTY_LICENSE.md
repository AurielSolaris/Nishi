# Third-party licenses

This inventory covers the Kotlin desktop distribution and checked-in build tooling. Each component retains its upstream license.

## Desktop distribution

| Component | Version | License | Upstream |
| --- | --- | --- | --- |
| Lucide static icons | 1.34.0 | ISC, with MIT attribution for Feather portions | [Lucide](https://github.com/lucide-icons/lucide) |
| JSVG | 2.2.0 | MIT | [JSVG](https://github.com/weisj/jsvg) |
| Kotlin standard library | 2.4.21 | Apache-2.0 | [Kotlin](https://github.com/JetBrains/kotlin) |
| JetBrains Java Annotations | 13.0 | Apache-2.0 | [JetBrains Java Annotations](https://github.com/JetBrains/java-annotations) |
| TextMate grammars | Pinned revisions | Upstream licenses | [Grammar provenance and notices](editor-core/src/main/resources/dev/nishi/editor/grammars/UPSTREAM.md) |
| Eclipse TM4E Java core | 0.15.1 | EPL-2.0 | [Eclipse TM4E](https://github.com/eclipse-tm4e/tm4e) |
| Joni and JCodings | 2.2.6 / 1.0.63 | MIT | [Joni](https://github.com/jruby/joni) · [JCodings](https://github.com/jruby/jcodings) |
| Gson and Error Prone Annotations | 2.13.1 / 2.38.0 | Apache-2.0 | [Gson](https://github.com/google/gson) · [Error Prone](https://github.com/google/error-prone) |

The full [Lucide notice](desktop/src/main/resources/dev/nishi/desktop/icons/LICENSE-LUCIDE) is bundled in the desktop JAR alongside the SVGs. The JSVG JAR includes its upstream license at `META-INF/LICENSE`. The editor-core JAR bundles the grammar notices and the [TM4E license](editor-core/src/main/resources/dev/nishi/editor/grammars/LICENSE-tm4e). The desktop distribution includes the [Apache-2.0 text](LICENSE) under `licenses/`.

## Build tooling

The checked-in [Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html) is distributed under Apache-2.0. The Kotlin Gradle plugin is part of the Apache-2.0-licensed [Kotlin project](https://github.com/JetBrains/kotlin).

The dependency notices for the TypeScript release remain in [that revision’s license inventory](https://github.com/AurielSolaris/Nishi/blob/c27f6785973c2a5c3f89e7b268d39f9ae6cabecc/THIRD_PARTY_LICENSE.md).
