import type { ReactNode } from "react";
import type { DeckTheme, ListBlock, Run, Slide, SlideBlock } from "@yggdrasil/tool-office/browser";

/** A slide drawn in HTML, 16:9, sized by its container (everything is in container-query units so a thumbnail and the big canvas are the same drawing). */

function runs(list: Run[]): ReactNode {
  return list.map((r, i) => {
    let node: ReactNode = r.text;
    if (r.code) node = <code>{node}</code>;
    if (r.link) node = <a href={r.link} onClick={(e) => e.preventDefault()}>{node}</a>;
    const style = { color: r.color, background: r.highlight, fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? "italic" : undefined, textDecoration: [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ") || undefined } as const;
    return (
      <span key={i} style={style}>
        {node}
      </span>
    );
  });
}

function list(block: ListBlock, key: number): ReactNode {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {block.items.map((item, i) => (
        <li key={i}>
          {runs(item.runs)}
          {(item.children ?? []).map((child, k) => list(child, k))}
        </li>
      ))}
    </Tag>
  );
}

function blocks(list_: SlideBlock[]): ReactNode {
  return list_.map((b, i) => {
    switch (b.type) {
      case "paragraph":
        return <p key={i} style={{ textAlign: b.align === "justify" ? "justify" : b.align }}>{runs(b.runs)}</p>;
      case "heading":
        return <p key={i} className="slide-h">{runs(b.runs)}</p>;
      case "list":
        return list(b, i);
      case "table":
        return (
          <table key={i}>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => {
                    const Cell = cell.header ? "th" : "td";
                    return (
                      <Cell key={c} colSpan={cell.colSpan}>
                        {cell.blocks.map((x) => (x.type === "paragraph" ? runs(x.runs) : null))}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        );
      case "image":
        return <img key={i} src={`data:${b.mime};base64,${b.data}`} alt={b.alt ?? ""} />;
      case "code":
        return <pre key={i}>{b.text}</pre>;
    }
  });
}

// The colours of the drawn slide are those the .pptx gets (write.ts), not the app's UI tokens.
const PALETTES: Record<DeckTheme, Record<string, string>> = {
  light: { "--slide-bg": "#ffffff", "--slide-title": "#111827", "--slide-text": "#374151", "--slide-accent": "#2563eb", "--slide-muted": "#6b7280", "--slide-head": "#e5e7eb", "--slide-code": "#f3f4f6" },
  dark: { "--slide-bg": "#111827", "--slide-title": "#f9fafb", "--slide-text": "#e5e7eb", "--slide-accent": "#60a5fa", "--slide-muted": "#9ca3af", "--slide-head": "#374151", "--slide-code": "#1f2937" },
  accent: { "--slide-bg": "#1e3a8a", "--slide-title": "#ffffff", "--slide-text": "#dbeafe", "--slide-accent": "#fbbf24", "--slide-muted": "#93c5fd", "--slide-head": "#1e40af", "--slide-code": "#1e40af" },
};

export function SlideView({ slide, theme }: { slide: Slide; theme: DeckTheme }) {
  return (
    <div className="slide-frame">
    <div className={`slide slide-layout-${slide.layout}`} style={PALETTES[theme]}>
      {slide.title.length > 0 && <div className="slide-title">{runs(slide.title)}</div>}
      {slide.subtitle && slide.subtitle.length > 0 && <div className="slide-subtitle">{runs(slide.subtitle)}</div>}
      <div className="slide-cols">
        <div className="slide-body">{blocks(slide.body)}</div>
        {slide.layout === "two-column" && <div className="slide-body">{blocks(slide.body2 ?? [])}</div>}
      </div>
    </div>
    </div>
  );
}
