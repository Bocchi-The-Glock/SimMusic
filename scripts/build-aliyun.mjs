import { spawnSync } from 'node:child_process';
import { cp, mkdir, symlink, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
// Vinext detects wrangler files even in Node mode. Build in an isolated tree
// without them rather than renaming live Cloudflare configuration.
const root = process.cwd();
await mkdir('work', {recursive:true});
const stage = await mkdtemp(resolve('work/aliyun-build-'));
for (const entry of ['app','components','hooks','lib','db','server','public','vendor','package.json','next.config.ts','vite.config.ts','tsconfig.json','postcss.config.mjs']) {
  await cp(join(root,entry),join(stage,entry),{recursive:true});
}
await symlink(resolve('node_modules'),join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');
const result = spawnSync(process.execPath, [resolve('node_modules/vinext/dist/cli.js'), 'build'], {
  cwd: stage, stdio: 'inherit', env: { ...process.env, SIMMUSIC_TARGET: 'node' },
});
if (result.status !== 0) process.exit(result.status || 1);
await cp(join(stage,'dist/standalone'),resolve('dist/standalone'),{recursive:true});
await cp('drizzle', 'dist/standalone/drizzle', { recursive: true });
await cp('deploy/aliyun', 'dist/standalone/deploy', { recursive: true });
await cp('server', 'dist/standalone/server', { recursive: true });
console.log('Aliyun bundle: dist/standalone. Keep data outside this directory.');
