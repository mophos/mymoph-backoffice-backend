import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { mymophDb, systemDb } from '../../db/knex';
import { config } from '../../config/env';
import { authMiddleware } from '../../middleware/auth.middleware';
import { AuthModel } from './auth.model';
import { AuthService } from './auth.service';

const ACCESS_COOKIE = 'moph_bo_access';
const REFRESH_COOKIE = 'moph_bo_refresh';
const CONTEXT_COOKIE = 'moph_bo_oauth_ctx';

const authService = new AuthService(new AuthModel(systemDb, mymophDb));
const router = Router();

const secureCookie = {
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  domain: config.cookie.domain,
  path: '/'
} as const;

router.get('/login-url', async (req, res) => {
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
  const { authorizationUrl, encodedContext } = authService.getLoginUrl(returnTo);

  res.cookie(CONTEXT_COOKIE, encodedContext, {
    ...secureCookie,
    maxAge: 10 * 60 * 1000
  });

  res.json({ ok: true, data: { authorizationUrl } });
});

router.get('/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code || !state) {
    res.status(StatusCodes.BAD_REQUEST).json({ ok: false, error: 'MISSING_OAUTH_CODE_OR_STATE' });
    return;
  }

  try {
    const result = await authService.completeCallback({
      code,
      state,
      encodedContext: req.cookies?.[CONTEXT_COOKIE],
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.clearCookie(CONTEXT_COOKIE, { ...secureCookie });

    if (!result.ok || !result.data) {
      res.status(result.status).json({ ok: false, error: result.error });
      return;
    }

    res.cookie(ACCESS_COOKIE, result.data.accessToken, {
      ...secureCookie,
      maxAge: result.data.expiresInSeconds * 1000
    });

    res.cookie(REFRESH_COOKIE, result.data.refreshToken, {
      ...secureCookie,
      maxAge: config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000
    });

    if (req.query.mode === 'json') {
      res.status(StatusCodes.OK).json({ ok: true, data: result.data });
      return;
    }

    res.redirect(`${config.frontendBaseUrl}/auth/callback`);
  } catch (error) {
    console.error('[auth/callback]', error);
    res.status(StatusCodes.BAD_GATEWAY).json({ ok: false, error: 'OAUTH_CALLBACK_FAILED' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  const data = await authService.meFromAuth(req.auth!);
  res.json({ ok: true, data });
});

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  if (!refreshToken) {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'MISSING_REFRESH_TOKEN' });
    return;
  }

  const result = await authService.refresh(refreshToken, req.ip, req.get('user-agent'));
  if (!result.ok || !result.data) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }

  res.cookie(ACCESS_COOKIE, result.data.accessToken, {
    ...secureCookie,
    maxAge: result.data.expiresInSeconds * 1000
  });

  res.cookie(REFRESH_COOKIE, result.data.refreshToken, {
    ...secureCookie,
    maxAge: config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000
  });

  res.json({ ok: true, data: result.data });
});

router.post('/logout', authMiddleware, async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  await authService.logout(refreshToken);

  res.clearCookie(ACCESS_COOKIE, { ...secureCookie });
  res.clearCookie(REFRESH_COOKIE, { ...secureCookie });

  res.json({ ok: true });
});

export const authRoutes = router;
