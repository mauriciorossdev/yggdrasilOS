import type { SharedResourceRole, SharedResourceType } from "./sharedResources.js";

export class SyncClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  serverUrl: string,
  apiKey: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (res.status >= 400 && res.status !== 409) {
    const message = (data as { error?: string } | undefined)?.error ?? `sync-server: HTTP ${res.status}`;
    throw new SyncClientError(res.status, message);
  }
  return { status: res.status, data };
}

export async function createShare(
  serverUrl: string,
  ownerApiKey: string,
  params: { resourceType: SharedResourceType; resourceKey: string; initialContent: string; ownerName: string },
): Promise<{ shareId: string; version: number }> {
  const { data } = await request<{ shareId: string; version: number }>(serverUrl, ownerApiKey, "POST", "/v1/shares", params);
  return data;
}

export async function createInvite(
  serverUrl: string,
  ownerApiKey: string,
  shareId: string,
  params: { role: SharedResourceRole; expiresInHours?: number },
): Promise<{ code: string }> {
  const { data } = await request<{ code: string }>(serverUrl, ownerApiKey, "POST", `/v1/shares/${shareId}/invites`, params);
  return data;
}

export async function redeemInvite(
  serverUrl: string,
  code: string,
  memberName: string,
): Promise<{ shareId: string; resourceType: SharedResourceType; resourceKey: string; apiKey: string; role: SharedResourceRole }> {
  const { data } = await request<{
    shareId: string;
    resourceType: SharedResourceType;
    resourceKey: string;
    apiKey: string;
    role: SharedResourceRole;
  }>(serverUrl, undefined, "POST", `/v1/invites/${code}/redeem`, { memberName });
  return data;
}

export async function getShareContent(
  serverUrl: string,
  apiKey: string,
  shareId: string,
): Promise<{ content: string; version: number; role: SharedResourceRole }> {
  const { data } = await request<{ content: string; version: number; role: SharedResourceRole }>(
    serverUrl,
    apiKey,
    "GET",
    `/v1/shares/${shareId}`,
  );
  return data;
}

export type PutShareResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; currentVersion: number; currentContent: string };

export async function putShareContent(
  serverUrl: string,
  apiKey: string,
  shareId: string,
  content: string,
  expectedVersion: number,
): Promise<PutShareResult> {
  const { status, data } = await request<{ version: number } & { currentVersion: number; currentContent: string }>(
    serverUrl,
    apiKey,
    "PUT",
    `/v1/shares/${shareId}`,
    { content, expectedVersion },
  );
  if (status === 409) return { ok: false, conflict: true, currentVersion: data.currentVersion, currentContent: data.currentContent };
  return { ok: true, version: data.version };
}

export async function listMyShares(
  serverUrl: string,
  apiKey: string,
): Promise<{ id: string; resourceType: SharedResourceType; resourceKey: string; role: SharedResourceRole; version: number; memberCount: number }[]> {
  const { data } = await request<
    { id: string; resourceType: SharedResourceType; resourceKey: string; role: SharedResourceRole; version: number; memberCount: number }[]
  >(serverUrl, apiKey, "GET", "/v1/shares/mine");
  return data;
}

export type ShareMember = {
  keyHash: string;
  name: string;
  email: string | null;
  role: SharedResourceRole;
  kind: "app" | "web";
  invitedAt: number;
};

export async function createWebLink(
  serverUrl: string,
  ownerApiKey: string,
  shareId: string,
  params: { email: string; role: SharedResourceRole },
): Promise<{ url: string; keyHash: string }> {
  const { data } = await request<{ url: string; keyHash: string }>(serverUrl, ownerApiKey, "POST", `/v1/shares/${shareId}/web-links`, params);
  return data;
}

export async function listMembers(serverUrl: string, ownerApiKey: string, shareId: string): Promise<ShareMember[]> {
  const { data } = await request<ShareMember[]>(serverUrl, ownerApiKey, "GET", `/v1/shares/${shareId}/members`);
  return data;
}

export type BundleUpload = {
  files: Record<string, string>;
  project: { id: string; name: string };
  pluginId: string;
  pluginName: string;
  storageKey: string;
};

export async function putBundle(serverUrl: string, ownerApiKey: string, shareId: string, bundle: BundleUpload): Promise<void> {
  await request(serverUrl, ownerApiKey, "PUT", `/v1/shares/${shareId}/bundle`, bundle);
}

export async function revokeMember(serverUrl: string, ownerApiKey: string, shareId: string, memberKeyHash: string): Promise<void> {
  await request(serverUrl, ownerApiKey, "DELETE", `/v1/shares/${shareId}/members/${memberKeyHash}`);
}
