import { describe, expect, it } from "vitest";
import { callSignature, looksUnfinished, resolveGuards, trailingRepeats } from "./loop-guards.js";

describe("looksUnfinished", () => {
  it("flags an announced action that trails off or shows the command", () => {
    expect(looksUnfinished("Voy a ejecutar un comando para borrar los temporales:")).toBe(true);
    expect(looksUnfinished("This is destructive.\n\nTo clean the project, I will run:\n\n```sh\nfind . -name '*.tmp' -delete\n```")).toBe(true);
    expect(looksUnfinished("Let me check the file…")).toBe(true);
    expect(looksUnfinished("Primero voy a leer el archivo...")).toBe(true);
  });

  it("leaves real answers alone", () => {
    expect(looksUnfinished("El puerto es 48213.")).toBe(false);
    expect(looksUnfinished("He creado el archivo notes.txt con el contenido pedido.")).toBe(false);
    expect(looksUnfinished("Voy a explicarte cómo funciona: el gateway recibe el mensaje y lo pasa al harness.")).toBe(false);
    expect(looksUnfinished("Listo. Ejecuté los tests y pasan. Ahora voy a resumir: todo está correcto.")).toBe(false);
    expect(looksUnfinished("I will not be able to do that because the file is read-only.")).toBe(false);
    expect(looksUnfinished("")).toBe(false);
  });

  it("only looks at the closing stretch of a long reply", () => {
    const longDone = `Voy a empezar por el principio: ${"detalle ".repeat(200)}\n\nEn resumen, el trabajo está completado.`;
    expect(looksUnfinished(longDone)).toBe(false);
  });
});

describe("callSignature / trailingRepeats", () => {
  it("ignores argument order and counts consecutive repeats including the new call", () => {
    const a = callSignature("run", '{"b":2,"a":1}');
    expect(a).toBe(callSignature("run", '{"a":1,"b":2}'));
    expect(trailingRepeats([], a)).toBe(1);
    expect(trailingRepeats([a, a], a)).toBe(3);
    expect(trailingRepeats([a, "x", a], a)).toBe(2);
  });
  it("copes with unparsable arguments", () => {
    expect(callSignature("run", "{not json")).toBe('run:"{not json"');
  });
});

describe("resolveGuards", () => {
  it("is all on by default, all off for false, and merges partial overrides", () => {
    expect(resolveGuards(undefined)).toMatchObject({ retryEmpty: true, repeatLimit: 3 });
    expect(resolveGuards(false)).toEqual({ retryEmpty: false, nudgeUnannounced: false, summarizeOnLimit: false, repeatLimit: 0 });
    expect(resolveGuards({ repeatLimit: 5 })).toMatchObject({ retryEmpty: true, repeatLimit: 5 });
  });
});
