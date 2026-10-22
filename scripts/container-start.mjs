import { writeFileSync } from 'node:fs';
// Create the local Worker environment as the container user. A host file with
// mode 0600 may belong to a different UID and cannot safely be bind-mounted.
const names=['SESSION_SECRET','STUDIO_PASSWORD_HASH','WORKER_SECRET','ADMIN_EMAIL','OPENAI_API_KEY','HF_KEY','ORCHESTRATOR_MODEL','PAYMENTS_ENABLED'];
const text=names.filter(name=>process.env[name]!==undefined).map(name=>`${name}=${JSON.stringify(process.env[name])}`).join('\n')+'\n';
writeFileSync('.dev.vars',text,{mode:0o600});
await import('./local-server.mjs');
