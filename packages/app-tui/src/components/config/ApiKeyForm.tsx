import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../../render/theme.js";
import type { GatewayClient } from "../../client/gateway-client.js";
import type { ProviderInfo } from "../../client/types.js";

type Props = {
  providers: ProviderInfo[];
  client: GatewayClient;
  config: Record<string, unknown> | null;
  onSaved: (message: string) => void;
  onBack: () => void;
};

type Step = "select-provider" | "enter-key";

export function ApiKeyForm({ providers, client, config, onSaved, onBack }: Props): React.ReactElement {
  const [step, setStep] = useState<Step>("select-provider");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const providersConfig = (config?.providers as Record<string, { apiKey?: string }> | undefined) ?? {};
  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "enter-key") {
        setStep("select-provider");
        setApiKey("");
      } else {
        onBack();
      }
      return;
    }

    if (step !== "select-provider") return;

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(providers.length - 1, i + 1));
    }
    if (key.return) {
      const p = providers[selectedIndex];
      if (p) {
        setSelectedProvider(p.id);
        setStep("enter-key");
      }
    }
  });

  if (step === "enter-key") {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={theme.secondary} bold>
            API Key for {selectedProviderInfo?.label || selectedProvider}
          </Text>
        </Box>
        <Box gap={1}>
          <Text color={theme.primary}>Key:</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            mask="*"
            placeholder="Enter API key…"
            onSubmit={async (value) => {
              if (!value.trim()) return;
              try {
                // config.patch takes its patch fields flat at the top level —
                // a wrapping "patch" key is itself a forbidden key.
                const result = await client.call<{ ok: true; requiresRestart: boolean }>("config.patch", {
                  providers: { [selectedProvider!]: { apiKey: value.trim() } },
                });
                const msg = result.requiresRestart
                  ? `✓ API key saved. ⚠ Restart required.`
                  : `✓ API key saved for ${selectedProvider}`;
                onSaved(msg);
              } catch (err) {
                onSaved(`✗ ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.dim}>enter to save · esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={theme.secondary} bold>
          Select Provider for API Key
        </Text>
      </Box>
      {providers.map((p, i) => (
        <Box key={p.id} gap={2}>
          <Text
            color={i === selectedIndex ? theme.primary : theme.text}
            bold={i === selectedIndex}
          >
            {i === selectedIndex ? "▸" : " "} {p.label || p.id}
          </Text>
          {providersConfig[p.id]?.apiKey && <Text color={theme.success}>✓ key set</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter select · esc back</Text>
      </Box>
    </Box>
  );
}
