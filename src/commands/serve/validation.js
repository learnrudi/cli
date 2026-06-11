import path from 'path';
import { SIDECAR_ERROR_CODES } from './error-codes.js';

export const DESTRUCTIVE_CONFIRMATION_FIELD = 'confirmDestructive';
export const EXPLICIT_CONFIRMATION_REQUIRED = 'explicit_confirmation_required';
export const ABSOLUTE_PATH_REQUIRED = 'absolute_path_required';
export const FILESYSTEM_ROOT_FORBIDDEN = 'filesystem_root_forbidden';
export const INVALID_TYPE = 'invalid_type';

function rejectInvalidField({
  res,
  invalidField,
  error,
  field,
  location = 'body',
  message,
  reason,
  details = {},
}) {
  if (typeof invalidField === 'function') {
    invalidField(res, field, message, {
      location,
      reason,
      details,
    });
    return true;
  }

  error(res, message, 400, {
    code: SIDECAR_ERROR_CODES.INVALID_FIELD,
    details: {
      field,
      location,
      reason,
      ...details,
    },
  });
  return true;
}

export function hasDestructiveConfirmation(body) {
  return body?.[DESTRUCTIVE_CONFIRMATION_FIELD] === true;
}

export function rejectMissingDestructiveConfirmation({
  body,
  res,
  invalidField,
  error,
  operation,
}) {
  if (hasDestructiveConfirmation(body)) return false;

  const message = `${DESTRUCTIVE_CONFIRMATION_FIELD} must be true for ${operation}`;
  const details = { operation };

  if (typeof invalidField === 'function') {
    invalidField(res, DESTRUCTIVE_CONFIRMATION_FIELD, message, {
      reason: EXPLICIT_CONFIRMATION_REQUIRED,
      details,
    });
    return true;
  }

  error(res, message, 400, {
    code: SIDECAR_ERROR_CODES.INVALID_FIELD,
    details: {
      field: DESTRUCTIVE_CONFIRMATION_FIELD,
      location: 'body',
      reason: EXPLICIT_CONFIRMATION_REQUIRED,
      ...details,
    },
  });
  return true;
}

export function rejectInvalidPathField({
  value,
  field = 'path',
  location = 'body',
  res,
  invalidField,
  error,
  allowRoot = true,
}) {
  const absolutePathMessage = `${field} must be an absolute filesystem path`;

  if (typeof value !== 'string') {
    return rejectInvalidField({
      res,
      invalidField,
      error,
      field,
      location,
      message: absolutePathMessage,
      reason: INVALID_TYPE,
    });
  }

  if (value.trim() === '' || value.includes('\0') || !path.isAbsolute(value)) {
    return rejectInvalidField({
      res,
      invalidField,
      error,
      field,
      location,
      message: absolutePathMessage,
      reason: ABSOLUTE_PATH_REQUIRED,
    });
  }

  const resolvedPath = path.resolve(value);
  if (!allowRoot && resolvedPath === path.parse(resolvedPath).root) {
    return rejectInvalidField({
      res,
      invalidField,
      error,
      field,
      location,
      message: `${field} must not be the filesystem root`,
      reason: FILESYSTEM_ROOT_FORBIDDEN,
    });
  }

  return false;
}
