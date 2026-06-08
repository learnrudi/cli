export function getRelatedSkillIds(pkg) {
  const skills = Array.isArray(pkg?.related?.skills) ? pkg.related.skills : [];
  const ids = [];
  const seen = new Set();

  for (const value of skills) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    const id = trimmed.startsWith('skill:')
      ? trimmed
      : trimmed.startsWith('prompt:')
        ? trimmed.replace(/^prompt:/, 'skill:')
        : trimmed.includes(':')
          ? null
          : `skill:${trimmed}`;

    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function formatRelatedSkillsLine(pkg, options = {}) {
  const { label = 'Related skills' } = options;
  const ids = getRelatedSkillIds(pkg);
  if (ids.length === 0) return null;
  return `${label}: ${ids.join(', ')}`;
}
