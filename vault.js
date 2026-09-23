/* Decrypts data/site.enc.json in the browser (WebCrypto). Written by scripts/lfdata.py:
   gzip(JSON) encrypted with AES-256-GCM, key = PBKDF2-SHA256(master password, salt). */
const SiteVault = (() => {
  const KEY = 'alliance-tracker.site-password';
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  async function open(bundle, password) {
    if (!bundle || bundle.v !== 1 || bundle.cipher !== 'AES-256-GCM') throw new Error('Unsupported data format');
    const subtle = globalThis.crypto.subtle;
    const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({name: 'PBKDF2', salt: bytes(bundle.salt), iterations: bundle.iterations, hash: 'SHA-256'},
      base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    let plain;
    try { plain = await subtle.decrypt({name: 'AES-GCM', iv: bytes(bundle.iv)}, key, bytes(bundle.data)); }
    catch { throw new Error('Wrong password'); }
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }

  // Remembered password: this tab only by default, this device when asked. Storage may be blocked.
  function saved() {
    for (const store of ['sessionStorage', 'localStorage']) {
      try { const v = globalThis[store]?.getItem(KEY); if (v) return v; } catch {}
    }
    return null;
  }
  function remember(password, onDevice) {
    try { (onDevice ? localStorage : sessionStorage).setItem(KEY, password); } catch {}
  }
  function forget() {
    for (const store of ['sessionStorage', 'localStorage']) { try { globalThis[store]?.removeItem(KEY); } catch {} }
  }
  return {open, saved, remember, forget};
})();
if (typeof module !== 'undefined') module.exports = SiteVault;
