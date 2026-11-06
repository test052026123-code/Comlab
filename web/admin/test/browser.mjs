// Run with an installed Playwright module path as the first argument. Tests use
// intercepted synthetic data only; they never create users or pulse real nodes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let role='admin',fail=false,writes=[];
let students=[{id:'QA-001',name:'QA Student',section:'BSIT-1A',active:true,fingerprintSlot:7}];
await page.route('https://identitytoolkit.googleapis.com/**',r=>r.fulfill({json:{idToken:'test-token',refreshToken:'test-refresh',expiresIn:'3600',email:'qa@example.invalid'}}));
await page.route('https://comlab-api.onrender.com/**',async r=>{
 const path=new URL(r.request().url()).pathname,method=r.request().method();
 if(path==='/me')return r.fulfill({json:{role,uid:'qa'}});
 if(fail)return r.fulfill({status:503,json:{error:'QA simulated outage'}});
 if(method!=='GET'){
  const body=r.request().postDataJSON();writes.push({path,method,body});
  if(path==='/admin/students')students.push(body);
  if(path.startsWith('/admin/students/'))students=students.map(s=>s.id===path.split('/').at(-1)?{...s,...body}:s);
  if(path==='/admin/relay-tests')return r.fulfill({json:{...body,state:'pending'}});
  return r.fulfill({json:{ok:true}});
 }
 const data={
 '/admin/students':{rows:students},'/workstations':{workstations:[{id:'PC-01',nodeId:'NODE-01',enabled:true,maintenance:false,assignment:'available',eligible:false,node:{connectivity:'connected',power:'unknown'}}]},
 '/admin/history':{rows:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',studentId:'QA-001',studentName:'QA Student',section:'BSIT-1A',workstationId:'PC-01',timeIn:'2026-11-06T09:00:00Z',status:'active'}]},
 '/admin/issues':{rows:[]},'/admin/audit':{rows:[]},'/settings':{welcomeTimeoutSeconds:25},'/controller/status':{transport:'cloud'},
 };return r.fulfill({json:path.startsWith('/admin/relay-tests/')?{commandId:path.split('/').at(-1),workstationId:'PC-01',state:'pulse_finished'}:data[path]||{}});
});
async function signin(){await page.getByLabel('Email address').fill('qa@example.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-test-password');await page.getByRole('button',{name:'Sign in to dashboard'}).click();}
try{
 await page.goto('http://127.0.0.1:5173/Comlab/');await page.screenshot({path:'outputs/login-desktop.png',fullPage:true});
 role='kiosk';await signin();await page.getByRole('alert').filter({hasText:'not an approved'}).waitFor();assert.equal(await page.getByRole('button',{name:'Add student',exact:true}).count(),0);
 role='admin';await signin();await page.getByRole('heading',{name:'Your lab, at a glance.'}).waitFor();await page.getByText('QA Student',{exact:true}).waitFor();
 await page.screenshot({path:'outputs/overview-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Students',exact:true}).click();await page.getByRole('button',{name:'Add student',exact:true}).click();
 await page.getByLabel('Student ID',{exact:true}).fill('QA-002');await page.getByLabel('Full name').fill('Second QA');await page.getByLabel('Section',{exact:true}).fill('BSIT-2B');await page.getByLabel('Fingerprint slot').fill('12');await page.getByRole('button',{name:'Save changes'}).click();
 await page.getByText('Second QA',{exact:true}).waitFor();assert.equal(writes[0].body.fingerprintSlot,12);assert.equal(writes[0].body.id,'QA-002');
 await page.getByRole('row').filter({hasText:'Second QA'}).getByRole('button',{name:'Edit student'}).click();assert.equal(await page.getByLabel('Student ID',{exact:true}).isDisabled(),true);await page.getByLabel('Fingerprint slot').fill('');await page.getByRole('button',{name:'Save changes'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(writes[1].body.fingerprintSlot,null);
 await page.getByRole('button',{name:'Workstations',exact:true}).click();await page.getByRole('button',{name:'Test relay',exact:true}).click();assert.equal(writes.filter(w=>w.path==='/admin/relay-tests').length,0);await page.getByRole('button',{name:'Test relay · 300 ms'}).click();await page.getByText('Pulse finished',{exact:false}).waitFor();assert.equal(writes.filter(w=>w.path==='/admin/relay-tests').length,1);
 fail=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'QA simulated outage'}).waitFor();assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).isDisabled(),true);assert.equal(await page.getByText('NODE-01',{exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Welcome back.'}).waitFor();assert.equal(await page.getByText('QA Student',{exact:true}).count(),0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/login-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 fail=false;await signin();await page.getByRole('heading',{name:'Your lab, at a glance.'}).waitFor();await page.getByRole('button',{name:'Students',exact:true}).click();await page.screenshot({path:'outputs/students-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: role denial, admin load, add/edit/link/unlink, relay confirmation and single submission, stale read-only records, sign-out cleanup and mobile layout.');
}catch(e){await page.screenshot({path:'outputs/browser-failure.png',fullPage:true});console.log('Browser errors:',errors);console.log('Visible text:',await page.locator('body').innerText());throw e;}finally{await browser.close();}
