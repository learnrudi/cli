/**
 * JSON Schema validation for manifests
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Stack manifest JSON schema
 */
export const stackSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', pattern: '^(stack:)?[a-z0-9-]+$' },
    kind: { const: 'stack' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
    description: { type: 'string' },
    author: { type: 'string' },
    license: { type: 'string' },
    entry: { type: 'string' },
    requires: {
      type: 'object',
      properties: {
        runtimes: {
          type: 'array',
          items: { type: 'string' }
        },
        npm: {
          type: 'array',
          items: { type: 'string' }
        },
        pip: {
          type: 'array',
          items: { type: 'string' }
        },
        secrets: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  required: { type: 'boolean' },
                  description: { type: 'string' },
                  link: { type: 'string', format: 'uri' },
                  hint: { type: 'string' }
                }
              }
            ]
          }
        }
      }
    },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'number', 'boolean', 'path', 'file', 'select'] },
          description: { type: 'string' },
          default: {},
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'file', 'url', 'json'] },
          description: { type: 'string' }
        }
      }
    }
  }
};

/**
 * Skill manifest JSON schema
 */
export const skillSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', pattern: '^(skill:)?[a-z0-9-]+$' },
    kind: { const: 'skill' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    category: { enum: ['coding', 'writing', 'analysis', 'creative', 'productivity', 'business', 'automation', 'marketing', 'development', 'communication'] },
    tags: { type: 'array', items: { type: 'string' } },
    template: { type: 'string' },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'text', 'select', 'file'] },
          description: { type: 'string' },
          default: {},
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    requires: {
      type: 'object',
      properties: {
        stacks: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  }
};

/**
 * Prompt manifest JSON schema (backward compatibility)
 */
export const promptSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', pattern: '^(prompt:)?[a-z0-9-]+$' },
    kind: { const: 'prompt' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    category: { enum: ['coding', 'writing', 'analysis', 'creative'] },
    tags: { type: 'array', items: { type: 'string' } },
    template: { type: 'string' },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'text', 'select', 'file'] },
          description: { type: 'string' },
          default: {},
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
};

/**
 * Workflow manifest JSON schema
 */
export const workflowSchema = {
  type: 'object',
  required: ['id', 'name', 'steps'],
  properties: {
    id: { type: 'string', pattern: '^(workflow:)?[a-z0-9-]+$' },
    kind: { const: 'workflow' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'text', 'number', 'boolean', 'file', 'path', 'select'] },
          description: { type: 'string' },
          default: {},
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    requires: {
      type: 'object',
      properties: {
        stacks: {
          type: 'array',
          items: { type: 'string' }
        },
        skills: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          uses: { type: 'string' },
          run: { type: 'string' },
          with: { type: 'object' },
          needs: { type: 'array', items: { type: 'string' } },
          timeoutMs: { type: 'integer', minimum: 1 }
        },
        anyOf: [
          { required: ['uses'] },
          { required: ['run'] }
        ]
      }
    },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          type: { enum: ['string', 'file', 'url', 'json'] },
          description: { type: 'string' }
        }
      }
    },
    permissions: {
      type: 'object'
    }
  }
};

/**
 * Runtime descriptor JSON schema
 */
export const runtimeSchema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string', pattern: '^(runtime:)?[a-z0-9-]+$' },
    kind: { const: 'runtime' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string' },
    description: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    binaries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['platform', 'url', 'sha256'],
        properties: {
          platform: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          size: { type: 'integer', minimum: 0 }
        }
      }
    }
  }
};

// Compile validators
const validateStackInternal = ajv.compile(stackSchema);
const validateSkillInternal = ajv.compile(skillSchema);
const validatePromptInternal = ajv.compile(promptSchema);
const validateWorkflowInternal = ajv.compile(workflowSchema);
const validateRuntimeInternal = ajv.compile(runtimeSchema);

/**
 * Validate a stack manifest
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStack(manifest) {
  const valid = validateStackInternal(manifest);
  return {
    valid,
    errors: valid ? [] : formatErrors(validateStackInternal.errors)
  };
}

/**
 * Validate a skill manifest
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSkill(manifest) {
  const valid = validateSkillInternal(manifest);
  return {
    valid,
    errors: valid ? [] : formatErrors(validateSkillInternal.errors)
  };
}

/**
 * Validate a prompt manifest (backward compatibility)
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePrompt(manifest) {
  const valid = validatePromptInternal(manifest);
  return {
    valid,
    errors: valid ? [] : formatErrors(validatePromptInternal.errors)
  };
}

/**
 * Validate a workflow manifest
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorkflow(manifest) {
  const valid = validateWorkflowInternal(manifest);
  return {
    valid,
    errors: valid ? [] : formatErrors(validateWorkflowInternal.errors)
  };
}

/**
 * Validate a runtime descriptor
 * @param {Object} descriptor
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRuntime(descriptor) {
  const valid = validateRuntimeInternal(descriptor);
  return {
    valid,
    errors: valid ? [] : formatErrors(validateRuntimeInternal.errors)
  };
}

/**
 * Format AJV errors into readable strings
 */
function formatErrors(errors) {
  if (!errors) return [];

  return errors.map(err => {
    const path = err.instancePath || 'root';
    return `${path}: ${err.message}`;
  });
}

/**
 * Validate any manifest based on kind
 * @param {Object} manifest
 * @returns {{ valid: boolean, errors: string[], kind: string|null }}
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'], kind: null };
  }

  // Detect kind from id prefix or explicit kind field
  let kind = manifest.kind;
  if (!kind && manifest.id) {
    const match = manifest.id.match(/^(stack|skill|prompt|workflow|runtime|tool|agent):/);
    kind = match ? match[1] : null;
  }

  switch (kind) {
    case 'stack':
      return { ...validateStack(manifest), kind: 'stack' };
    case 'skill':
      return { ...validateSkill(manifest), kind: 'skill' };
    case 'prompt':
      return { ...validatePrompt(manifest), kind: 'prompt' };
    case 'workflow':
      return { ...validateWorkflow(manifest), kind: 'workflow' };
    case 'runtime':
      return { ...validateRuntime(manifest), kind: 'runtime' };
    default:
      return { valid: false, errors: ['Unknown manifest kind'], kind: null };
  }
}
