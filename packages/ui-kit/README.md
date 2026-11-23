# @yggdrasil/ui-kit

UI shared by the desktop app (`packages/app-desktop`) and the web console (`packages/web-console`). Design: `notes/features/web-console-upgrade.md`.

## What's in it
- **Theme:** the `--ygg-*` tokens (`tokens.css`), the presets (warm-dark, slate-dark, high-contrast), and `applyTheme` / `onThemeApplied` / `getThemeColors`.
- **Primitives:** `Button`, `IconButton`, `Chip`, `StatusChip`, `ProgressBar`, `Card`, `Menu`, `Modal`, `Field`/`Input`/`Select`/`Textarea`, `Tabs`, `NavItem`, plus `useDismiss` and `useElementWidth`. Styles in `ui.css`.
- **UI language:** the single language store (`getLanguage`, `setLanguage`, `subscribeLanguage`), `translate`, and the kit's own strings (`kitEn` / `kitEs`).
- **Chat core:** `chatReducer`/`initialChatState`, `useChatEvents`, `MessageList`, `Markdown`, `ApprovalBar`, tool formatting.
- **Settings:** `ProvidersSection` (global providers, per-project override) and `AgentSection`/`AgentManager` (agents, roles, tools).
- **Gateway types** shared by both apps (`@yggdrasil/ui-kit/types` has only types, no components).
- **`KitHost`:** what components need from the host app (open a link, the project path, saved custom roles). Wrap the app in `<KitHostProvider host={...}>`; without it, links open in a new tab and app-only features hide.

## Use
```ts
import "@yggdrasil/ui-kit/tokens.css";
import "@yggdrasil/ui-kit/ui.css";
import "@yggdrasil/ui-kit/components.css"; // only if the app doesn't load app-desktop's styles.css
import { applyTheme, DEFAULT_THEME, Button } from "@yggdrasil/ui-kit";
applyTheme(DEFAULT_THEME);
```

## Rules
- **Source-only, private:** `exports` point at `.ts`/`.tsx`; each app's Vite compiles it. No `dist`, nothing to rebuild.
- **No Electron:** nothing here may touch `window.yggdrasil`. A piece that needs the app (open a file, a link) takes it as an optional callback.
- **One language store:** an app's own i18n must read and set the language here (see `app-desktop/src/renderer/src/i18n/index.ts`), and merge `kitEn`/`kitEs` into its dictionaries, or kit components won't follow language changes.
- **Tokens only:** no raw colors in `ui.css` (tested).
- **`components.css` is generated** from app-desktop's `styles.css` (`pnpm --filter @yggdrasil/ui-kit sync-css`); a test fails when it's stale. app-desktop keeps loading its own stylesheet.
- `react`, `react-dom` and `@heroicons/react` are peer dependencies: one copy, the app's.
