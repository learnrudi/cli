/**
 * Skill manifest parsing and validation
 */

import { parse as parseYaml } from 'yaml';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} SkillManifest
 * @property {string} id - Unique identifier (e.g., 'skill:brainstorm')
 * @property {string} kind - Always 'skill'
 * @property {string} name - Display name
 * @property {string} version - Semver version
 * @property {string} [description] - Short description
 * @property {string} [author] - Author name
 * @property {string} [category] - Category (coding, writing, analysis, creative, productivity, business, automation, marketing, development, communication)
 * @property {string[]} [tags] - Tags for search
 * @property {SkillVariable[]} [variables] - Template variables
 * @property {Object} [requires] - Dependencies
 * @property {string[]} [requires.stacks] - Required stacks
 * @property {string} template - The skill template (Markdown with {{variables}})
 */

/**
 * @typedef {Object} SkillVariable
 * @property {string} name - Variable name
 * @property {string} type - Type: 'string' | 'text' | 'select' | 'file'
 * @property {string} [description] - Description
 * @property {*} [default] - Default value
 * @property {boolean} [required] - Whether required
 * @property {string[]} [options] - Options for select type
 */

/**
 * Parse a skill manifest directory
 * Expects: skill.yaml + skill.md
 * @param {string} dir - Directory containing skill files
 * @returns {SkillManifest}
 */
export function parseSkillManifest(dir) {
  const yamlPath = path.join(dir, 'skill.yaml');
  const mdPath = path.join(dir, 'skill.md');

  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Missing skill.yaml in ${dir}`);
  }

  const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
  const manifest = parseSkillYaml(yamlContent, yamlPath);

  // Load template from skill.md if it exists
  if (fs.existsSync(mdPath)) {
    manifest.template = fs.readFileSync(mdPath, 'utf-8');
  } else if (!manifest.template) {
    throw new Error(`Missing skill.md in ${dir}`);
  }

  return manifest;
}

/**
 * Parse skill.yaml content
 * @param {string} content - YAML content
 * @param {string} [source] - Source path for error messages
 * @returns {SkillManifest}
 */
export function parseSkillYaml(content, source = 'skill.yaml') {
  const raw = parseYaml(content);

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid skill manifest in ${source}: expected object`);
  }

  const manifest = normalizeSkillManifest(raw);
  validateSkillManifest(manifest, source);

  return manifest;
}

/**
 * Normalize a raw skill manifest
 */
function normalizeSkillManifest(raw) {
  const manifest = {
    id: raw.id,
    kind: 'skill',
    name: raw.name,
    version: raw.version || '1.0.0',
    description: raw.description,
    author: raw.author,
    category: raw.category,
    tags: raw.tags || [],
    template: raw.template,
    requires: raw.requires
  };

  // Ensure id has skill: prefix
  if (manifest.id && !manifest.id.startsWith('skill:')) {
    manifest.id = `skill:${manifest.id}`;
  }

  // Normalize variables
  if (raw.variables) {
    manifest.variables = normalizeVariables(raw.variables);
  }

  return manifest;
}

/**
 * Normalize variables section
 */
function normalizeVariables(raw) {
  if (!Array.isArray(raw)) {
    return Object.entries(raw).map(([name, def]) => ({
      name,
      ...(typeof def === 'string' ? { type: def } : def)
    }));
  }

  return raw.map(v => ({
    name: v.name,
    type: v.type || 'string',
    description: v.description,
    default: v.default,
    required: v.required !== false,
    options: v.options
  }));
}

/**
 * Validate a skill manifest
 */
function validateSkillManifest(manifest, source) {
  const errors = [];

  if (!manifest.id) {
    errors.push('Missing required field: id');
  }

  if (!manifest.name) {
    errors.push('Missing required field: name');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid skill manifest in ${source}:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Render a skill template with variables
 * @param {string} template - Template with {{variables}}
 * @param {Object} values - Variable values
 * @returns {string} Rendered template
 */
export function renderSkillTemplate(template, values = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (name in values) {
      return String(values[name]);
    }
    return match; // Keep unresolved variables
  });
}

/**
 * Extract variable names from a template
 * @param {string} template - Template with {{variables}}
 * @returns {string[]} Variable names
 */
export function extractTemplateVariables(template) {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const names = new Set();
  for (const match of matches) {
    names.add(match[1]);
  }
  return Array.from(names);
}

/**
 * Find skill manifest in a directory
 * @param {string} dir - Directory to search
 * @returns {string|null} Path to skill.yaml or null
 */
export function findSkillManifest(dir) {
  const candidates = ['skill.yaml', 'skill.yml'];

  for (const filename of candidates) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}
