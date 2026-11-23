// @yggdrasil/ui-kit — notes/features/web-console-upgrade.md (fase 0).
// Styles: import "@yggdrasil/ui-kit/tokens.css" and "@yggdrasil/ui-kit/ui.css" once at the app entry.

export { Button, type ButtonSize, type ButtonVariant } from "./ui/Button.js";
export { IconButton } from "./ui/IconButton.js";
export { Chip, StatusChip, statusTone, STATUS_TONE, type ChipTone, type FeatureStatus } from "./ui/Chip.js";
export { ProgressBar } from "./ui/ProgressBar.js";
export { Card } from "./ui/Card.js";
export { Menu, MenuItem, MenuSeparator } from "./ui/Menu.js";
export { Modal } from "./ui/Modal.js";
export { Field, Input, Select, Textarea } from "./ui/Field.js";
export { Tabs, type TabItem } from "./ui/Tabs.js";
export { NavItem } from "./ui/NavItem.js";
export { useDismiss } from "./ui/useDismiss.js";
export { useElementWidth } from "./ui/useElementWidth.js";

export * from "./theme/types.js";
export * from "./theme/color.js";
export * from "./theme/presets.js";
export * from "./theme/resolve.js";
export * from "./theme/surfaces.js";
export * from "./theme/themeRuntime.js";

export * from "./i18n/index.js";

export * from "./types.js";
export { KitHostProvider, useKitHost, type KitHost } from "./host.js";

export * from "./chat/chatReducer.js";
export { useChatEvents } from "./chat/useChatEvents.js";
export { MessageList } from "./chat/MessageList.js";
export { Markdown } from "./chat/Markdown.js";
export { ApprovalBar } from "./chat/ApprovalBar.js";
export * from "./chat/toolFormat.js";

export { ProvidersSection } from "./settings/ProvidersSection.js";
export { buildProvidersPatch, splitProvidersPatch } from "./settings/providersPatch.js";
export { AgentSection } from "./settings/AgentSection.js";
export { AgentManager, slugifyAgentId } from "./agents/AgentManager.js";
export { BUILTIN_ROLES, type Role } from "./agents/roles.js";
export * from "./agents/agentsEvents.js";
export * from "./agents/toolsForm.js";
