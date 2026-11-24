plugins {
    kotlin("jvm")
}

dependencies {
    implementation(project(":editor-core"))
    testImplementation(kotlin("test-junit"))
}
