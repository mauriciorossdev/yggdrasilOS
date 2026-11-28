// What the phone app calls: desktop directory, push, assistant document uploads and speech.

import type { AssistantServices } from "./assistant/services.js";
import { loadDesktopTtsOverrides } from "./desktopTtsOverrides.js";
import { deleteAssistantDoc, listAssistantDocs, receiveDocumentChunk } from "./documentUpload.js";
import type { GatewayMethodHandler } from "./methods.js";
import { synthesizeSpeech } from "./tts.js";

export interface PhoneMethodsDeps {
  getAssistantServices: () => AssistantServices | null;
  deviceIdByConnectionId: ReadonlyMap<string, string>;
  register: (name: string, handler: GatewayMethodHandler) => void;
  getTunnelLookup: () => ((desktopId: string) => boolean) | null;
}

export function registerPhoneMethods(deps: PhoneMethodsDeps): void {
  const { getAssistantServices, deviceIdByConnectionId, register, getTunnelLookup } = deps;

  // --- desktop directory (phone discovery of desktop gateways) ---
  // A desktop publishes {name, projects+ports, LAN/Tailscale host, gateway key}
  // here on launch and every minute; the phone lists them so nobody types an IP,
  // a port that changes every launch, or a key. Same API key as everything else.
  register("desktops.register", async (params) => {
    const services = getAssistantServices();
    if (!services) throw new Error("desktops: not available on this gateway");
    const view = await services.desktops.register(params);
    return { ok: true, desktopId: view.desktopId, online: view.online };
  });

  register("desktops.list", async () => {
    const services = getAssistantServices();
    if (!services) throw new Error("desktops: not available on this gateway");
    const desktops = services.desktops.list();
    return { desktops: desktops.map((d) => ({ ...d, tunnel: getTunnelLookup()?.(d.desktopId) ?? false })) };
  });

  register("desktops.offline", async (params) => {
    const services = getAssistantServices();
    if (!services) throw new Error("desktops: not available on this gateway");
    return { ok: await services.desktops.goOffline(String(params.desktopId ?? "")) };
  });

  register("desktops.remove", async (params) => {
    const services = getAssistantServices();
    if (!services) throw new Error("desktops: not available on this gateway");
    return { ok: await services.desktops.remove(String(params.desktopId ?? "")) };
  });

  // --- push (FCM) ---
  register("push.register", async (params, _ctx, connectionId) => {
    const services = getAssistantServices();
    if (!services) throw new Error("push is not available on this gateway");
    const token = String(params.token ?? "").trim();
    // The stable id the phone registered its tools with; fall back to a param for tests/CLI.
    const deviceId =
      (connectionId ? deviceIdByConnectionId.get(connectionId) : undefined) ?? String(params.deviceId ?? "").trim();
    if (!token) throw new Error("token required");
    if (!deviceId) throw new Error("push.register: register device tools first (no deviceId for this connection)");
    await services.push.register(deviceId, token);
    return { ok: true, configured: services.push.configured };
  });

  register("push.unregister", async (params, _ctx, connectionId) => {
    const services = getAssistantServices();
    if (!services) throw new Error("push is not available on this gateway");
    const deviceId =
      (connectionId ? deviceIdByConnectionId.get(connectionId) : undefined) ?? String(params.deviceId ?? "").trim();
    return { ok: deviceId ? await services.push.unregister(deviceId) : false };
  });

  register("push.status", async () => ({
    available: getAssistantServices() !== null,
    configured: getAssistantServices()?.push.configured ?? false,
    devices: getAssistantServices()?.push.deviceCount() ?? 0,
    pendingReminders: getAssistantServices()?.reminders.pending().length ?? 0,
    queued: getAssistantServices()?.queue.list().length ?? 0,
  }));

  register("push.test", async (params) => {
    const services = getAssistantServices();
    if (!services) throw new Error("push is not available on this gateway");
    return services.push.notify({
      title: String(params.title ?? "Yggdrasil"),
      body: String(params.body ?? "Notificación de prueba"),
      data: { type: "test" },
    });
  });

  // Phone -> assistant document uploads (chunked base64). Files land in the
  // project's notes/assistant/ folder, where the assistant's read_document
  // tool can read them; the returned path is relative to notes/.
  register("documents.upload", async (params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.upload: no workspace configured");
    return receiveDocumentChunk({
      workspaceRoot: ctx.workspaceRoot,
      uploadId: String(params.uploadId ?? ""),
      name: String(params.name ?? ""),
      index: Number(params.index ?? 0),
      data: String(params.data ?? ""),
      final: params.final === true,
    });
  });

  register("documents.list", async (_params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.list: no workspace configured");
    return { documents: await listAssistantDocs(ctx.workspaceRoot) };
  });

  register("documents.delete", async (params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.delete: no workspace configured");
    return { ok: await deleteAssistantDoc(ctx.workspaceRoot, String(params.name ?? "")) };
  });

  // Text-to-speech for clients (the phone's assistant chat). Returns the whole
  // clip as base64 mp3; the Replicate token never leaves the gateway.
  register("tts.synthesize", async (params) => {
    const overrides = await loadDesktopTtsOverrides();
    if (!overrides.enabled) throw new Error("TTS deshabilitado en Settings → Voz de este equipo");
    const callerVoiceId = params.voiceId !== undefined ? String(params.voiceId) : undefined;
    return synthesizeSpeech({
      text: String(params.text ?? ""),
      voiceId: callerVoiceId || overrides.voiceId,
      env: overrides.apiToken ? { ...process.env, REPLICATE_API_TOKEN: overrides.apiToken } : undefined,
    });
  });
}
