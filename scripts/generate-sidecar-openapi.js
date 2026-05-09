import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildSidecarOpenApiSpec } from '../src/contracts/sidecar-openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const outputPath = path.join(projectRoot, 'docs', 'sidecar', 'openapi.json');

async function main() {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  const spec = buildSidecarOpenApiSpec({ cliVersion: packageJson.version });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`);

  console.log(`Wrote sidecar OpenAPI spec to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
