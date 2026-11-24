plugins {
    kotlin("jvm")
    application
}

dependencies {
    implementation(project(":editor-core"))
    implementation(project(":workspace-io"))
    implementation("com.github.weisj:jsvg:2.2.0")
    testImplementation(kotlin("test-junit"))
}

application {
    mainClass = "dev.nishi.desktop.MainKt"
}

distributions {
    main {
        contents {
            from(rootProject.files("LICENSE", "LICENSE-MIT", "NOTICE.md", "THIRD_PARTY_LICENSE.md")) {
                into("licenses")
            }
        }
    }
}
