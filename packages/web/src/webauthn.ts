import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import { loadToken } from "./auth.ts";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const token = loadToken();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`invalid JSON from ${url}: ${text.slice(0, 100)}`);
  }
  if (!resp.ok) {
    const msg = (json as { error?: string }).error ?? `${url} ${resp.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function registerPasskey(deviceId: string): Promise<void> {
  const options = await post<PublicKeyCredentialCreationOptionsJSON>(
    "/webauthn/register/begin",
    { deviceId },
  );
  const response: RegistrationResponseJSON = await startRegistration({ optionsJSON: options });
  await post<{ ok: boolean }>("/webauthn/register/complete", { deviceId, response });
}

export async function clearPasskey(deviceId: string): Promise<void> {
  await post<{ ok: boolean }>("/webauthn/clear", { deviceId });
}

/**
 * Runs the WebAuthn assertion flow for a high-risk approval. Returns the
 * token the client should echo on `approval.response` (server-side gate is
 * keyed by approvalId; the token exists to harden client intent).
 */
export async function authenticateForApproval(
  deviceId: string,
  approvalId: string,
): Promise<string> {
  const options = await post<PublicKeyCredentialRequestOptionsJSON>(
    "/webauthn/assert/begin",
    { deviceId, approvalId },
  );
  const response: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: options });
  const result = await post<{ ok: boolean; webauthnToken: string | null }>(
    "/webauthn/assert/complete",
    { deviceId, approvalId, response },
  );
  if (!result.ok || !result.webauthnToken) throw new Error("passkey verification failed");
  return result.webauthnToken;
}

export function isWebAuthnAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}
