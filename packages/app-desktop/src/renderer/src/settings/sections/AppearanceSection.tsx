import { useEffect, useRef, useState } from "react";
import { isHexColor } from "../../ui/theme/color.js";
import { PRESETS, findPreset } from "../../ui/theme/presets.js";
import { resolveCore, themeWarnings } from "../../ui/theme/resolve.js";
import { applyTheme } from "../../ui/theme/themeRuntime.js";
import { Catalog } from "../../ui/Catalog.js";
import { CORE_KEYS, CORE_LABELS, type CoreKey, type ThemeSettings } from "../../ui/theme/types.js";

const PERSIST_DELAY_MS = 150;

/**
 * Theme picker: a preset plus overrides for the four core colors (everything
 * else in the UI is derived from them, see ui/theme/tokens.css). Changes apply
 * to this window immediately and are persisted + broadcast to every other
 * window by main (theme:set), debounced so dragging a color picker doesn't
 * write the settings file on every pixel.
 */
export function AppearanceSection() {
  const [theme, setTheme] = useState<ThemeSettings>(window.yggdrasil.theme.initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Another window (or a reset) changed the theme.
  useEffect(() => window.yggdrasil.theme.onChange(setTheme), []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (next: ThemeSettings) => {
    setTheme(next);
    applyTheme(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void window.yggdrasil.theme.set(next), PERSIST_DELAY_MS);
  };

  const core = resolveCore(theme);
  const presetCore = findPreset(theme.presetId).core;
  const warnings = themeWarnings(core);

  const setColor = (key: CoreKey, value: string) => {
    if (!isHexColor(value)) return;
    commit({ ...theme, overrides: { ...theme.overrides, [key]: value.toLowerCase() } });
  };

  const clearColor = (key: CoreKey) => {
    const overrides = { ...theme.overrides };
    delete overrides[key];
    commit({ ...theme, overrides });
  };

  return (
    <section className="settings-section">
      <h3>Apariencia</h3>
      <p className="muted">
        Elige un tema y ajusta sus cuatro colores base; el resto de la interfaz se calcula a partir de ellos. Los cambios
        se aplican al instante en todas las ventanas.
      </p>

      <div className="appearance-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`appearance-preset${preset.id === theme.presetId ? " active" : ""}`}
            onClick={() => commit({ presetId: preset.id, overrides: {} })}
          >
            <span className="appearance-swatches">
              {CORE_KEYS.map((key) => (
                <span key={key} style={{ background: preset.core[key] }} />
              ))}
            </span>
            {preset.name}
          </button>
        ))}
      </div>

      <div className="appearance-colors">
        {CORE_KEYS.map((key) => (
          <div key={key} className="appearance-color-row">
            <span className="appearance-color-label">{CORE_LABELS[key]}</span>
            <input
              type="color"
              aria-label={CORE_LABELS[key]}
              value={core[key]}
              onChange={(e) => setColor(key, e.target.value)}
            />
            <input
              type="text"
              aria-label={`${CORE_LABELS[key]} (hex)`}
              value={core[key]}
              maxLength={7}
              onChange={(e) => setColor(key, e.target.value)}
            />
            {core[key] !== presetCore[key] && (
              <button type="button" onClick={() => clearColor(key)}>
                Restaurar
              </button>
            )}
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <ul className="appearance-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => void window.yggdrasil.theme.reset()}>
        Restablecer tema por defecto
      </button>

      <Catalog />
    </section>
  );
}
