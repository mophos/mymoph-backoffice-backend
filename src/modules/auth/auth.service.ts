import { StatusCodes } from 'http-status-codes';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { SUPER_ADMIN_ROLE } from '../../shared/constants/permissions';
import { MenuService } from '../menu/menu.service';
import { JwtService } from '../../shared/services/jwt.service';
import { OAuthClientService } from '../../shared/services/oauth-client.service';
import { codeChallengeS256, randomToken, randomDigits, sha256 } from '../../shared/utils/crypto';
import type { AuthContext, OAuthUserInfo } from '../../shared/types/auth';
import { AuthModel } from './auth.model';

interface LoginContext {
  state: string;
  codeVerifier: string;
  returnTo?: string;
  createdAt: number;
}

export class AuthService {
  private readonly oauthClient = new OAuthClientService();
  private readonly jwtService = new JwtService();
  private readonly menuService = new MenuService();

  constructor(private readonly authModel: AuthModel) { }

  getLoginUrl(returnTo?: string) {
    const state = randomDigits(10);
    const codeVerifier = randomToken(32);
    const codeChallenge = codeChallengeS256(codeVerifier);
    const authorizationUrl = this.oauthClient.buildAuthorizeUrl(state, codeChallenge);

    const context: LoginContext = {
      state,
      codeVerifier,
      returnTo,
      createdAt: Date.now()
    };

    const encodedContext = Buffer.from(JSON.stringify(context)).toString('base64url');
    return { authorizationUrl, encodedContext };
  }

  async completeCallback(input: {
    code: string;
    state: string;
    encodedContext?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const context = this.decodeLoginContext(input.encodedContext);
    if (!context || context.state !== input.state) {
      return {
        ok: false,
        status: StatusCodes.UNAUTHORIZED,
        error: 'INVALID_OAUTH_STATE'
      };
    }

    if ((Date.now() - context.createdAt) > (10 * 60 * 1000)) {
      return {
        ok: false,
        status: StatusCodes.UNAUTHORIZED,
        error: 'OAUTH_STATE_EXPIRED'
      };
    }

    const tokenData = await this.oauthClient.exchangeCodeForToken(input.code, context.codeVerifier);
    const userInfo = await this.oauthClient.getUserInfo(tokenData.access_token);
    const idTokenClaims = this.decodeIdTokenClaims(tokenData.id_token);
    const mergedUserInfo: OAuthUserInfo = {
      ...idTokenClaims,
      ...userInfo
    };

    const cid = this.extractCid(mergedUserInfo);
    if (!cid) {
      return {
        ok: false,
        status: StatusCodes.UNAUTHORIZED,
        error: 'MYMOPH_CID_NOT_FOUND'
      };
    }

    const providerSubject = String(mergedUserInfo.sub ?? cid);
    const fallbackProfile = await this.authModel.getMyMophProfileByCid(cid);
    const splitName = this.splitDisplayName(mergedUserInfo);
    const firstName = this.pickFirstName(mergedUserInfo) ?? splitName.firstName ?? fallbackProfile.firstName;
    const lastName = this.pickLastName(mergedUserInfo) ?? splitName.lastName ?? fallbackProfile.lastName;
    const email = this.pickEmail(mergedUserInfo) ?? fallbackProfile.email;

    if (!firstName || !lastName) {
      console.warn(
        `[auth/callback] missing_name_claims cid=${cid} keys=${Object.keys(mergedUserInfo).join(',')}`
      );
    }

    const user = await this.authModel.upsertUser({
      cid,
      firstName,
      lastName,
      email
    });

    await this.authModel.upsertIdentityMapping({
      userId: user.id,
      cid,
      provider: 'mymoph',
      providerSubject
    });

    const authContext = await this.loadAuthContext(
      user.id,
      cid,
      {
        ...mergedUserInfo,
        given_name: firstName ?? mergedUserInfo.given_name,
        family_name: lastName ?? mergedUserInfo.family_name,
        email: email ?? mergedUserInfo.email
      },
      user.defaultHospcode
    );
    const accessToken = this.jwtService.signAccessToken(authContext);

    const refreshToken = randomToken(48);
    await this.authModel.createRefreshSession({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + (config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000)),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        accessToken,
        refreshToken,
        expiresInSeconds: this.jwtService.getTokenRemainingSeconds(accessToken),
        user: {
          id: authContext.userId,
          cid: authContext.cid,
          displayName: authContext.displayName,
          roles: authContext.roles,
          permissions: authContext.permissions,
          scopeType: authContext.scopeType,
          hospcodes: authContext.hospcodes,
          allowedModules: this.menuService.getAllowedModules(authContext.permissions),
          menus: this.menuService.getMenusByPermissions(authContext.permissions)
        }
      }
    };
  }

  async meFromAuth(auth: AuthContext) {
    return {
      user: {
        id: auth.userId,
        cid: auth.cid,
        displayName: auth.displayName,
        roles: auth.roles,
        permissions: auth.permissions,
        scopeType: auth.scopeType,
        hospcodes: auth.hospcodes,
        allowedModules: this.menuService.getAllowedModules(auth.permissions),
        menus: this.menuService.getMenusByPermissions(auth.permissions)
      }
    };
  }

