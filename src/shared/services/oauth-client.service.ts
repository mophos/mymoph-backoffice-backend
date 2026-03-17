import axios from 'axios';
import { config } from '../../config/env';
import type { OAuthUserInfo } from '../types/auth';

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

export class OAuthClientService {
  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.oauth.clientId,
      redirect_uri: config.oauth.redirectUri,
      scope: config.oauth.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${config.oauth.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.oauth.redirectUri,
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      code_verifier: codeVerifier
    });

    const tokenUrls = this.getTokenUrls(config.oauth.tokenUrl);
    let lastError: unknown = null;

    for (const tokenUrl of tokenUrls) {
      try {
        const { data } = await axios.post<OAuthTokenResponse>(tokenUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        });

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    if (axios.isAxiosError(lastError)) {
      const status = lastError.response?.status;
      const body = lastError.response?.data;
      throw new Error(`OAuth token exchange failed (status=${status ?? 'N/A'}) body=${JSON.stringify(body ?? {})}`);
    }

    throw lastError;
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const { data } = await axios.get<OAuthUserInfo>(config.oauth.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 10000
    });

    return data;
  }

  private getTokenUrls(rawUrl: string): string[] {
    const urls = [rawUrl];

    if (rawUrl.includes('/v1/oauth2/token')) {
      urls.push(rawUrl.replace('/v1/oauth2/token', '/oauth2/token'));
    } else if (rawUrl.includes('/oauth2/token')) {
      urls.push(rawUrl.replace('/oauth2/token', '/v1/oauth2/token'));
    }

    return [...new Set(urls)];
  }
}
