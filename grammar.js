/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * @param {RuleOrLiteral} rule
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

/**
 * @param {RuleOrLiteral} rule
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

/**
 * The handle and array suffixes a type may carry: `T@`, `T[]`, `T@ const`, `T[][]`.
 *
 * A helper rather than a grammar rule because it can match nothing, and tree-sitter rejects a rule
 * that matches the empty string.
 *
 * @returns {RepeatRule}
 */
function typeSuffixes() {
  return repeat(choice(
    seq("[", "]"),
    seq("@", optional("const")),
  ));
}

module.exports = grammar({
  name: "angelscript",

  extras: $ => [
    /\s+/,
    $.comment,
    $.preproc_directive,
  ],

  word: $ => $.identifier,

  externals: $ => [
    $._template_open,
    $._template_close,
    $._error_sentinel,
  ],

  conflicts: $ => [
    // argument_list vs parameter_list: both match '(' ... ')'
    [$.parameter_list, $.argument_list],
    // identifier followed by '<' could be datatype + template_type_list or scope + template in scope chain
    [$.scoped_identifier, $.datatype],
    // lambda param `function(x, y)`: identifier can be untyped name or type of typed param
    [$.datatype, $.lambda_parameter_list],
    // `(void ...)` after identifier: parameter_list vs argument_list with void arg
    [$.argument_list, $.primitive_type],
    // `A::B` at statement start: type scope (var decl) vs expression scoped_identifier
    [$.scoped_identifier, $.scope],
    // extend scoped chain vs trailing '::' of type scope
    [$.scoped_identifier],
    // `T[` is an array suffix on a plain type until a `::` follows the `]`, at which point those
    // brackets were the array part of a nested name - `T[]::less` - all along.
    [$.type],
    // leading 'shared'/'external' modifiers: ambiguous until the following
    // keyword ('class'/'interface' vs 'enum'/'funcdef') disambiguates.
    [$.declaration_modifier, $.shared_external_modifier],
  ],

  rules: {
    // =========================================================================
    // SCRIPT (top-level)
    // =========================================================================
    script: $ => repeat(choice(
      $.metadata,
      $.import_declaration,
      $.enum_declaration,
      $.typedef_declaration,
      $.class_declaration,
      $.mixin_declaration,
      $.interface_declaration,
      $.funcdef_declaration,
      $.virtual_property,
      $.variable_declaration,
      $.func_declaration,
      $.namespace_declaration,
      $.using_declaration,
      ";",
    )),

    // =========================================================================
    // METADATA
    // =========================================================================
    // `[Property, Category="Weapons"]` before a declaration. CScriptBuilder collects the text
    // between the brackets, hands the declaration on without it, and exposes it to the host through
    // GetMetadataForType and friends - so a script full of metadata compiles, and a parser that
    // does not know the form turns each annotated declaration into an ERROR node and loses the
    // symbol, not just the annotation.
    //
    // Modelled as a sibling of the declaration it precedes rather than a field on it. CScriptBuilder
    // strips it the same way, and threading an optional field through the eight declaration rules
    // that can carry one would buy a structural link this grammar has no other use for. A consumer
    // that wants the association reads the preceding sibling.
    //
    // The entry forms are the ones the builder's own examples use: a bare name, a name with a
    // value, and a name with an argument list. Deliberately not "any balanced brackets", which
    // would need an external scanner and would swallow a mistyped index expression whole.
    metadata: $ => seq(
      "[",
      commaSep($._metadata_entry),
      "]",
    ),

    _metadata_entry: $ => choice(
      seq(field("name", $.identifier), "=", field("value", $._expression)),
      seq(field("name", $.identifier), field("arguments", $.argument_list)),
      field("name", $.identifier),
    ),

    // =========================================================================
    // IMPORT
    // =========================================================================
    import_declaration: $ => seq(
      "import",
      field("return_type", $.type),
      optional("&"),
      field("name", $.identifier),
      field("parameters", $.parameter_list),
      optional($.func_attributes),
      "from",
      field("source", $.string_literal),
      ";",
    ),

    // =========================================================================
    // USING
    // =========================================================================
    using_declaration: $ => seq(
      "using",
      "namespace",
      field("name", $.scoped_identifier),
      ";",
    ),

    // Plain identifier or scope-qualified: foo, ::foo, NS::foo, NS::T<int>::foo
    // Flat repeat: avoids early scope reduction on multi-level chains (A::B::c)
    scoped_identifier: $ => seq(
      optional("::"),
      $.identifier,
      repeat(seq("::", $.identifier, optional($.template_type_list))),
    ),

    // =========================================================================
    // NAMESPACE
    // =========================================================================
    namespace_declaration: $ => seq(
      "namespace",
      field("name", $.scoped_identifier),
      field("body", $.namespace_body),
    ),

    namespace_body: $ => seq(
      "{",
      repeat(choice(
        $.metadata,
        $.import_declaration,
        $.enum_declaration,
        $.typedef_declaration,
        $.class_declaration,
        $.mixin_declaration,
        $.interface_declaration,
        $.funcdef_declaration,
        $.virtual_property,
        $.variable_declaration,
        $.func_declaration,
        $.namespace_declaration,
        $.using_declaration,
        ";",
      )),
      "}",
    ),

    // =========================================================================
    // ENUM
    // =========================================================================
    enum_declaration: $ => seq(
      repeat(field("modifier", $.shared_external_modifier)),
      "enum",
      field("name", $.identifier),
      choice(
        ";",
        seq(
          // scoped enum with explicit underlying type (AS 2.31+)
          optional(seq(":", field("underlying_type", choice($.primitive_type, $.identifier)))),
          "{",
          commaSep($.enum_member),
          optional(","),
          "}",
        ),
      ),
    ),

    enum_member: $ => seq(
      field("name", $.identifier),
      optional(seq("=", field("value", $._expression))),
    ),

    // =========================================================================
    // TYPEDEF
    // =========================================================================
    // base_type admits an identifier as well as a primitive_type so that `typedef Entity Alias;`
    // parses. AngelScript accepts only a primitive there and its own parser answers "Unexpected
    // token '<identifier>'" for anything else - which names the shape of the mistake exactly, and
    // is the shape this admits so the analyzer can say it in a sentence instead.
    typedef_declaration: $ => seq(
      "typedef",
      field("base_type", choice($.primitive_type, $.identifier)),
      field("name", $.identifier),
      ";",
    ),

    // =========================================================================
    // CLASS
    // =========================================================================
    class_declaration: $ => seq(
      repeat(field("modifier", $.declaration_modifier)),
      "class",
      field("name", $.identifier),
      optional(field("template_params", $.template_parameter_list)),
      choice(
        ";",
        seq(
          optional($.base_class_list),
          field("body", $.class_body),
        ),
      ),
    ),

    base_class_list: $ => seq(
      ":",
      commaSep1(field("base", $.scoped_identifier)),
    ),

    class_body: $ => seq(
      "{",
      repeat(choice(
        $.metadata,
        $.virtual_property,
        $.func_declaration,
        $.variable_declaration,
        $.funcdef_declaration,
        // stray ';' after a member (e.g. `void Foo() {};`) is tolerated by
        // the real compiler, same as at script scope.
        ";",
      )),
      "}",
    ),

    // =========================================================================
    // MIXIN
    // =========================================================================
    mixin_declaration: $ => seq(
      "mixin",
      repeat(field("modifier", $.declaration_modifier)),
      "class",
      field("name", $.identifier),
      choice(
        ";",
        seq(
          optional($.base_class_list),
          field("body", $.class_body),
        ),
      ),
    ),

    // =========================================================================
    // INTERFACE
    // =========================================================================
    interface_declaration: $ => seq(
      repeat(field("modifier", $.shared_external_modifier)),
      "interface",
      field("name", $.identifier),
      choice(
        ";",
        seq(
          optional($.base_class_list),
          field("body", $.interface_body),
        ),
      ),
    ),

    interface_body: $ => seq(
      "{",
      repeat(choice(
        $.metadata,
        $.virtual_property,
        $.interface_method,
      )),
      "}",
    ),

    // func_attributes is accepted here and rejected semantically, not left out. AngelScript's own
    // parser refuses every one of override/final/explicit/property/delete on an interface method,
    // so leaving the production without them turns `void F() explicit;` into a generic syntax
    // error pointing at the token. Parsing it gives the analyzer a well formed tree to say
    // precisely what is wrong with, which is the whole difference between a parser and a language
    // server.
    interface_method: $ => seq(
      // The return type is optional, and a leading '~' is admitted, so that `IThing();` and
      // `~IThing();` parse as interface members. An interface may declare neither - AngelScript
      // answers "Expected identifier / Instead found '('" and "Expected data type / Instead found
      // '~'" - but naming the construct is worth more than refusing to parse it.
      optional(seq(field("return_type", $.type), optional("&"))),
      optional("~"),
      field("name", $.identifier),
      field("parameters", $.parameter_list),
      optional("const"),
      optional($.func_attributes),
      ";",
    ),

    // =========================================================================
    // FUNCDEF
    // =========================================================================
    // Same reasoning as interface_method: every func_attribute is invalid on a funcdef, and saying
    // so precisely is worth more than refusing to parse it.
    funcdef_declaration: $ => seq(
      repeat(field("modifier", $.shared_external_modifier)),
      "funcdef",
      field("return_type", $.type),
      optional("&"),
      field("name", $.identifier),
      field("parameters", $.parameter_list),
      optional($.func_attributes),
      ";",
    ),

    // =========================================================================
    // FUNC
    // =========================================================================
    func_declaration: $ => prec.dynamic(2, seq(
      repeat(field("modifier", $.shared_external_modifier)),
      optional(choice("private", "protected")),
      optional(
        choice(
          seq(field("return_type", $.type), optional("&")),
          "~",
        ),
      ),
      field("name", $.identifier),
      field("parameters", $.parameter_list),
      optional("const"),
      optional($.func_attributes),
      choice(";", field("body", $.statement_block)),
    )),

    func_attributes: _ => repeat1(
      choice("override", "final", "explicit", "property", "delete"),
    ),

    declaration_modifier: _ => choice("shared", "external", "abstract", "final"),

    // Strict subset for declarations that don't support 'abstract'/'final'
    // (funcdef, enum) per the AngelScript BNF.
    shared_external_modifier: _ => choice("shared", "external"),

    // =========================================================================
    // VIRTUAL PROPERTY
    // =========================================================================
    virtual_property: $ => prec.dynamic(3, seq(
      optional(choice("private", "protected")),
      field("prop_type", $.type),
      optional("&"),
      field("name", $.identifier),
      "{",
      repeat($.accessor),
      "}",
    )),

    accessor: $ => seq(
      field("kind", choice("get", "set")),
      optional("const"),
      optional($.func_attributes),
      choice(";", field("body", $.statement_block)),
    ),

    // =========================================================================
    // VAR — supports multiple declarators: int a = 1, b = 2, c;
    // =========================================================================
    variable_declaration: $ => prec.dynamic(1, seq(
      optional(choice("private", "protected")),
      field("var_type", $.type),
      $.variable_declarator,
      repeat(seq(",", $.variable_declarator)),
      ";",
    )),

    variable_declarator: $ => seq(
      field("name", $.identifier),
      optional(choice(
        seq("=", field("value", choice($.initializer_list, $.typed_initializer_list, $._expression))),
        field("arguments", $.argument_list),
      )),
    ),

    // =========================================================================
    // STATEMENT BLOCK (stub — expanded in Step 3)
    // =========================================================================
    statement_block: $ => seq(
      "{",
      repeat(choice(
        $.variable_declaration,
        $._statement,
        $.using_declaration,
      )),
      "}",
    ),

    _statement: $ => choice(
      $.if_statement,
      $.for_statement,
      $.foreach_statement,
      $.while_statement,
      $.do_while_statement,
      $.switch_statement,
      $.return_statement,
      $.break_statement,
      $.continue_statement,
      $.try_statement,
      $.statement_block,
      $.expression_statement,
      ";",
    ),

    expression_statement: $ => seq(
      $._expression,
      ";",
    ),

    return_statement: $ => seq(
      "return",
      optional(choice($.initializer_list, $.typed_initializer_list, $._expression)),
      ";",
    ),

    // =========================================================================
    // CONTROL FLOW STATEMENTS
    // =========================================================================

    // prec.right resolves dangling-else: else binds to innermost if
    if_statement: $ => prec.right(seq(
      "if", "(", $._expression, ")",
      field("consequence", $._statement),
      optional(seq("else", field("alternative", $._statement))),
    )),

    for_statement: $ => seq(
      "for", "(",
      field("init", choice($.variable_declaration, $.expression_statement, ";")),
      field("condition", choice($.expression_statement, ";")),
      field("update", optional(commaSep1($._expression))),
      ")",
      field("body", $._statement),
    ),

    foreach_statement: $ => seq(
      "foreach", "(",
      commaSep1($.foreach_variable),
      ":",
      field("collection", $._expression),
      ")",
      field("body", $._statement),
    ),

    foreach_variable: $ => seq(
      field("type", $.type),
      field("name", $.identifier),
    ),

    while_statement: $ => seq(
      "while", "(", $._expression, ")",
      field("body", $._statement),
    ),

    do_while_statement: $ => seq(
      "do",
      field("body", $._statement),
      "while", "(", $._expression, ")", ";",
    ),

    switch_statement: $ => seq(
      "switch", "(", $._expression, ")",
      "{", repeat($.case_clause), "}",
    ),

    case_clause: $ => seq(
      choice(seq("case", $._expression), "default"),
      ":",
      repeat(choice($.variable_declaration, $._statement)),
    ),

    break_statement: _ => seq("break", ";"),

    continue_statement: _ => seq("continue", ";"),

    try_statement: $ => seq(
      "try", $.statement_block,
      "catch", $.statement_block,
    ),

    // =========================================================================
    // PARAMETER LIST
    // =========================================================================
    parameter_list: $ => seq(
      "(",
      optional(commaSep1($.parameter)),
      ")",
    ),

    parameter: $ => seq(
      field("param_type", $.type),
      optional(seq("&", optional(choice("in", "out", "inout")))),
      choice(
        "...",
        seq(
          optional(field("name", $.identifier)),
          optional(seq("=", field("default_value", choice("void", $._expression)))),
        ),
      ),
    ),

    // =========================================================================
    // TYPE SYSTEM
    // =========================================================================
    type: $ => seq(
      optional("const"),
      optional($.scope),
      $.datatype,
      choice(
        // A plain name, with the usual handle and array suffixes.
        typeSuffixes(),

        // A declaration nested inside a template or an array type: `array<T>::less`, `T[]::less`.
        //
        // A template's nested declarations are named through the template itself, and the standard
        // array add-on does exactly this - it registers the funcdef `array<T>::less` for its sort
        // comparator, which predefined stubs spell `T[]::less`. Neither parsed before, because
        // `scope` reaches a qualifier through `scoped_identifier`, and that rule admits template
        // arguments only *after* a `::` and never an array suffix. `NS::array<T>::less` parsed;
        // the same name without a namespace in front did not.
        //
        // The nested name lives here, behind the arguments or the brackets, rather than being
        // added to `scope` - which is what keeps it unreachable for a bare `Foo::Bar`. That name
        // therefore keeps its existing scope-qualified shape as its only parse instead of becoming
        // ambiguous with a nested one, and it is why this is spelled as alternatives rather than
        // one optional tail on the end.
        seq($.template_type_list, optional($.nested_type_name), typeSuffixes()),
        seq(repeat1(seq("[", "]")), $.nested_type_name, typeSuffixes()),
      ),
    ),

    /** A `::`-qualified name reached through a template or array type: the `::less` of `T[]::less`. */
    nested_type_name: $ => repeat1(
      seq("::", $.identifier, optional($.template_type_list)),
    ),

    template_type_list: $ => seq(
      $._template_open,
      $.type,
      repeat(seq(",", $.type)),
      $._template_close,
    ),

    // Template parameters of a class declaration: `class array<T>`, `class map<K, V>`.
    //
    // Distinct from template_type_list, which carries the *arguments* at a use site and so holds
    // types. These are the parameters being introduced, and are plain identifiers - `class map<K,
    // V>` declares the names K and V, it does not refer to two existing types.
    //
    // The '<' and '>' come from the external scanner, the same tokens template_type_list uses, so
    // this inherits the disambiguation from a less-than comparison that the scanner already does.
    //
    // AngelScript scripts cannot declare template classes; the application registers them. They
    // appear in predefined stubs, which is where the engine's API is written down - `class array<T>`
    // is the first declaration in every one of them.
    template_parameter_list: $ => seq(
      $._template_open,
      field("param", $.identifier),
      repeat(seq(",", field("param", $.identifier))),
      $._template_close,
    ),

    // Scope chain for types: :: | ::? NS:: | ::? NS::T<int>::NS2:: ...
    // Reuses scoped_identifier shape (flat greedy) + trailing '::'
    scope: $ => choice(
      "::",
      seq($.scoped_identifier, "::"),
    ),

    datatype: $ => choice(
      $.identifier,
      $.primitive_type,
      "?",
      "auto",
    ),

    // =========================================================================
    // EXPRESSIONS — Full system with correct operator precedence
    //
    // Precedence table (low to high), per doc_script_precedence.md.
    // Note this deliberately differs from C: bitwise &|^ bind TIGHTER than
    // comparison/equality (avoids C's `a & b == c` gotcha), and xor/^^
    // shares a tier with equality/identity rather than sitting between
    // or and and.
    //   1  = += -= *= /= %= **= |= &= ^= <<= >>= >>>=  (right)
    //   2  ?: ternary                                     (right)
    //   3  || or                                          (left)
    //   4  && and                                         (left)
    //   5  == != is !is xor ^^                             (left)
    //   6  < <= > >=                                      (left)
    //   7  | (bitwise OR)                                 (left)
    //   8  ^ (bitwise XOR)                                (left)
    //   9  & (bitwise AND)                                (left)
    //  10  << >> >>>                                      (left)
    //  11  + - (binary)                                   (left)
    //  12  * / %                                          (left)
    //  13  ** (exponent)                                  (right)
    //  15  unary prefix: - + ! not ~ @ ++ --               (right)
    //  16  postfix: .member [index] () ++ --              (left)
    // =========================================================================
    _expression: $ => choice(
      $.assignment_expression,
      $.ternary_expression,
      $.binary_expression,
      $.unary_expression,
      $.postfix_expression,
      $.call_expression,
      $.member_expression,
      $.index_expression,
      $.functional_cast_expression,
      $.cast_expression,
      $.construct_call_expression,
      $.lambda_expression,
      $.parenthesized_expression,
      $.number_literal,
      $.concatenated_string,
      $.string_literal,
      $.boolean_literal,
      $.null_literal,
      $.this_expression,
      $.scoped_identifier,
    ),

    parenthesized_expression: $ => seq("(", choice($.typed_initializer_list, $._expression), ")"),

    // --- Assignment (prec 1, right-associative) ---
    assignment_expression: $ => prec.right(1, seq(
      field("left", $._expression),
      field("operator", choice(
        "=", "+=", "-=", "*=", "/=", "%=", "**=",
        "&=", "|=", "^=", "<<=", ">>=", ">>>=", "@=",
      )),
      // RHS may be brace init list: dict = {{'a', 1}} or typed init list: arr = array<int> = {1, 2}
      field("right", choice($.initializer_list, $.typed_initializer_list, $._expression)),
    )),

    // --- Ternary (prec 2, right-associative) ---
    ternary_expression: $ => prec.right(2, seq(
      field("condition", $._expression),
      "?",
      field("consequence", choice($.initializer_list, $.typed_initializer_list, $._expression)),
      ":",
      field("alternative", choice($.initializer_list, $.typed_initializer_list, $._expression)),
    )),

    // --- Binary operators (prec 3–13) ---
    binary_expression: $ => {
      const table = [
        // prec 3: logical OR
        ["||", 3],
        ["or", 3],
        // prec 4: logical AND
        ["&&", 4],
        ["and", 4],
        // prec 5: equality / identity / logical XOR (same tier in AngelScript)
        ["==", 5],
        ["!=", 5],
        ["is", 5],
        ["!is", 5],
        ["^^", 5],
        ["xor", 5],
        // prec 6: relational
        ["<", 6],
        [">", 6],
        ["<=", 6],
        [">=", 6],
        // prec 7: bitwise OR
        ["|", 7],
        // prec 8: bitwise XOR
        ["^", 8],
        // prec 9: bitwise AND
        ["&", 9],
        // prec 10: shift
        ["<<", 10],
        [">>", 10],
        [">>>", 10],
        // prec 11: additive
        ["+", 11],
        ["-", 11],
        // prec 12: multiplicative
        ["*", 12],
        ["/", 12],
        ["%", 12],
      ];

      return choice(
        ...table.map(([op, precedence]) =>
          prec.left(precedence, seq(
            field("left", $._expression),
            field("operator", op),
            field("right", $._expression),
          )),
        ),
        // prec 13: exponentiation (right-associative)
        prec.right(13, seq(
          field("left", $._expression),
          field("operator", "**"),
          field("right", $._expression),
        )),
      );
    },

    // --- Unary prefix (prec 15, right-associative) ---
    // Includes @ (handle-of operator). 'not' is the keyword form of '!'.
    unary_expression: $ => prec.right(15, seq(
      field("operator", choice("-", "+", "!", "not", "~", "@", "++", "--")),
      field("operand", $._expression),
    )),

    // --- Postfix (prec 16, left-associative) ---
    postfix_expression: $ => prec.left(16, seq(
      field("operand", $._expression),
      field("operator", choice("++", "--")),
    )),

    // --- Call expression (prec 16) ---
    // Handles both function calls and constructor calls (e.g. MyType(args)).
    // Constructor vs function distinction is semantic, not syntactic.
    call_expression: $ => prec.left(16, seq(
      field("function", $._expression),
      field("arguments", $.argument_list),
    )),

    // --- Member access (prec 16) ---
    member_expression: $ => prec.left(16, seq(
      field("object", $._expression),
      ".",
      field("member", $.identifier),
    )),

    // --- Index expression with optional named indexing (prec 16) ---
    // Supports: a[0], a[key: value], a[k1: v1, k2: v2]
    index_expression: $ => prec.left(16, seq(
      field("object", $._expression),
      "[",
      commaSep1(seq(
        optional(seq(field("index_name", $.identifier), ":")),
        field("index", $._expression),
      )),
      "]",
    )),

    // --- Cast expression ---
    // Uses external scanner tokens to disambiguate < > from comparison operators
    functional_cast_expression: $ => prec.left(16, seq(
      field("type", $.primitive_type),
      "(",
      field("value", $._expression),
      ")",
    )),

    cast_expression: $ => seq(
      "cast",
      $._template_open,
      field("type", $.type),
      $._template_close,
      "(",
      field("value", $._expression),
      ")",
    ),

    // --- Constructor call with explicit template args: array<int>(args) ---
    // Requires template_type_list so plain Type(args) stays call_expression.
    construct_call_expression: $ => seq(
      optional($.scope),
      field("type", $.datatype),
      $.template_type_list,
      field("arguments", $.argument_list),
    ),

    // --- Lambda expression ---
    // EBNF LAMBDA: params may omit type: function(x) { ... }
    lambda_expression: $ => seq(
      "function",
      field("parameters", $.lambda_parameter_list),
      field("body", $.statement_block),
    ),

    lambda_parameter_list: $ => seq(
      "(",
      commaSep1(seq(
        optional(seq(
          field("param_type", $.type),
          optional(seq("&", optional(choice("in", "out", "inout")))),
        )),
        optional(field("name", $.identifier)),
      )),
      ")",
    ),

    // =========================================================================
    // INITIALIZER LIST & ARGUMENT LIST
    // =========================================================================
    // initializer_list is NOT in _expression to avoid {}-vs-statement_block
    // ambiguity. It is reachable from variable_declaration and return_statement
    // RHS. Nesting works via choice($.initializer_list, $._expression).
    _initializer_element: $ => choice(
      $.initializer_list,
      $.typed_initializer_list,
      $._expression,
    ),

    // An element may be omitted, taking the type's default: `{ 0, 1, , 4, 5 }` compiles, and so do
    // a leading hole `{ , 1 }` and a trailing comma `{ 1, }` - which is the same production, an
    // omitted last element. commaSep has no empty alternative, so every one of those turned the
    // enclosing declaration into an ERROR node.
    //
    // Written with the comma as the anchor rather than as commaSep(optional(element)): the latter
    // can match nothing, and then `{ }` has two derivations - the whole list absent, or present
    // with one empty element - which is an ambiguity rather than a choice.
    initializer_list: $ => seq(
      "{",
      optional(choice(
        seq($._initializer_element, repeat(seq(",", optional($._initializer_element)))),
        repeat1(seq(",", optional($._initializer_element))),
      )),
      "}",
    ),

    // Anonymous typed list construction used as a value, e.g. a dictionary
    // entry: {"key", array<string> = {"a", "b"}}
    typed_initializer_list: $ => seq(
      field("type", $.type),
      "=",
      field("value", $.initializer_list),
    ),

    // Supports named arguments: foo(arg1: val1, arg2: val2)
    // and brace init lists as arguments: foo({1, 2})
    argument_list: $ => seq(
      "(",
      commaSep(seq(
        optional(seq(field("arg_name", $.identifier), ":")),
        // 'void' argument: func(void) — ignores an output value
        choice($.initializer_list, $.typed_initializer_list, "void", $._expression),
      )),
      ")",
    ),

    // =========================================================================
    // LITERALS
    // =========================================================================
    boolean_literal: _ => choice("true", "false"),

    null_literal: _ => "null",

    this_expression: _ => "this",

    // Adjacent string literals concatenate implicitly: "a" "b" == "ab"
    concatenated_string: $ => prec.left(seq(
      $.string_literal,
      repeat1($.string_literal),
    )),

    string_literal: _ => token(choice(
      // Triple-quoted heredoc strings (no escape processing, multiline)
      seq('"""', /([^"]|"[^"]|""[^"])*/, '"""'),
      // Single and double quoted strings with escape sequences
      seq("'", repeat(choice(/[^'\\]/, /\\./)), "'"),
      seq('"', repeat(choice(/[^"\\]/, /\\./)), '"'),
    )),

    // AngelScript supports single quotes as digit separators in numeric literals across all bases.
    // Because single quotes also delimit string literals, the rule must be strict: separators are
    // only permitted between valid digits of the given base, never at the start, end, or doubled.
    number_literal: _ => {
      const hex = /0[xX][0-9a-fA-F]+('[0-9a-fA-F]+)*/;
      const octal = /0[oO][0-7]+('[0-7]+)*/;
      const binary = /0[bB][01]+('[01]+)*/;
      const explicit_decimal = /0[dD][0-9]+('[0-9]+)*/;
      const decimal_float = choice(
        /[0-9]+('[0-9]+)*\.[0-9]*([eE][+-]?[0-9]+)?[fFdD]?/,
        /[0-9]*\.[0-9]+('[0-9]+)*([eE][+-]?[0-9]+)?[fFdD]?/,
        /[0-9]+('[0-9]+)*[eE][+-]?[0-9]+[fFdD]?/,
        /[0-9]+('[0-9]+)*[fFdD]/,
      );
      const decimal_int = /[0-9]+('[0-9]+)*/;
      return token(choice(hex, octal, binary, explicit_decimal, decimal_float, decimal_int));
    },

    // =========================================================================
    // PRIMITIVES
    // =========================================================================
    primitive_type: _ => choice(
      "void", "int", "int8", "int16", "int32", "int64", "uint",
      "uint8", "uint16", "uint32", "uint64", "float", "double", "bool",
    ),

    comment: _ => token(choice(
      seq("//", /(\\+(.|\r?\n)|[^\\\n])*/),
      seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),
    )),

    // Preprocessor directive: one full line starting with '#', e.g.
    // #include "file.as", #if EDITOR, #ifdef WITH_SERVER, #else, #endif,
    // #pragma, etc.
    preproc_directive: _ => token(seq("#", /[^\r\n]*/)),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
  },
});
