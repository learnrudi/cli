export const NATIVE_SKILL_HOSTS = Object.freeze(['codex', 'claude', 'gemini', 'antigravity']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateNativeSkillPolicy(value) {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.skills)
    || Object.keys(value).some(key => !['schemaVersion', 'skills'].includes(key))) {
    throw new Error('Invalid native skill policy: expected schemaVersion 1 and skills object');
  }
  const names = new Set();
  for (const [id, rule] of Object.entries(value.skills)) {
    if (!id.startsWith('skill:') || !NAME.test(id.slice(6)) || !object(rule)
      || Object.keys(rule).some(key => !['name', 'hosts'].includes(key))) {
      throw new Error(`Invalid native skill policy entry: ${id}`);
    }
    const name = rule.name === undefined ? id.slice(6) : rule.name;
    if (typeof name !== 'string' || name.length > 64 || !NAME.test(name)) {
      throw new Error(`Invalid native skill policy name for ${id}`);
    }
    if (rule.hosts !== undefined && (!Array.isArray(rule.hosts)
      || rule.hosts.some(host => !NATIVE_SKILL_HOSTS.includes(host))
      || new Set(rule.hosts).size !== rule.hosts.length)) {
      throw new Error(`Invalid native skill policy hosts for ${id}`);
    }
    if (names.has(name)) throw new Error(`Native skill policy name collision: ${name}`);
    names.add(name);
  }
  return value;
}

export function resolveNativeSkillRule(policy, id, host) {
  const rule = policy.skills[id];
  const name = rule?.name ?? id.slice(6);
  // Reserve aliases even when the other package has not yet been installed.
  for (const [owner, other] of Object.entries(policy.skills)) {
    if (owner !== id && (other.name ?? owner.slice(6)) === name) {
      throw new Error(`Native skill policy name collision: ${id} and ${owner}`);
    }
  }
  return { name, allowed: !rule?.hosts || rule.hosts.includes(host) };
}
