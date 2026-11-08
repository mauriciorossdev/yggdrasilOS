import { describe, expect, it } from "vitest";
import { imageAt } from "./monacoImageHover.js";

describe("imageAt", () => {
  const line = "Texto ![Diagrama de panes](assets/diagrama.png) y más ![otra](b.png \"título\")";

  it("finds the image under the cursor and its column range", () => {
    const hit = imageAt(line, 12);
    expect(hit).toMatchObject({ alt: "Diagrama de panes", src: "assets/diagrama.png" });
    expect(line.slice(hit!.start - 1, hit!.end - 1)).toBe("![Diagrama de panes](assets/diagrama.png)");
  });

  it("tells the second image apart and ignores a title in quotes", () => {
    expect(imageAt(line, 62)).toMatchObject({ alt: "otra", src: "b.png" });
  });

  it("is undefined outside any image, and for plain links", () => {
    expect(imageAt(line, 2)).toBeUndefined();
    expect(imageAt("un [enlace](a.png) normal", 8)).toBeUndefined();
    expect(imageAt("", 1)).toBeUndefined();
  });
});
