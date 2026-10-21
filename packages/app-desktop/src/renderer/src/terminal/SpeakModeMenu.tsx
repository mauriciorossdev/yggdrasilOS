import { Menu, MenuItem } from "../ui/index.js";
import type { SpeakMode } from "./useSpeakLastResponse.js";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onPick: (mode: SpeakMode) => void;
};

// The terminal pane's speak button opens this instead of speaking
// immediately, so the user picks resumen vs todo per click.
export function SpeakModeMenu({ x, y, onClose, onPick }: Props) {
  const pick = (mode: SpeakMode) => () => {
    onPick(mode);
    onClose();
  };

  return (
    <Menu x={x} y={y} onClose={onClose}>
      <MenuItem onClick={pick("summary")}>Resumen</MenuItem>
      <MenuItem onClick={pick("full")}>Todo</MenuItem>
    </Menu>
  );
}
