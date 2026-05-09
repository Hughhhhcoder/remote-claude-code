import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { TrustStore } from "./trust.ts";

const CHALLENGE_TTL_MS = 5 * 60_000;

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
  kind: "register" | "assert";
  approvalId?: string;
}

export class WebAuthnService {
  private readonly challenges = new Map<string, ChallengeEntry>();
  /**
   * approvalId → verified. When a high-risk approval is guarded by passkey,
   * the gate starts absent; a successful assertion for that approvalId sets
   * it to true. `approval.response` handling consumes the entry.
   */
  private readonly approvalGates = new Map<string, { verified: boolean; expiresAt: number }>();
  private gcTimer: ReturnType<typeof setInterval>;

  constructor(private readonly trust: TrustStore) {
    this.gcTimer = setInterval(() => this.gc(), 30_000);
    this.gcTimer.unref?.();
  }

  dispose(): void {
    clearInterval(this.gcTimer);
  }

  async beginRegistration(
    deviceId: string,
    rpId: string,
    rpName: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const device = this.trust.devices().find((d) => d.id === deviceId);
    if (!device) throw new Error("unknown device");
    const userIdBytes = new TextEncoder().encode(device.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: device.name,
      userID: userIdBytes,
      userDisplayName: device.name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: device.passkey
        ? [{ id: device.passkey.credId }]
        : [],
    });
    this.putChallenge(`reg:${deviceId}`, { challenge: options.challenge, kind: "register" });
    return options;
  }

  async completeRegistration(
    deviceId: string,
    response: RegistrationResponseJSON,
    rpId: string,
    origin: string,
  ): Promise<{ credId: string; publicKey: string; counter: number }> {
    const entry = this.takeChallenge(`reg:${deviceId}`);
    if (!entry || entry.kind !== "register") throw new Error("no pending challenge");
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: false,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new Error("registration not verified");
    }
    const { credential } = result.registrationInfo;
    return {
      credId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
    };
  }

  async beginAssertion(
    deviceId: string,
    approvalId: string,
    rpId: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const device = this.trust.devices().find((d) => d.id === deviceId);
    if (!device?.passkey) throw new Error("device has no passkey");
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: [{ id: device.passkey.credId }],
      userVerification: "preferred",
    });
    this.putChallenge(`auth:${deviceId}:${approvalId}`, {
      challenge: options.challenge,
      kind: "assert",
      approvalId,
    });
    return options;
  }

  async completeAssertion(
    deviceId: string,
    approvalId: string,
    response: AuthenticationResponseJSON,
    rpId: string,
    origin: string,
  ): Promise<boolean> {
    const device = this.trust.devices().find((d) => d.id === deviceId);
    if (!device?.passkey) throw new Error("device has no passkey");
    const entry = this.takeChallenge(`auth:${deviceId}:${approvalId}`);
    if (!entry || entry.kind !== "assert" || entry.approvalId !== approvalId) {
      throw new Error("no pending challenge");
    }
    const publicKey = Buffer.from(device.passkey.publicKey, "base64url");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: device.passkey.credId,
        publicKey,
        counter: device.passkey.counter,
      },
      requireUserVerification: false,
    });
    if (!result.verified) return false;
    const newCounter = result.authenticationInfo.newCounter;
    if (newCounter < device.passkey.counter) {
      throw new Error("counter regressed — possible replay");
    }
    await this.trust.updatePasskeyCounter(deviceId, newCounter);
    this.approvalGates.set(approvalId, {
      verified: true,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return true;
  }

  /** Require verification for this approvalId before `approval.response` is honoured. */
  requireGate(approvalId: string): void {
    this.approvalGates.set(approvalId, {
      verified: false,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
  }

  /** True if `approval.response` may proceed. Consumes a verified gate. */
  consumeGate(approvalId: string, token?: string): { open: true } | { open: false; reason: string } {
    const entry = this.approvalGates.get(approvalId);
    if (!entry) return { open: true };
    if (entry.expiresAt < Date.now()) {
      this.approvalGates.delete(approvalId);
      return { open: false, reason: "gate_expired" };
    }
    if (!entry.verified) return { open: false, reason: "gate_not_verified" };
    if (token && token !== approvalId) return { open: false, reason: "gate_token_mismatch" };
    this.approvalGates.delete(approvalId);
    return { open: true };
  }

  clearGate(approvalId: string): void {
    this.approvalGates.delete(approvalId);
  }

  private putChallenge(key: string, data: Omit<ChallengeEntry, "expiresAt">): void {
    this.challenges.set(key, { ...data, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  private takeChallenge(key: string): ChallengeEntry | null {
    const entry = this.challenges.get(key);
    if (!entry) return null;
    this.challenges.delete(key);
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.expiresAt < now) this.challenges.delete(k);
    for (const [k, v] of this.approvalGates) if (v.expiresAt < now) this.approvalGates.delete(k);
  }
}

/**
 * Resolve the RP ID from a request's Host header. WebAuthn requires the RP
 * ID to be a registrable domain of the origin — we keep it simple and return
 * the hostname without a port. For loopback this is `localhost` which the
 * browser/virtual-authenticator tolerate.
 */
export function rpIdFromHost(host: string | undefined): string {
  if (!host) return "localhost";
  const h = host.trim();
  const bracketEnd = h.indexOf("]");
  if (h.startsWith("[") && bracketEnd > 0) return h.slice(1, bracketEnd);
  const colon = h.indexOf(":");
  return colon >= 0 ? h.slice(0, colon) : h;
}

export function originFromReq(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const host = (req.headers["host"] as string | undefined) ?? "localhost";
  const xfp = (req.headers["x-forwarded-proto"] as string | undefined) ?? "";
  const proto = xfp.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}
