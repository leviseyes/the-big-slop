import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const failures=[];
const forbidden=/^(\.env(?!\.example$)|\.dev\.vars|\.studio-password|\.openai\/|\.wrangler\/|worker-state\/|backups\/|outputs\/|work\/)|(^|\/)node_modules\//;
const secrets=[/sk-(?:proj-)?[A-Za-z0-9_-]{35,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/appgprj_[a-f0-9]{20,}/,/https:\/\/[^\s/]+\.chatgpt\.site\//,/\/Users\/[A-Za-z0-9_. -]+\//];
for(const file of files){if(forbidden.test(file))failures.push(`${file}: forbidden private file`);if(!existsSync(file))continue;const bytes=readFileSync(file);if(bytes.length>2*1024*1024)failures.push(`${file}: unexpected large file`);if(!/\.(png|jpg|jpeg|gif|webp|mp4|zip|woff2?)$/.test(file)){const content=bytes.toString('utf8');for(const pattern of secrets)if(pattern.test(content))failures.push(`${file}: potential credential or private deployment identifier`);}}
for(const file of ['LICENSE','README.md','SECURITY.md','CONTRIBUTING.md','compose.yaml','.env.example','docs/api-keys.md'])if(!files.includes(file))failures.push(`${file}: required release file missing`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`Release boundary passed: ${files.length} tracked files; no matching credentials, private deployment identifiers or data paths.`);
