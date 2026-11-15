import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const args=process.argv.slice(2);
function value(flag,env,fallback){const index=args.indexOf(flag);return index>=0?args[index+1]:process.env[env]||fallback;}
const account=value('--account-id','CLOUDFLARE_ACCOUNT_ID');
const database=value('--database-id','CLOUDFLARE_DATABASE_ID');
const bucket=value('--bucket','CLOUDFLARE_R2_BUCKET','simmusic-images');
if(!/^[a-f0-9]{32}$/i.test(account||''))throw new Error('需要有效的 CLOUDFLARE_ACCOUNT_ID（或 --account-id）');
if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database||'')||database.startsWith('00000000'))throw new Error('需要真实的 CLOUDFLARE_DATABASE_ID（或 --database-id）');
if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw new Error('R2 存储桶名称无效');
config.account_id=account;config.d1_databases[0].database_id=database;config.r2_buckets[0].bucket_name=bucket;
await writeFile(new URL('../wrangler.production.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
console.log('已生成 Cloudflare 部署配置（不包含密钥，不会提交到 Git）。');
