import type { CookieOptions, Request, Response } from 'express';
import type { LoginInput } from '@mafk/validation';
import type { AuthService } from '../../services/auth.service.js';
import { DomainError } from '../../domain/types.js';

const REFRESH_COOKIE_NAME = 'mafk_refresh_token';

export interface AuthControllerConfig {
  isProduction: boolean;
  refreshTokenTtlDays: number;
}

const refreshCookieOptions = (config: AuthControllerConfig): CookieOptions => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: config.refreshTokenTtlDays * 86_400_000,
});

const clientMeta = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

export const createAuthController = (authService: AuthService, config: AuthControllerConfig) => ({
  async login(req: Request, res: Response): Promise<void> {
    const { loginId, password } = req.body as LoginInput;
    const result = await authService.login(loginId, password, clientMeta(req));
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(config));
    res.status(200).json({ accessToken: result.accessToken, user: result.user });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!token) {
      throw new DomainError('SESSION_REVOKED', 'No active session.', 401);
    }
    const result = await authService.refresh(token);
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(config));
    res.status(200).json({ accessToken: result.accessToken });
  },

  async me(req: Request, res: Response): Promise<void> {
    // requireAuth guarantees req.auth; the user id comes from the verified token, never from the request body.
    const user = await authService.me(req.auth!.userId);
    res.status(200).json({ user });
  },

  async logout(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (token) {
      await authService.logout(token);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    res.status(204).send();
  },
});
