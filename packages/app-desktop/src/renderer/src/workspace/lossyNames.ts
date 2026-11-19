const ES: Record<string, string> = {
  charts: "gráficos",
  "pivot tables": "tablas dinámicas",
  slicers: "segmentadores",
  shapes: "formas",
  sparklines: "minigráficos",
  comments: "comentarios",
  "headers or footers": "encabezados o pies de página",
  footnotes: "notas al pie",
  endnotes: "notas finales",
  "tracked changes": "cambios con control de cambios",
  "text boxes": "cuadros de texto",
  equations: "ecuaciones",
  "fields (like a table of contents)": "campos (como un índice)",
  "embedded objects": "objetos incrustados",
  SmartArt: "SmartArt",
  "design and layout from another app": "diseño y maquetación de otra aplicación",
  animations: "animaciones",
  transitions: "transiciones",
  "audio or video": "audio o video",
  columns: "columnas",
  "merged table rows": "filas combinadas en tablas",
};

/** The names tool-office reports for features the editor can't keep, in the app's language. */
export function lossyNames(features: string[], language: "en" | "es"): string {
  return features.map((f) => (language === "es" ? (ES[f] ?? f) : f)).join(", ");
}
