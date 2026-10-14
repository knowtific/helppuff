/**
 * Files: photos and documents visitors send in the chat, and the team
 * attaches to jobs. Kept in the site's R2 bucket (`HELPPUFF_FILES`), private,
 * read through short-lived signed links. Without Zod: the widget imports
 * these (`@helppuff/protocol/files`).
 */

/** When visitors may send files: never, only while a person has the chat (live chat), or any time. */
export const FILE_CHAT_MODES = ['off', 'live', 'always'] as const;
export type FileChatMode = (typeof FILE_CHAT_MODES)[number];

/** Files one visitor message carries. */
export const MAX_FILES_PER_MESSAGE = 4;

/** What the widget's file input offers visitors: photos and PDFs. */
export const CHAT_ACCEPT = 'image/*,application/pdf';

/** A file as messages and lists carry it. `url` is a signed link, valid for a while. */
export type FileRef = {
  id: string;
  name: string;
  /** The media type the server found in its bytes (never the browser's claim). */
  type: string;
  size: number;
  url?: string;
};

/** Shown inline (an `<img>`); everything else is a download. */
export const isImageType = (type: string): boolean => /^image\/(jpeg|png|gif|webp)$/.test(type);

/** "2.4 MB", "830 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The line a file leaves in the transcript and the assistant's history: "📎 kitchen.jpg". */
export function fileLine(file: Pick<FileRef, 'name'>): string {
  return `📎 ${file.name}`;
}
