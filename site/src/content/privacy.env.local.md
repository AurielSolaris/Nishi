# Privacy

## Website

The website serves static pages and local assets. It includes no analytics, third-party trackers, cookies, or browser-storage code. A hosting provider may keep ordinary request logs. The repository, source, release, and issue links take you to GitHub, where GitHub’s own policies apply.

`privacy.env.local` is the display name for this public document.

## Desktop editor

Nishi reads the files and folders you open and writes files when you save. Draft recovery stores unsaved text in the local journal at `~/.nishi/kotlin-journal/`, which can contain sensitive buffer contents. Treat this folder as you would your source files and use your operating system’s normal controls to protect access to your account and disk.

Language-server detection inspects the local environment and project paths to find a suitable command. The current Kotlin workbench does not connect to a language server. The checked-in Gradle wrapper may download build dependencies when you build or run from source.
