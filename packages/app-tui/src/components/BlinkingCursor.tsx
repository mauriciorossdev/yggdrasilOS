import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { theme } from "../render/theme.js";

type Props = {
  /** False (e.g. the input is disabled while a turn runs) hides it and stops the timer. */
  active?: boolean;
  /** Any change shows the cursor solid again and restarts the blink, like a real caret after a keystroke. */
  resetKey?: unknown;
  intervalMs?: number;
};

/** A block caret that blinks while the input can take text. Always one cell wide, so toggling never shifts the layout. */
export function BlinkingCursor({ active = true, resetKey, intervalMs = 530 }: Props): React.ReactElement {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (!active) return;
    const timer = setInterval(() => setVisible((v) => !v), intervalMs);
    return () => clearInterval(timer);
  }, [active, resetKey, intervalMs]);

  if (!active) return <Text> </Text>;
  return visible ? <Text color={theme.primary}>█</Text> : <Text> </Text>;
}
