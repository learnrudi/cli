import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const ARTIFACT_KINDS = Object.freeze([
  'blob',
  'directory',
  'document',
  'file',
  'image',
  'json',
  'other',
  'video',
]);

export const ARTIFACT_OWNER_KINDS = Object.freeze([
  'agent_session',
  'package_run',
  'run_group',
  'user',
]);

export const ArtifactOwnerSchema = deepFreezeSchema({
  title: 'ArtifactOwner',
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: { type: 'string', enum: ARTIFACT_OWNER_KINDS },
    id: { type: 'string', minLength: 1 },
  },
});

export const ArtifactSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/artifact.schema.json',
  title: 'Artifact',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'path', 'createdAt', 'source', 'owner', 'metadata'],
  properties: {
    id: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: ARTIFACT_KINDS },
    path: { type: 'string', minLength: 1 },
    mimeType: { type: ['string', 'null'] },
    bytes: { type: ['integer', 'null'], minimum: 0 },
    createdAt: IsoDateTimeSchema,
    source: { type: 'string', minLength: 1 },
    owner: ArtifactOwnerSchema,
    metadata: JsonObjectSchema,
  },
});

export function validateArtifact(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['artifact must be an object']);
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    errors.push('id is required');
  }
  if (!ARTIFACT_KINDS.includes(value.kind)) {
    errors.push('kind must be a known artifact kind');
  }
  if (typeof value.path !== 'string' || value.path.length === 0) {
    errors.push('path is required');
  }
  if (value.bytes !== null && value.bytes !== undefined && (!Number.isInteger(value.bytes) || value.bytes < 0)) {
    errors.push('bytes must be a non-negative integer or null');
  }
  return validationResult(errors);
}
