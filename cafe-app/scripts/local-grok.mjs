import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpathSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

// guard:allow-env-credential — local profile directory path, not a user credential
if (process.platform !== 'darwin' || !process.env.CAFE_GROK_PROFILE) throw new Error('Set CAFE_GROK_PROFILE to a private, separately authorized Grok profile on macOS.');
// guard:allow-env-credential — local profile directory path, not a user credential
const profile = realpathSync(process.env.CAFE_GROK_PROFILE);
// guard:allow-env-credential — local home directory path, not a user credential
let defaultProfile = join(realpathSync(process.env.HOME ?? '/'), '.grok');
try { defaultProfile = realpathSync(defaultProfile); } catch {}
const contains = (parent, child) => { const path = relative(parent,child); return path === '' || (!path.startsWith('..' + '/') && path !== '..' && !isAbsolute(path)); };
// guard:allow-env-credential — local home directory path, not a user credential
if (!statSync(profile).isDirectory() || (statSync(profile).mode & 0o077) !== 0 || profile === realpathSync(process.env.HOME ?? '/') || (defaultProfile && (contains(profile,defaultProfile) || contains(defaultProfile,profile)))) throw new Error('The Grok profile must be a private dedicated directory.');
// guard:allow-env-credential — local executable and home directory paths, not user credentials
const binary = process.env.CAFE_GROK_BINARY ?? join(process.env.HOME ?? '', '.grok/bin/grok');
const realBinary = realpathSync(binary);
// guard:allow-env-credential — local bridge port, not a user credential
const port = Number(process.env.CAFE_GROK_PORT ?? '8612');
const appPort = Number(process.env.PORT ?? '8080');
if (![port,appPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535) || port === appPort) throw new Error('Choose distinct valid app and bridge ports.');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cafe-grok-')));
const sandbox = join(cwd, 'sandbox.sb');
const q = JSON.stringify;
const policy = `(version 1)\n(allow default)\n(deny process-fork)\n(deny file-read* (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/Volumes") (subpath "/Network"))\n(deny file-write*)\n(allow file-read* (literal ${q(binary)}) (literal ${q(realBinary)}) (subpath ${q(profile)}) (subpath ${q(cwd)}))\n(allow file-write* (subpath ${q(profile)}) (subpath ${q(cwd)}))\n`;
writeFileSync(sandbox,policy,{mode:0o600,flag:'wx'});
const token = randomBytes(32).toString('hex');
const env = {...process.env, CAFE_GROK_PROFILE:profile, CAFE_GROK_CWD:cwd, CAFE_GROK_SANDBOX:sandbox, CAFE_GROK_BINARY:binary, CAFE_GROK_PORT:String(port), CAFE_GROK_TOKEN:token, OPENAI_API_KEY:token, OPENAI_BASE_URL:`http://127.0.0.1:${port}/v1`, AGENT_ENGINE:'ai-sdk:openai', AGENT_MODEL:'grok-4.5', VITE_CAFE_LOCAL_GROK:'1'};
const options = {cwd:app,env,stdio:'inherit',detached:true};
const bridge = spawn(process.execPath,['scripts/grok-bridge.mjs'],options);
let bridgeExited = false;
bridge.once('exit',()=>{bridgeExited = true});
bridge.once('error',()=>{bridgeExited = true});
let ready = false;
for (let attempt=0; attempt<50 && !bridgeExited; attempt++) {
  try { const response = await fetch(`http://127.0.0.1:${port}/health`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(500)}); if (response.status === 204) { ready = true; break; } } catch {}
  await new Promise(resolve=>setTimeout(resolve,100));
}
if (!ready) {
  if (bridge.pid) { try { process.kill(-bridge.pid,'SIGTERM'); } catch {} }
  rmSync(cwd,{recursive:true,force:true});
  throw new Error('The local Grok bridge did not become ready.');
}
const web = spawn('pnpm',['exec','agent-native','dev','--host','127.0.0.1','--port',String(appPort),'--strictPort'],options);
let stopping = false;
let remaining = 2;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of [bridge,web]) if (child.pid) { try { process.kill(-child.pid,'SIGTERM'); } catch {} }
  process.exitCode = code;
}
for (const child of [bridge,web]) {
  child.on('error',()=>stop(1));
  child.on('exit',code=>{ stop(code ?? 1); if (--remaining === 0) rmSync(cwd,{recursive:true,force:true}); });
}
process.on('SIGINT',()=>stop(0));
process.on('SIGTERM',()=>stop(0));
