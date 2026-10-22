import { spawn } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync } from 'node:fs';
// Wrangler loads secrets beside the built configuration, not from the source
// directory. Refresh them at startup so Docker and edited keys work without a
// rebuild. This private runtime file stays outside source control and images.
if (existsSync('.dev.vars')) {
  copyFileSync('.dev.vars', 'dist/server/.dev.vars');
  chmodSync('dist/server/.dev.vars', 0o600);
}
const args=['node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip',process.env.HOST||'127.0.0.1','--port',process.env.PORT||'5173','--inspector-port','0'];
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= 'false';
process.env.WRANGLER_SEND_METRICS ??= 'false';
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
