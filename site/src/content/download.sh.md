# Run Nishi from source

The Kotlin editor is in early development. GitHub currently lists no published releases for Nishi. The source checkout and its Gradle wrapper are the available installation path.

## Requirements

- Git and a JDK. The build targets Java 17. The project README records a verification run with JDK 25.
- Windows is the tested platform. The macOS and Linux commands below are documented in the repository and remain unverified on those platforms.

## Run the editor

Clone the [Nishi repository](https://github.com/AurielSolaris/Nishi) and change into the checkout.

```bash
git clone https://github.com/AurielSolaris/Nishi.git
cd Nishi
```

On Windows, from PowerShell:

```powershell
.\gradlew.bat :desktop:run
```

On macOS or Linux:

```bash
./gradlew :desktop:run
```

## Build a local distribution

```powershell
.\gradlew.bat :desktop:installDist
```

Use `./gradlew :desktop:installDist` with the Unix wrapper. The distribution is generated in `desktop/build/install/desktop/`.

[View the GitHub releases page](https://github.com/AurielSolaris/Nishi/releases) · [Read the editor documentation](/docs/)
