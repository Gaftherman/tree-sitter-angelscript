# tree-sitter-angelscript

AngelScript grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter).

## Features

- **100% Specification Alignment**: Full coverage of AngelScript syntax rules, keywords, attributes, and preprocessor directives.
- **100% Test Pass Rate**: All 169/169 unit test corpus suites pass clean.
- **High Performance**: Native C external scanner for template disambiguation and EOL recovery (~13,200 bytes/ms parse speed).
- **Editor Support**: Included LSP query files for syntax highlighting (`highlights.scm`) and symbol navigation (`tags.scm`).

## References

- [Official AngelScript Language Manual](https://www.angelcode.com/angelscript/sdk/docs/manual/index.html)
- [EBNF Grammar Specification](./grammar.ebnf)

## Usage

### Building

To generate the C parser from `grammar.js`:

```sh
npx tree-sitter generate
```

### Testing

To run the unit test corpus:

```sh
npx tree-sitter test
```

## Related

| Project | Use |
| --- | --- |
| [angelscript-lsp](https://github.com/angelscript-tools/angelscript-lsp) | Language server and VS Code extension |
| [angelscript-cli](https://github.com/angelscript-tools/angelscript-cli) | Run, check and debug scripts from the terminal |
| [angelscript-mcp](https://github.com/angelscript-tools/angelscript-mcp) | MCP server so AI agents check and navigate scripts |
| [angelscript-agent-kit](https://github.com/angelscript-tools/angelscript-agent-kit) | Skill and one-step installs for Claude Code, Codex, Gemini CLI and Antigravity |
| [angelscript-dap](https://github.com/angelscript-tools/angelscript-dap) | Debugger core (Debug Adapter Protocol) |
| [angelscript-debugger-example](https://github.com/angelscript-tools/angelscript-debugger-example) | A host that shows how to embed the debugger |
| [angelscript-jit](https://github.com/angelscript-tools/angelscript-jit) | Optional JIT compiler |
| [angelscript-engine](https://github.com/angelscript-tools/angelscript-engine) | Patched SDK builds for AngelScript 2.20 to 2.39 |

## Acknowledgements

Special thanks to [Relrin](https://github.com/Relrin) for creating the original [tree-sitter-angelscript](https://github.com/Relrin/tree-sitter-angelscript) repository which served as the foundation for this project.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
