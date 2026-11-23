import crypto from 'node:crypto';
import type { AdminRole } from '../src/types/database.types.ts';

declare global {
  var _ignitionSigningKey: string | undefined;
  var _ignitionRateLimits: Map<string, number[]> | undefined;
}

function getSigningKey(): string {
  if (!globalThis._ignitionSigningKey) {
    globalThis._ignitionSigningKey = crypto.randomBytes(32).toString('hex');
  }
  return globalThis._ignitionSigningKey;
}

function getQrSigningKey(): string {
  const seed =
    process.env.QR_SIGNING_SECRET ||
    process.env.APPS_SCRIPT_SECRET ||
    process.env.APPS_SCRIPT_URL ||
    'ignition-2026-pmec-mechanical-qr';
  return crypto.createHash('sha256').update(seed).digest('hex');
}

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function hashGasPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto
    .createHash('sha256')
    .update(`${salt}:${passcode}`)
    .digest('hex');
  return `gas$${salt}$${digest}`;
}

export function verifyPasscode(passcode: string, storedHash: string): boolean {
  if (storedHash.startsWith('gas$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    if (!salt || !keyHex) return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto
      .createHash('sha256')
      .update(`${salt}:${passcode}`)
      .digest();
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(passcode, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface SessionPayload {
  sub: string;
  role: AdminRole;
  exp: number;
}

export function signSessionToken(adminId: string, role: AdminRole): string {
  const payload: SessionPayload = {
    sub: adminId,
    role,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningKey())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return null;

    const expectedSig = crypto
      .createHmac('sha256', getSigningKey())
      .update(encoded)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SessionPayload;

    if (!payload.sub || !payload.role || typeof payload.exp !== 'number') {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function signAdminQrToken(registrationId: string, passNumber: string): string {
  const data = `${registrationId}:${passNumber}`;
  const encoded = Buffer.from(data, 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getQrSigningKey())
    .update(`qr:${encoded}`)
    .digest('base64url');
  return `adm.${encoded}.${sig}`;
}

export function verifyAdminQrToken(
  token: string
): { registrationId: string; passNumber: string } | null {
  try {
    if (!token.startsWith('adm.')) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [, encoded, sig] = parts;
    if (!encoded || !sig) return null;

    const expectedSig = crypto
      .createHmac('sha256', getQrSigningKey())
      .update(`qr:${encoded}`)
      .digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    if (sepIdx <= 0) return null;
    return {
      registrationId: decoded.slice(0, sepIdx),
      passNumber: decoded.slice(sepIdx + 1),
    };
  } catch {
    return null;
  }
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  if (!globalThis._ignitionRateLimits) {
    globalThis._ignitionRateLimits = new Map();
  }
  const now = Date.now();
  const timestamps = (globalThis._ignitionRateLimits.get(key) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxAttempts) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    globalThis._ignitionRateLimits.set(key, timestamps);
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  globalThis._ignitionRateLimits.set(key, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

export function clearRateLimit(key: string): void {
  globalThis._ignitionRateLimits?.delete(key);
}
