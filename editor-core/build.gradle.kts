plugins {
    kotlin("jvm")
}

dependencies {
    implementation("org.eclipse:org.eclipse.tm4e.core:0.15.1.202509041551")
    compileOnly("org.eclipse.jdt:org.eclipse.jdt.annotation:2.3.0")
    implementation("com.google.code.gson:gson:2.13.1")
    implementation("org.jruby.joni:joni:2.2.6")
    testImplementation(kotlin("test-junit"))
}
