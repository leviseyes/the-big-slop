import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../services/session.mjs';
if(existsSync('.env')||existsSync('.dev.vars')||existsSync('.studio-password')) throw Error('Setup already exists. Back it up before changing credentials; setup never overwrites it.');
const password=randomBytes(24).toString('base64url');
const values={SESSION_SECRET:randomBytes(32).toString('hex'),STUDIO_PASSWORD_HASH:await hashPassword(password),WORKER_SECRET:randomBytes(32).toString('hex')};
let content=readFileSync('.env.example','utf8');
for(const [key,value] of Object.entries(values)) content=content.replace(new RegExp(`^${key}=.*$`,'m'),`${key}="${value}"`);
for(const file of ['.env','.dev.vars']) {writeFileSync(file,content,{mode:0o600,flag:'wx'});chmodSync(file,0o600);}
writeFileSync('.studio-password',password+'\n',{mode:0o600,flag:'wx'});
console.log('Created private .env, .dev.vars and .studio-password files. Your sign-in password is in .studio-password. Add your own API keys to .env and .dev.vars to enable generation. Run npm run db:migrate next. Never commit these files.');
