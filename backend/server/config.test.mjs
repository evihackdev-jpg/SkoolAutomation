import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig, clientAddress } from './config.mjs';

const production = { NODE_ENV:'production',API_PUBLIC_ORIGIN:'https://api.example.com',FRONTEND_ORIGINS:'https://app.vercel.app,https://app.example.com',TRUST_PROXY:'true' };
test('production requires explicit HTTPS origins and disables anonymous local ownership',()=>{
  const {config,host,localOwner}=runtimeConfig(production);
  assert.equal(host,'127.0.0.1');assert.equal(localOwner,false);assert.equal(config.secureCookies,true);assert.equal(config.requireOrigin,true);
  assert.ok(config.hosts.includes('api.example.com'));assert.ok(config.origins.includes('https://app.vercel.app'));
  assert.ok(!config.origins.includes('http://localhost:5173'));
  for(const patch of [{API_PUBLIC_ORIGIN:''},{FRONTEND_ORIGINS:''},{FRONTEND_ORIGINS:'*'},{FRONTEND_ORIGINS:'https://*.vercel.app'},{FRONTEND_ORIGINS:'http://app.example.com'},{API_PUBLIC_ORIGIN:'https://api.example.com/path'},{LOCAL_OWNER_ENABLED:'true'},{LAN_HOST:'192.168.1.10'}])assert.throws(()=>runtimeConfig({...production,...patch}));
});
test('local owner access is opt-in, restricted to loopback, and development keeps its proxy origins',()=>{
  assert.equal(runtimeConfig({}).localOwner,false);
  assert.equal(runtimeConfig({LOCAL_OWNER_ENABLED:'true'}).localOwner,true);
  assert.throws(()=>runtimeConfig({LOCAL_OWNER_ENABLED:'true',API_HOST:'0.0.0.0'}));
  assert.ok(runtimeConfig({}).config.origins.includes('http://127.0.0.1:5173'));
  assert.throws(()=>runtimeConfig({API_PORT:'0'}));assert.throws(()=>runtimeConfig({API_HOST:'example.com'}));
});
test('only an explicitly trusted loopback proxy can supply a validated client address',()=>{
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-real-ip':'192.0.2.5','x-forwarded-for':'127.0.0.1'}};
  assert.equal(clientAddress(req,{trustProxy:true}),'192.0.2.5');assert.equal(clientAddress(req,{trustProxy:false}),'127.0.0.1');
  assert.equal(clientAddress({...req,socket:{remoteAddress:'192.0.2.9'}},{trustProxy:true}),'192.0.2.9');
  assert.equal(clientAddress({...req,headers:{'x-real-ip':'invalid, 127.0.0.1'}},{trustProxy:true}),'127.0.0.1');
});
