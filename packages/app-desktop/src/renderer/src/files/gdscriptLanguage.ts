import type * as Monaco from "monaco-editor";

const KEYWORDS = [
  "if", "elif", "else", "for", "while", "match", "when", "break", "continue", "pass", "return", "class", "class_name",
  "extends", "is", "in", "as", "self", "super", "signal", "func", "static", "const", "enum", "var", "breakpoint",
  "preload", "await", "yield", "assert", "void", "not", "and", "or", "PI", "TAU", "INF", "NAN", "true", "false", "null",
];

const TYPES = [
  "bool", "int", "float", "String", "StringName", "NodePath", "Array", "Dictionary", "Variant", "Callable", "Signal",
  "Vector2", "Vector2i", "Vector3", "Vector3i", "Vector4", "Vector4i", "Rect2", "Rect2i", "Transform2D", "Transform3D",
  "Plane", "Quaternion", "AABB", "Basis", "Projection", "Color", "RID", "Object",
  "PackedByteArray", "PackedInt32Array", "PackedInt64Array", "PackedFloat32Array", "PackedFloat64Array",
  "PackedStringArray", "PackedVector2Array", "PackedVector3Array", "PackedColorArray",
];

/** Monaco has no GDScript grammar, so `.gd` files get this one. Godot's language server adds the rest. */
export function registerGdscript(monaco: typeof Monaco): void {
  monaco.languages.register({ id: "gdscript", extensions: [".gd"], aliases: ["GDScript"] });
  monaco.languages.setLanguageConfiguration("gdscript", {
    comments: { lineComment: "#" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    onEnterRules: [{ beforeText: /:\s*(#.*)?$/, action: { indentAction: monaco.languages.IndentAction.Indent } }],
    folding: { offSide: true },
  });
  monaco.languages.setMonarchTokensProvider("gdscript", {
    keywords: KEYWORDS,
    types: TYPES,
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/@[a-zA-Z_]\w*/, "annotation"],
        [/\$("[^"]*"|[\w/]+)/, "variable.predefined"],
        [/%[\w/]+/, "variable.predefined"],
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@types": "type", "@default": "identifier" } }],
        [/\d+\.\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?/, "number.float"],
        [/0[xX][0-9a-fA-F_]+/, "number.hex"],
        [/0[bB][01_]+/, "number.binary"],
        [/\d[\d_]*/, "number"],
        [/&?"""/, "string", "@tripleDouble"],
        [/&?"/, "string", "@double"],
        [/&?'/, "string", "@single"],
        [/[{}()[\]]/, "@brackets"],
        [/[=+\-*/%<>!&|^~]+/, "operator"],
      ],
      tripleDouble: [
        [/"""/, "string", "@pop"],
        [/./, "string"],
      ],
      double: [
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
        [/[^"\\]+/, "string"],
      ],
      single: [
        [/\\./, "string.escape"],
        [/'/, "string", "@pop"],
        [/[^'\\]+/, "string"],
      ],
    },
  });
}
