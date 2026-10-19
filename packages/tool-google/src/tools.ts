import { defineTool } from "@yggdrasil/tools-sdk";
import { getWorkspaceRootOrThrow } from "./account.js";
import { getFreshAccessToken, listEvents, createEvent, searchMessages, getMessage } from "./google-api.js";
import { uploadNoteToDrive } from "./drive.js";

// riskLevel is set directly in code here, NOT via a name-mapping table like
// device-tools' DEVICE_TOOL_RISK_LEVELS in gateway/methods.ts — that
// mechanism exists specifically because a phone_* tool is declared by an
// untrusted remote client at connect time; this package lives in the repo,
// reviewed the same as any other tool-system/tool-documents package
// (external-actions-and-connectors-analysis.md §1.4).

export const gcalListEventsTool = defineTool({
  name: "gcal_list_events",
  description:
    "Lists upcoming events from the connected Google Calendar. Read-only. Requires the user to have already " +
    "connected Google (connectors.google.authUrl/completeAuth) — if not connected yet, this errors with " +
    "instructions to connect first.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      timeMin: { type: "string", description: "ISO-8601. Defaults to now — only future events by default." },
      timeMax: { type: "string", description: "ISO-8601. Optional, no upper bound if omitted." },
      maxResults: { type: "integer", description: "Default 20." },
    },
  },
  async execute(_ctx, args) {
    const workspaceRoot = getWorkspaceRootOrThrow("gcal_list_events");
    const accessToken = await getFreshAccessToken(workspaceRoot);
    const events = await listEvents(accessToken, {
      timeMin: args.timeMin !== undefined ? String(args.timeMin) : undefined,
      timeMax: args.timeMax !== undefined ? String(args.timeMax) : undefined,
      maxResults: args.maxResults !== undefined ? Number(args.maxResults) : undefined,
    });
    return {
      events: events.map((e) => ({
        title: e.summary,
        location: e.location,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        link: e.htmlLink,
      })),
    };
  },
});

export const gcalCreateEventTool = defineTool({
  name: "gcal_create_event",
  description:
    "Creates an event on the connected Google Calendar. This is a real write with a real effect — it can " +
    "generate an actual notification to other people if the connected account is shared/work calendar. " +
    "Requires the user to have already connected Google.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      location: { type: "string" },
      description: { type: "string" },
      startDateTime: { type: "string", description: "ISO-8601 local date-time, e.g. 2026-09-06T15:00:00" },
      endDateTime: {
        type: "string",
        description: "ISO-8601. Optional — defaults to 1 hour after startDateTime if omitted.",
      },
    },
    required: ["title", "startDateTime"],
  },
  async execute(_ctx, args) {
    const title = String(args.title ?? "").trim();
    const startDateTime = String(args.startDateTime ?? "").trim();
    if (!title) throw new Error("gcal_create_event: title is required");
    if (!startDateTime) throw new Error("gcal_create_event: startDateTime is required");

    const workspaceRoot = getWorkspaceRootOrThrow("gcal_create_event");
    const accessToken = await getFreshAccessToken(workspaceRoot);
    const event = await createEvent(accessToken, {
      title,
      location: args.location !== undefined ? String(args.location) : undefined,
      description: args.description !== undefined ? String(args.description) : undefined,
      startDateTime,
      endDateTime: args.endDateTime !== undefined ? String(args.endDateTime) : undefined,
    });
    return { created: true, title: event.summary, link: event.htmlLink };
  },
});

export const gmailSearchTool = defineTool({
  name: "gmail_search",
  description:
    "Searches the connected Gmail account using Gmail's search syntax (e.g. \"from:someone subject:invoice\", " +
    "\"is:unread\"). Returns message ids/threadIds only — use gmail_read to get the actual content of a " +
    "specific result. Read-only, no send/delete capability exists in this connector.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query syntax." },
      maxResults: { type: "integer", description: "Default 10." },
    },
    required: ["query"],
  },
  async execute(_ctx, args) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("gmail_search: query is required");

    const workspaceRoot = getWorkspaceRootOrThrow("gmail_search");
    const accessToken = await getFreshAccessToken(workspaceRoot);
    const messages = await searchMessages(accessToken, {
      query,
      maxResults: args.maxResults !== undefined ? Number(args.maxResults) : undefined,
    });
    return { messages };
  },
});

export const gmailReadTool = defineTool({
  name: "gmail_read",
  description:
    "Reads the full content (subject, from, date, plain-text body) of one Gmail message by id — get the id " +
    "from gmail_search first. Read-only.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Message id, from gmail_search's results." },
    },
    required: ["messageId"],
  },
  async execute(_ctx, args) {
    const messageId = String(args.messageId ?? "").trim();
    if (!messageId) throw new Error("gmail_read: messageId is required");

    const workspaceRoot = getWorkspaceRootOrThrow("gmail_read");
    const accessToken = await getFreshAccessToken(workspaceRoot);
    return getMessage(accessToken, messageId);
  },
});

export const driveUploadDocumentTool = defineTool({
  name: "drive_upload_document",
  description:
    "Uploads a note from this project's Documents folder (notes/) to the connected Google Drive account, " +
    "inside a \"Yggdrasil Notes\" folder, and makes it viewable by anyone with the link. Re-uploading the " +
    "same note updates the existing Drive file instead of creating a duplicate. Requires the user to have " +
    "already connected Google with Drive access (connectors.google.authUrl/completeAuth) — if the account " +
    "was connected before Drive support was added, this errors asking them to reconnect.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of the note relative to notes/, e.g. \"meeting-notes.md\"." },
    },
    required: ["path"],
  },
  async execute(_ctx, args) {
    const path = String(args.path ?? "").trim();
    if (!path) throw new Error("drive_upload_document: path is required");

    const workspaceRoot = getWorkspaceRootOrThrow("drive_upload_document");
    const accessToken = await getFreshAccessToken(workspaceRoot);
    const { fileId, webViewLink } = await uploadNoteToDrive(workspaceRoot, accessToken, path);
    return { uploaded: true, path, fileId, webViewLink };
  },
});
