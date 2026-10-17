import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskProfile } from '../../agent-host/task-profile.js';
import { taskClaudeEnvironment, inspectClaudeTaskSeat } from '../../agent-host/task-claude.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-account-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project','out','runtime','claude','anthropic']) fs.mkdirSync(path.join(root,name), {mode:0o700});
  const account = { id:'claude-hoff', email:'hoff@example.test', organization_id:'org-test',
    config_directory:path.join(root,'claude'), anthropic_directory:path.join(root,'anthropic') };
  const binding = {working_directory:path.join(root,'project'),outputs:{runtime:path.join(root,'runtime'),deliverables:[path.join(root,'out')]}};
  const input = {schema_version:1,provider:'claude',model:'claude-haiku-4-5-20251001',workspace_mode:'registered-shared',
    working_directory:binding.working_directory,read_roots:[binding.working_directory],write_roots:binding.outputs.deliverables,
    network:'disabled',timeout_ms:1000,account};
  return {input,binding,account};
}

test('Claude profile selects an explicit account directory without inheriting credentials', t => {
  const {input,binding,account} = fixture(t);
  const profile = validateTaskProfile(input,binding);
  const env = taskClaudeEnvironment('/native/claude',profile);
  assert.equal(env.CLAUDE_CONFIG_DIR,account.config_directory);
  assert.equal(env.ANTHROPIC_CONFIG_DIR,account.anthropic_directory);
  assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  assert.ok(Object.isFrozen(profile.account));
});

test('selected account auth fails closed on email, organization or config drift', t => {
  const {input,binding,account} = fixture(t);
  const profile = validateTaskProfile(input,binding);
  const observed = {loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:account.email,
    orgId:account.organization_id,configDirectory:account.config_directory,projectsDirectory:path.join(account.config_directory,'projects')};
  const probe = patch => inspectClaudeTaskSeat('/native/claude',{profile,spawnSyncImpl:(_binary,_args,options)=>{
    assert.equal(options.env.CLAUDE_CONFIG_DIR,account.config_directory);
    return {status:0,stdout:JSON.stringify({...observed,...patch})};
  }});
  assert.deepEqual(probe({}).account,{...account,projects_directory:observed.projectsDirectory});
  for (const patch of [{email:'other@example.test'},{orgId:'other'},{configDirectory:'/other'},
    {projectsDirectory:'/other'},{authMethod:'api_key'},{loggedIn:false}]) assert.throws(()=>probe(patch),/seat|account/);
});

test('selected Claude plan preserves native sessions in its account and uses the OS sandbox', async t => {
  const {input,binding,account} = fixture(t);
  const {buildClaudePlan} = await import('../../agent-host/providers/claude.js');
  const profile = validateTaskProfile(input,binding);
  const plan = buildClaudePlan({binaryPath:'/native/claude',cwd:profile.working_directory,workspaceMode:profile.workspace_mode,
    taskProfile:profile,model:profile.model,prompt:'fixture',runtimeDirectory:binding.outputs.runtime});
  assert.equal(plan.spawn.command,'/usr/bin/sandbox-exec');
  assert.equal(plan.environment.CLAUDE_CONFIG_DIR,account.config_directory);
  assert.ok(!plan.args.includes('--no-session-persistence'));
  assert.ok(plan.args.includes('--restricted'));
  assert.match(plan.args[1],/deny system-audit/);
  assert.match(plan.args[1],/deny file-write/);
  assert.equal(plan.environment.CLAUDE_CODE_TMPDIR,path.join(binding.outputs.runtime,'native-tmp'));
});

test('Claude account boundaries reject missing selection, broad roots, aliases and shared permissions', t => {
  const {input,binding,account}=fixture(t);
  const {account:unused,...withoutAccount}=input;
  assert.throws(()=>validateTaskProfile(withoutAccount,binding),/fields/);
  assert.throws(()=>validateTaskProfile({...input,account:{...account,token:'must-not-be-stored'}},binding),/fields/);
  assert.throws(()=>validateTaskProfile({...input,read_roots:[...input.read_roots,path.dirname(account.config_directory)]},binding),/overlaps/);
  fs.chmodSync(account.config_directory,0o755);
  assert.throws(()=>validateTaskProfile(input,binding),/private/);
  fs.chmodSync(account.config_directory,0o700);
  const alias=path.join(path.dirname(account.config_directory),'alias');
  fs.symlinkSync(account.config_directory,alias);
  assert.throws(()=>validateTaskProfile({...input,account:{...account,config_directory:alias}},binding),/canonical/);
});

test('explicit Claude accounts reach capability validation rather than a fixture-only provider gate', async t => {
  const {input,binding}=fixture(t);
  const {assertTaskProviderQualified}=await import('../../agent-host/task-provider.js');
  assert.doesNotThrow(()=>assertTaskProviderQualified(validateTaskProfile(input,binding)));
});

test('Claude capability preflight rejects version drift and failed kernel probes', async t => {
  const {assertClaudeTaskCapabilities}=await import('../../agent-host/task-claude-capabilities.js');
  const {input,binding,account}=fixture(t);
  const profile=validateTaskProfile(input,binding);
  const helper=path.join(binding.outputs.runtime,'helper');
  fs.writeFileSync(helper,'synthetic helper');
  const observed={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:account.email,
    orgId:account.organization_id,configDirectory:account.config_directory,projectsDirectory:path.join(account.config_directory,'projects')};
  const check=(version,probe)=>assertClaudeTaskCapabilities({binaryPath:'/native/claude',profile},{helperPathImpl:()=>helper,
    spawnSyncImpl:(_binary,args)=>({status:0,stdout:args[0]==='--version'?version:
      args[0]==='auth'?JSON.stringify(observed):probe})});
  const passed='{"audit_session_escape_denied":true,"supervisor_signal_denied":true}';
  assert.equal(check('2.1.294 (Claude Code)',passed).account.id,account.id);
  assert.throws(()=>check('2.1.295 (Claude Code)',passed),/version/);
  assert.throws(()=>check('2.1.294 (Claude Code)','{}'),/containment/);
});
