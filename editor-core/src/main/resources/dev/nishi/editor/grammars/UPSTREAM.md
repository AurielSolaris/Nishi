# TextMate grammars

The grammar files use their original scope names as resource names so includes and injections can find one another.

| Upstream | Pinned revision | Files |
| --- | --- | --- |
| [VS Code 1.105.1](https://github.com/microsoft/vscode/tree/7d842fb85a0275a4a8e4d7e040d2625abbf7f084/extensions) | `7d842fb85a0275a4a8e4d7e040d2625abbf7f084` | Grammar contributions under `bat`, `css`, `go`, `groovy`, `html`, `java`, `javascript`, `json`, `markdown-basics`, `python`, `rust`, `scss`, `shellscript`, and `typescript-basics` |
| [fwcd/vscode-kotlin](https://github.com/fwcd/vscode-kotlin/tree/4a7c1538754828c1d22a8bee8ff3400045b4352a/syntaxes) | `4a7c1538754828c1d22a8bee8ff3400045b4352a` | Kotlin and its Markdown code-fence injection |

The VS Code license and relevant excerpts from its third-party notices accompany the grammar files. The Kotlin grammar comes with its upstream MIT license. Nishi adjusts one Markdown strikethrough assertion so Joni can evaluate the same delimiter check without a backreference inside a lookbehind.

The JVM tokenizer uses the [Eclipse TM4E 0.15.1 Java core](https://download.eclipse.org/tm4e/releases/0.15.1/) artifact `org.eclipse.tm4e.core_0.15.1.202509041551.jar` under EPL-2.0. Its SHA-256 is `6041f276f9d23c05a19d6f2048708a5a8230bdefe19af4ad180dfb60cfdc4267`. The full license is in `LICENSE-tm4e`.
