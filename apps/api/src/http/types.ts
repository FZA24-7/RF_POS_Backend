import type { Request, Response } from 'express';
import type { createAuthController } from './controllers/auth.controller.js';
import type { createUsersController } from './controllers/users.controller.js';

export type Handler = (req: Request, res: Response) => Promise<void> | void;
export type AuthController = ReturnType<typeof createAuthController>;
export type UsersController = ReturnType<typeof createUsersController>;
