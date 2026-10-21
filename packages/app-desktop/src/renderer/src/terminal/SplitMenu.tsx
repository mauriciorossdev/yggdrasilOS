import { ViewColumnsIcon } from "@heroicons/react/20/solid";
import { Menu, MenuItem } from "../ui/index.js";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onPick: (direction: "row" | "column") => void;
};

// The pane header's single split button opens this instead of showing one icon per direction.
export function SplitMenu({ x, y, onClose, onPick }: Props) {
  const pick = (direction: "row" | "column") => () => {
    onPick(direction);
    onClose();
  };

  return (
    <Menu x={x} y={y} onClose={onClose}>
      <MenuItem onClick={pick("row")}>
        <ViewColumnsIcon className="hero-icon" />
        Split horizontally
      </MenuItem>
      <MenuItem onClick={pick("column")}>
        <ViewColumnsIcon className="hero-icon terminal-pane-split-vertical" />
        Split vertically
      </MenuItem>
    </Menu>
  );
}
