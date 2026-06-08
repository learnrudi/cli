/**
 * HTTP boundary middleware for the local daemon.
 *
 * Keeps auth and CORS behavior explicit and testable outside the serve command.
 */

import { URL } from 'url';

export function buildHttpAuthMiddleware(ctx) {
  const {
    checkAuth,
    error,
    log,
    updateRequestAuth,
    REQUEST_ID_HEADER,
  } = ctx;

  function handleCorsPreflight(req, res, requestContext) {
    if (req.method !== 'OPTIONS') return false;

    updateRequestAuth(res, { required: false, result: 'skipped' });
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Rudi-Token, X-Rudi-Caller-Session',
      ...(requestContext?.requestId ? { [REQUEST_ID_HEADER]: requestContext.requestId } : {}),
    });
    res.end();
    return true;
  }

  function requireAuth(req, res, url) {
    if (checkAuth(req)) {
      updateRequestAuth(res, { required: true, result: 'passed' });
      return true;
    }

    const requestUrl = url || new URL(req.url || '/', 'http://localhost');
    updateRequestAuth(res, { required: true, result: 'failed' });
    log('http', 'warn', 'auth_failed', {
      requestId: res?._rudiRequestContext?.requestId || null,
      method: req.method,
      path: requestUrl.pathname,
      status: 401,
    });
    error(res, 'Unauthorized', 401);
    return false;
  }

  return {
    handleCorsPreflight,
    requireAuth,
  };
}
