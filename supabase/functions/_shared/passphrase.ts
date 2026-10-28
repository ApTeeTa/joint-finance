/** Constant-time string compare (same length only). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

export function verifyPassphrase(input: string): boolean {
  const expected = Deno.env.get("FAMILY_PASSPHRASE");
  if (!expected || !input) {
    return false;
  }
  return timingSafeEqual(input, expected);
}
