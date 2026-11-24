# Benchmarks

Startup and process-tree memory measurements are pending. The project has no verified comparison figures to publish.

| Workload | Metric | Result |
| --- | --- | --- |
| Empty workspace, cold launch | Time until the editor accepts input | Pending |
| Same workspace, warm launch | Time until the editor accepts input | Pending |
| Fixed workspace and files, after settling | Process-tree resident memory | Pending |

## Measurement protocol

1. Record the CPU, physical RAM, storage, OS build, JDK vendor and version, JVM flags, and exact editor builds or commits. Keep the power mode and background conditions fixed.
2. Record the workspace revision, files and sizes, enabled features, extensions, and launch commands. Use the same workload for every editor.
3. Define a cold run as the first launch after a reboot. Start the timer when the editor process is launched and stop when the workbench responds to a repeatable input. For a warm run, fully exit the editor and its helpers, then relaunch without rebooting. Record the number of trials and publish the median and range for each run type.
4. After a stated settling interval with the same files open, record working set on Windows for the editor process tree, including relevant helper processes. State the sampler and interval, and disclose shared-page double counting when summing process working sets. Report resident memory and any JVM heap measurements separately.
5. Publish the raw measurements, setup and collection commands alongside the summary.

> Keep pending rows visible until measurements and the collection method can be published together.
