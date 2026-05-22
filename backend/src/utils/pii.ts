/**
 * PII Redaction engine utilizing optimized, compiled regular expressions.
 * Scans text content for:
 * - Email addresses
 * - Credit card numbers (13 to 16 digit sequences)
 * - US Social Security Numbers (SSN)
 * - Raw secrets, passwords, and API key signatures (e.g., Bearer, api_key, secret, etc.)
 */

export const PII_PATTERNS = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  US_SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  API_KEY: /(?:api_key|secret|password|bearer\s|auth_token)[=: ]+([a-zA-Z0-9\-_\.]{8,})/gi,
};

/**
 * Sweeps a target block of text and masks all identified sensitive criteria.
 */
export function redactPII(text: string): string {
  if (!text) return text;

  let redacted = text;

  // 1. Redact Emails
  redacted = redacted.replace(PII_PATTERNS.EMAIL, '[REDACTED_EMAIL]');

  // 2. Redact Credit Cards (filtering digits to avoid masking arbitrary numbers)
  redacted = redacted.replace(PII_PATTERNS.CREDIT_CARD, (match) => {
    const numericStr = match.replace(/[- ]/g, '');
    if (numericStr.length >= 13 && numericStr.length <= 16) {
      return '[REDACTED_CARD]';
    }
    return match;
  });

  // 3. Redact US SSNs
  redacted = redacted.replace(PII_PATTERNS.US_SSN, '[REDACTED_SSN]');

  // 4. Redact API Keys / Passwords / Authorization Secrets
  redacted = redacted.replace(PII_PATTERNS.API_KEY, (match, keyToken) => {
    const keyIndex = match.indexOf(keyToken);
    const labelPrefix = match.substring(0, keyIndex);
    return `${labelPrefix}[REDACTED_SECRET]`;
  });

  return redacted;
}
