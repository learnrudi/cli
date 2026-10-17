import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openTaskCustody } from '../../agent-host/task-custody.js';
import { isQualifiedTaskAuditHost } from '../../agent-host/task-audit.js';

test('custody rejects execution outside a verified audit-session capsule', async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'audit-custody-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  await assert.rejects(openTaskCustody({runtime:root,runDirectory:root,jobId:'job_uncontained'}),/capsule/);
  assert.equal(fs.existsSync(path.join(root,'custody.lock')),false);
});
for(const mode of ['normal','double-fork','census-race','owner-crash','prequarantined-crash','untracked-crash','guardian-crash','guardian-before-spawn']) {
  test(`audit custody contains detached descendants: ${mode}`,{skip:!isQualifiedTaskAuditHost(),timeout:30000},()=>{
    const script=fileURLToPath(new URL('../../../scripts/verify-task-containment.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[script,mode],{encoding:'utf8',timeout:25000,maxBuffer:65536});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const receipt=JSON.parse(result.stdout.trim());
    assert.equal(receipt.descendantGone,true);assert.equal(receipt.canaryUnchanged,true);
  });
}
