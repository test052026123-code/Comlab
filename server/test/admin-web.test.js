import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {adminWebCors, adminWebOrigin} from '../src/admin-web.js';
test('admin web CORS permits only the GitHub Pages origin and supported preflights',async()=>{
  const app=express();app.use(adminWebCors);app.all('/test',(req,res)=>res.status(401).json({error:'Sign in required.'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/test`;
  try{
    const native=await fetch(url);assert.equal(native.status,401);assert.equal(native.headers.get('Access-Control-Allow-Origin'),null);
    const read=await fetch(url,{headers:{Origin:adminWebOrigin}});assert.equal(read.status,401);assert.equal(read.headers.get('Access-Control-Allow-Origin'),adminWebOrigin);assert.match(read.headers.get('Vary'),/Origin/);
    const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:adminWebOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
    for(const origin of ['https://evil.example',adminWebOrigin+'.evil.example','null']){const r=await fetch(url,{headers:{Origin:origin}});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);}
    const badMethod=await fetch(url,{method:'OPTIONS',headers:{Origin:adminWebOrigin,'Access-Control-Request-Method':'DELETE'}});assert.equal(badMethod.status,403);
    const badHeader=await fetch(url,{method:'OPTIONS',headers:{Origin:adminWebOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-controller-key'}});assert.equal(badHeader.status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
