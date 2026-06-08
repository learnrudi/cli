import path from 'node:path';

export function applySessionDbMetadata(session, row) {
  if (!session || !row) return session;

  const display = row.title_override || row.title;
  if (display) session.dbTitle = display;
  if (row.description) session.description = row.description;
  if (row.total_cost > 0) session.totalCost = row.total_cost;
  if (row.total_input_tokens > 0) session.totalInputTokens = row.total_input_tokens;
  if (row.total_output_tokens > 0) session.totalOutputTokens = row.total_output_tokens;
  if (row.turn_count > 0) session.turnCount = row.turn_count;
  if (row.parent_session_id) session.parentSessionId = row.parent_session_id;
  if (row.is_sidechain) session.isSidechain = true;
  if (row.session_type && row.session_type !== 'main') session.sessionType = row.session_type;
  if (!session.originNativeFile && row.origin_native_file) {
    session.originNativeFile = row.origin_native_file;
  }

  return session;
}

export function applySessionTags(session, tags) {
  if (session && Array.isArray(tags) && tags.length > 0) {
    session.tags = tags;
  }
  return session;
}

export function mergeWorktreeSessionProjects(projects, options = {}) {
  const worktreeMarker = options.worktreeMarker || '/.rudi/worktrees/';
  const regularProjects = [];
  const worktreeEntries = [];

  for (const proj of Array.isArray(projects) ? projects : []) {
    const originalPath = proj.originalPath || '';
    const worktreeIndex = originalPath.indexOf(worktreeMarker);
    if (worktreeIndex !== -1) {
      worktreeEntries.push({
        realRoot: originalPath.slice(0, worktreeIndex),
        proj,
      });
    } else {
      regularProjects.push(proj);
    }
  }

  const mergedProjects = [];
  const parentMap = new Map();

  for (const proj of regularProjects) {
    const originalPath = proj.originalPath || '';
    parentMap.set(originalPath, mergedProjects.length);
    mergedProjects.push(proj);
  }

  for (const { realRoot, proj } of worktreeEntries) {
    if (parentMap.has(realRoot)) {
      const parent = mergedProjects[parentMap.get(realRoot)];
      parent.sessions.push(...proj.sessions);
    } else {
      parentMap.set(realRoot, mergedProjects.length);
      mergedProjects.push({
        ...proj,
        name: path.basename(realRoot),
        originalPath: realRoot,
      });
    }
  }

  for (const proj of mergedProjects) {
    proj.sessions.sort((a, b) => (
      new Date(b.modified).getTime() - new Date(a.modified).getTime()
    ));
  }

  return mergedProjects;
}