  async refresh(refreshTokenRaw: string, ipAddress?: string, userAgent?: string) {
    const tokenHash = sha256(refreshTokenRaw);
    const session = await this.authModel.findActiveRefreshSessionByHash(tokenHash);

    if (!session) {
      return { ok: false, status: StatusCodes.UNAUTHORIZED, error: 'INVALID_REFRESH_TOKEN' };
    }

    await this.authModel.revokeRefreshSessionByHash(tokenHash);

    const user = await this.authModel.getUserById(session.user_id);
    if (!user) {
      return { ok: false, status: StatusCodes.UNAUTHORIZED, error: 'USER_DISABLED' };
    }

    const authContext = await this.loadAuthContext(user.id, user.cid, {
      given_name: user.first_name ?? user.fname,
      family_name: user.last_name ?? user.lname,
      email: user.email,
      cid: user.cid
    }, user.default_hospcode ?? undefined);

    const accessToken = this.jwtService.signAccessToken(authContext);
    const newRefreshToken = randomToken(48);

    await this.authModel.createRefreshSession({
      userId: user.id,
      tokenHash: sha256(newRefreshToken),
      expiresAt: new Date(Date.now() + (config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000)),
      ipAddress,
      userAgent
    });

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresInSeconds: this.jwtService.getTokenRemainingSeconds(accessToken)
      }
    };
  }

  async logout(refreshTokenRaw?: string): Promise<void> {
    if (!refreshTokenRaw) return;
    await this.authModel.revokeRefreshSessionByHash(sha256(refreshTokenRaw));
  }

  private async loadAuthContext(
    userId: string,
    cid: string,
    userInfo: OAuthUserInfo,
    defaultHospcode?: string
  ): Promise<AuthContext> {
    const roleCodes = await this.authModel.getRoleCodes(userId);
    const permissions = (await this.authModel.getPermissionCodes(userId)) as AuthContext['permissions'];

    const isSuperAdmin = roleCodes.includes(SUPER_ADMIN_ROLE);
    const scopes = isSuperAdmin
      ? []
      : await this.authModel.getHospcodeScopes(userId);

    const hospcodes = scopes.length ? scopes : (defaultHospcode ? [defaultHospcode] : []);

    return {
      userId,
      cid,
      roles: roleCodes,
      permissions,
      hospcodes,
      scopeType: isSuperAdmin ? 'ALL' : 'LIST',
      displayName: this.pickDisplayName(userInfo)
    };
  }

  private decodeLoginContext(encodedContext?: string): LoginContext | null {
    if (!encodedContext) return null;

    try {
      const text = Buffer.from(encodedContext, 'base64url').toString('utf8');
      const context = JSON.parse(text) as LoginContext;
      if (!context.state || !context.codeVerifier || !context.createdAt) return null;
      return context;
    } catch {
      return null;
    }
  }

  private extractCid(userInfo: OAuthUserInfo): string | null {
    const cid = userInfo.cid ?? userInfo.sub;
    if (!cid) return null;

    const value = String(cid).trim();
    return value.length ? value : null;
  }

  private pickDisplayName(userInfo: OAuthUserInfo): string | undefined {
    if (typeof userInfo.name === 'string' && userInfo.name.trim()) {
      return userInfo.name.trim();
    }

    const first = this.pickFirstName(userInfo);
    const last = this.pickLastName(userInfo);
    const full = `${first ?? ''} ${last ?? ''}`.trim();
    return full || undefined;
  }

  private pickFirstName(userInfo: OAuthUserInfo): string | undefined {
    return this.pickString(userInfo, [
      'given_name',
      'first_name',
      'firstName',
      'givenName',
      'fname',
      'firstname',
      'givenname',
      'th_first_name',
      'thFirstname'
    ]);
  }

  private pickLastName(userInfo: OAuthUserInfo): string | undefined {
    return this.pickString(userInfo, [
      'family_name',
      'last_name',
      'lastName',
      'familyName',
      'lname',
      'lastname',
      'familyname',
      'th_last_name',
      'thLastname',
      'surname'
    ]);
  }

  private pickEmail(userInfo: OAuthUserInfo): string | undefined {
    return this.pickString(userInfo, ['email', 'mail', 'emailAddress']);
  }

  private splitDisplayName(userInfo: OAuthUserInfo): { firstName?: string; lastName?: string } {
    const fullName = this.pickString(userInfo, ['name', 'displayName', 'full_name', 'fullname']);
    if (!fullName) {
      return {};
    }

    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return {};
    }

    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1]
    };
  }

  private pickString(userInfo: OAuthUserInfo, keys: string[]): string | undefined {
    const source = userInfo as Record<string, unknown>;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private decodeIdTokenClaims(idToken?: string): OAuthUserInfo {
    if (!idToken) {
      return {};
    }

    const decoded = jwt.decode(idToken);
    if (!decoded || typeof decoded !== 'object') {
      return {};
    }

    return decoded as OAuthUserInfo;
  }
}
