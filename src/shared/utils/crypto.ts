import crypto from 'crypto';

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('hex');

export const randomDigits = (length = 10) => {
  if (length <= 0) return '';
  const digits: string[] = [];
  // fill digits using secure random bytes
  while (digits.length < length) {
    const buf = crypto.randomBytes(length - digits.length);
    for (let i = 0; i < buf.length && digits.length < length; i++) {
      digits.push(String(buf[i] % 10));
    }
  }
  return digits.join('');
};

export const sha256 = (value: string) => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

export const codeChallengeS256 = (verifier: string) => {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
};
