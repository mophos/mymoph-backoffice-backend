import crypto from 'crypto';

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('hex');

export const sha256 = (value: string) => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

export const codeChallengeS256 = (verifier: string) => {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
};
