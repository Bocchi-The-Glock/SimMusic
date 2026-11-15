import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const command=process.argv[2];
if(!['deploy','migrate','backup'].includes(command))throw new Error('Unknown command');
const file=command==='deploy'?'dist/server/wrangler.json':'wrangler.production.json';
const config=JSON.parse(await readFile(file,'utf8').catch(()=>{throw new Error('请先运行 npm run cf:configure，并在发布前运行 npm run build');}));
if(!config.account_id||config.d1_databases?.[0]?.database_id?.startsWith('00000000'))throw new Error('不能使用本地占位配置发布');
const args=command==='deploy'?['deploy','--config',file]:command==='migrate'?['d1','migrations','apply','DB','--remote','--config',file]:['d1','export','DB','--remote','--config',file,'--output',`backups/simmusic-${Date.now()}.sql`];
if(command==='backup'){const {mkdir}=await import('node:fs/promises');await mkdir('backups',{recursive:true});}
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.error)throw result.error;process.exit(result.status??1);
