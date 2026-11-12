/**
 * Cloud Save P10 — scans built app bundles (web JS, Android Hermes bytecode)
 * for privileged Supabase credentials. Reports only WHERE and WHAT KIND,
 * never the credential value.
 *
 * Flags:
 * - any JWT whose payload role is service_role or supabase_admin;
 * - any `sb_secret_` key: the prefix followed by a high-entropy run.
 * Not flagged: the app's own literal prefix check (`'sb_secret_'` in
 * src/services/supabase/config.ts). Hermes stores string literals back to
 * back, so the literal is followed by unrelated text — low entropy and
 * made of words, unlike a random key.
 */

export interface SecretFinding {
  file: string;
  kind: 'service_role_jwt' | 'secret_api_key';
  offset: number;
}

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const SECRET_KEY = /sb_secret_([A-Za-z0-9_-]{16,})/g;

export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A run that looks like a random key rather than adjacent words: long, digits AND mixed case, high entropy. */
export function looksLikeRandomKey(run: string): boolean {
  const sample = run.slice(0, 40);
  return (
    sample.length >= 24 &&
    /[0-9]/.test(sample) &&
    /[a-z]/.test(sample) &&
    /[A-Z]/.test(sample) &&
    shannonEntropy(sample) >= 4.2
  );
}

function decodeRole(payloadSegment: string): string | null {
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** Scans one file's contents (read as latin1 so binary bundles keep byte offsets). */
export function scanContent(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const m of content.matchAll(JWT)) {
    const role = decodeRole(m[1]);
    if (role === 'service_role' || role === 'supabase_admin') {
      findings.push({ file, kind: 'service_role_jwt', offset: m.index ?? 0 });
    }
  }
  for (const m of content.matchAll(SECRET_KEY)) {
    if (looksLikeRandomKey(m[1])) findings.push({ file, kind: 'secret_api_key', offset: m.index ?? 0 });
  }
  return findings;
}
