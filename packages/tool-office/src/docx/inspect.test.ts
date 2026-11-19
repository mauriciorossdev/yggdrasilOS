import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inspectDocxLossy } from "./inspect.js";
import { modelToDocx } from "./write.js";

async function withPart(data: Uint8Array, name: string, content: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data);
  zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}
async function withBody(data: Uint8Array, extra: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", xml.replace("</w:body>", `${extra}</w:body>`));
  return zip.generateAsync({ type: "uint8array" });
}

const plain = () => modelToDocx({ blocks: [{ type: "heading", level: 1, runs: [{ text: "Hi" }, { text: "!", bold: true }] }, { type: "list", ordered: true, items: [{ runs: [{ text: "a" }] }] }] });

describe("inspectDocxLossy", () => {
  it("reports nothing for a document made only of what the model keeps", async () => {
    expect(await inspectDocxLossy(await plain())).toEqual([]);
  });

  it("ignores empty headers/footers and the separator-only footnotes Word always writes", async () => {
    let data: Uint8Array = await plain();
    data = await withPart(data, "word/header1.xml", "<w:hdr><w:p><w:r><w:t></w:t></w:r></w:p></w:hdr>");
    data = await withPart(data, "word/footnotes.xml", '<w:footnotes><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotes>');
    expect(await inspectDocxLossy(data)).toEqual([]);
  });

  it("names what would be lost", async () => {
    let data: Uint8Array = await plain();
    data = await withPart(data, "word/header1.xml", "<w:hdr><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>");
    data = await withPart(data, "word/comments.xml", "<w:comments/>");
    data = await withPart(data, "word/footnotes.xml", '<w:footnotes><w:footnote w:id="-1"/><w:footnote w:id="0"/><w:footnote w:id="1"/></w:footnotes>');
    data = await withPart(data, "word/charts/chart1.xml", "<c:chartSpace/>");
    data = await withBody(data, '<w:p><w:ins w:id="1"><w:r><w:t>new</w:t></w:r></w:ins></w:p><w:p><w:r><w:instrText>TOC</w:instrText></w:r></w:p><w:p><w:txbxContent/></w:p><w:p><m:oMath/></w:p>');
    expect((await inspectDocxLossy(data)).sort()).toEqual(
      ["charts", "comments", "equations", "fields (like a table of contents)", "footnotes", "headers or footers", "text boxes", "tracked changes"].sort(),
    );
  });
});
