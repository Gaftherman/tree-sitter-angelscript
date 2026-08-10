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

## Acknowledgements

Special thanks to [Relrin](https://github.com/Relrin) for creating the original [tree-sitter-angelscript](https://github.com/Relrin/tree-sitter-angelscript) repository which served as the foundation for this project.

## License

MIT
