// Shared with the fixed health client; native/confine.c uses the same grammar.
export function parsePort(value) {
  if (value === undefined) return 8080;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,4}$/.test(value) || String(Number(value)) !== value || Number(value) > 65535) {
    throw new Error('PORT must be canonical decimal between 1 and 65535');
  }
  return Number(value);
}
