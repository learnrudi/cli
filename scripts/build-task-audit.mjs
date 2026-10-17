import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform==='darwin') {
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  const result=spawnSync('/usr/bin/clang',['-std=c11','-Wall','-Wextra','-Werror','-O2','-lbsm',
    path.join(root,'native/task-audit.c'),'-o',path.join(root,'dist/task-audit-darwin')],{stdio:'inherit'});
  if(result.status!==0)throw new Error('macOS task audit helper build failed');
}
