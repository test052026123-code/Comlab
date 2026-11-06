import config from './firebase-config.json';
type Session = { idToken:string; refreshToken:string; expires:number; email:string };
let session:Session|null = null;
let generation = 0;
let refreshing:Promise<string>|null=null;
export class ApiError extends Error { constructor(message:string, public status:number){super(message);} }
export function logout() { generation++; session=null; refreshing=null; }
export async function login(email:string,password:string) {
  logout(); const epoch=generation;
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(30000),
  });
  const data=await r.json() as {idToken:string;refreshToken:string;expiresIn:string;email:string};
  if (!r.ok) throw Error('Sign-in failed. Check your administrator email and password.');
  if(epoch!==generation) throw Error('Sign-in cancelled.');
  session={idToken:data.idToken,refreshToken:data.refreshToken,expires:Date.now()+Number(data.expiresIn)*1000,email:data.email};
  try { const me=await api('/me'); if(me.role!=='admin') throw Error('This account is not an approved ComLab administrator.'); }
  catch(e) { logout(); throw e; }
  return data.email as string;
}
async function token():Promise<string> {
  if(!session) throw Error('Sign in again to continue.');
  if(session.expires>Date.now()+60000) return session.idToken;
  if(refreshing) return refreshing;
  const old=session, epoch=generation;
  refreshing=(async()=>{
    const r=await fetch(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:old.refreshToken}),signal:AbortSignal.timeout(30000)});
    if(!r.ok) { if(epoch===generation) logout(); throw new ApiError('Your sign-in expired. Sign in again.',401); }
    const d=await r.json() as {id_token:string;refresh_token:string;expires_in:string}; if(epoch!==generation) throw Error('Session ended.');
    session={...old,idToken:d.id_token,refreshToken:d.refresh_token,expires:Date.now()+Number(d.expires_in)*1000}; return session.idToken;
  })();
  try { return await refreshing; } finally { if(epoch===generation) refreshing=null; }
}
export async function api(path:string, method='GET', body?:unknown, csv=false):Promise<any> {
  const epoch=generation, bearer=await token();
  let r:Response;
  try { r=await fetch('https://comlab-api.onrender.com'+path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(110000)}); }
  catch { throw Error(method==='GET'?'Unable to reach the API. Check your connection and refresh.':'No response received. This change may have been saved. Refresh records or check the operation ID before submitting again.'); }
  if(epoch!==generation) throw Error('Session ended.');
  if(csv && r.ok) return r.text();
  const data=await r.json() as Record<string,any>; if(!r.ok) throw new ApiError(data.error||'Request failed.',r.status); return data;
}
