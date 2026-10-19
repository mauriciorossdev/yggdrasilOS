export const FILE_DRAG_MIME = "application/x-yggdrasil-file";

export type FileDragPayload = { relativePath: string; type: "file" | "directory" };
