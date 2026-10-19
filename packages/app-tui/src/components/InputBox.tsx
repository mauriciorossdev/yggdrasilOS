import React, { useState, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import type { Command } from "./CommandPalette.js";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputHistory: string[];
  historyIndex: number;
  onHistoryChange: (index: number) => void;
  onInputChange?: (value: string) => void;
  slashSuggestions?: Command[];
  slashIndex?: number;
  onSlashIndexChange?: (index: number) => void;
};

export function InputBox({
  onSubmit,
  disabled,
  placeholder,
  inputHistory,
  historyIndex,
  onHistoryChange,
  onInputChange,
  slashSuggestions = [],
  slashIndex = 0,
  onSlashIndexChange,
}: Props): React.ReactElement {
  const [value, setValue] = useState("");
  const savedInput = useRef("");
  const slashActive = value.startsWith("/") && slashSuggestions.length > 0;

  const updateValue = (newVal: string | ((prev: string) => string)) => {
    setValue((prev) => typeof newVal === "function" ? newVal(prev) : newVal);
  };

  useEffect(() => {
    onInputChange?.(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (disabled) return;

    if (slashActive && key.upArrow && !key.shift) {
      onSlashIndexChange?.(Math.max(0, slashIndex - 1));
      return;
    }

    if (slashActive && key.downArrow && !key.shift) {
      onSlashIndexChange?.(Math.min(slashSuggestions.length - 1, slashIndex + 1));
      return;
    }

    if (key.upArrow && !key.shift) {
      if (inputHistory.length === 0) return;
      if (historyIndex === -1) {
        savedInput.current = value;
      }
      const next = Math.min(historyIndex + 1, inputHistory.length - 1);
      onHistoryChange(next);
      updateValue(inputHistory[inputHistory.length - 1 - next] ?? "");
      return;
    }

    if (key.downArrow && !key.shift) {
      if (historyIndex <= -1) return;
      const next = historyIndex - 1;
      onHistoryChange(next);
      if (next === -1) {
        updateValue(savedInput.current);
      } else {
        updateValue(inputHistory[inputHistory.length - 1 - next] ?? "");
      }
      return;
    }

    if (key.return) {
      if (key.shift) {
        updateValue((v) => v + "\n");
        return;
      }
      if (slashActive) {
        const cmd = slashSuggestions[slashIndex];
        if (cmd) {
          onSubmit(`/${cmd.name}`);
          updateValue("");
          savedInput.current = "";
          return;
        }
      }
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
      updateValue("");
      savedInput.current = "";
      return;
    }

    if (key.backspace || key.delete) {
      updateValue((v) => v.slice(0, -1));
      if (historyIndex !== -1) {
        onHistoryChange(-1);
        savedInput.current = "";
      }
      return;
    }

    if (key.escape || key.ctrl || key.meta || key.upArrow || key.downArrow) {
      return;
    }

    if (input) {
      updateValue((v) => v + input);
      if (historyIndex !== -1) {
        onHistoryChange(-1);
        savedInput.current = "";
      }
    }
  });

  const lines = value.split("\n");
  const isMultiline = lines.length > 1;
  const showPlaceholder = !value && placeholder;
  const isShellCommand = value.startsWith("!");
  const promptColor = disabled ? theme.muted : isShellCommand ? theme.warning : theme.primary;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={disabled ? theme.muted : theme.primary}
      paddingX={1}
    >
      <Box>
        <Text color={promptColor} bold>
          {"❯ "}
        </Text>
        {showPlaceholder ? (
          <Text color={theme.dim}>{placeholder}</Text>
        ) : isMultiline ? (
          <Text color={isShellCommand ? theme.warning : undefined}>{lines[0]}</Text>
        ) : (
          <Text color={isShellCommand ? theme.warning : undefined}>
            {value}
            <Text color={theme.dim}>█</Text>
          </Text>
        )}
      </Box>
      {isMultiline &&
        lines.slice(1).map((line, i) => (
          <Box key={i} marginLeft={2}>
            <Text color={isShellCommand ? theme.warning : undefined}>
              {line}
              {i === lines.length - 2 && <Text color={theme.dim}>█</Text>}
            </Text>
          </Box>
        ))}
      {isMultiline && (
        <Box marginTop={0}>
          <Text color={theme.dim}>shift+enter: newline · enter: send</Text>
        </Box>
      )}
    </Box>
  );
}
