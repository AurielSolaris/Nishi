import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension

plugins {
    kotlin("jvm") version "2.4.21" apply false
}

subprojects {
    repositories {
        mavenCentral()
        ivy {
            name = "EclipseTm4e"
            url = uri("https://download.eclipse.org/tm4e/releases/0.15.1/plugins/")
            patternLayout { artifact("[artifact]_[revision].[ext]") }
            metadataSources { artifact() }
            content { includeModule("org.eclipse", "org.eclipse.tm4e.core") }
        }
    }

    plugins.withId("org.jetbrains.kotlin.jvm") {
        extensions.configure<KotlinJvmProjectExtension> {
            compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
        }
    }
    plugins.withType<JavaPlugin> {
        extensions.configure<JavaPluginExtension> {
            sourceCompatibility = JavaVersion.VERSION_17
            targetCompatibility = JavaVersion.VERSION_17
        }
    }
}
