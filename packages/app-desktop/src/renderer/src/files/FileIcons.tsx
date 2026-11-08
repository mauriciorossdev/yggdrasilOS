import { DocumentIcon, FolderIcon, FolderOpenIcon } from "@heroicons/react/20/solid";
import { fileKind } from "./fileKinds.js";

/** Folder or file icon, tinted by what the entry is (see .ft-* in styles.css). */
export function EntryIcon({ name, isDir, open }: { name: string; isDir: boolean; open?: boolean }) {
  if (isDir) {
    const Icon = open ? FolderOpenIcon : FolderIcon;
    return <Icon className="hero-icon ft-folder" />;
  }
  return <DocumentIcon className={`hero-icon ft-${fileKind(name)}`} />;
}

/** git-branch glyph (Heroicons has none); inherits the text color. */
export function BranchIcon({ className = "hero-icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="6" cy="4.5" r="1.8" />
      <circle cx="6" cy="15.5" r="1.8" />
      <circle cx="14" cy="8" r="1.8" />
      <path d="M6 6.3v7.4M14 9.8c0 2.4-2.4 2.6-6.2 3.6" />
    </svg>
  );
}
