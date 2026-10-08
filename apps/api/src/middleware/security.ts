import type { RequestHandler, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { logger } from '../config/clients';
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session.userId)
    return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
  next();
};
export const protectOrigin: RequestHandler = (req, _res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin !== new URL(env.FRONTEND_URL).origin
  )
    return next(
      new AppError(403, 'INVALID_ORIGIN', 'This request must come from the application.'),
    );
  next();
};
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const validation = error instanceof ZodError;
  const malformedJson = error instanceof SyntaxError && 'body' in error;
  const tooLarge =
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large';
  const status =
    error instanceof AppError
      ? error.status
      : validation || malformedJson
        ? 400
        : tooLarge
          ? 413
          : 500;
  if (status >= 500)
    logger.error(
      { error: error instanceof Error ? error.name : 'Unknown', requestId: req.id },
      'Request failed',
    );
  res.status(status).json({
    success: false,
    error: {
      code:
        error instanceof AppError
          ? error.code
          : validation || malformedJson
            ? 'VALIDATION_ERROR'
            : tooLarge
              ? 'PAYLOAD_TOO_LARGE'
              : 'INTERNAL_ERROR',
      message:
        error instanceof AppError
          ? error.message
          : validation
            ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
            : malformedJson
              ? 'Request body must be valid JSON.'
              : tooLarge
                ? 'This request exceeds the configured upload limit.'
                : 'Something went wrong. Please try again.',
    },
  });
};
