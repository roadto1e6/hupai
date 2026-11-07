const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {createGameServer}=require('../resources/game/server');
async function boot(file){const server=createGameServer({stateFile:file,botDelay:20});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port}}
async function call(url,type,data={}){const res=await fetch(url+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,...data})});return {status:res.status,data:await res.json()}}
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r)});
test('联机接口：独立身份、幂等、六人上限、状态持久化、退出取消',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hupai-test-'));const file=path.join(dir,'rooms.json');let {server,url}=await boot(file);try{
 let a=(await call(url,'create',{name:'甲',clientKey:'c1'})).data;const again=(await call(url,'create',{name:'甲',clientKey:'c1'})).data;assert.equal(a.token,again.token);
 const users=[a];for(let i=1;i<6;i++)users.push((await call(url,'join',{code:a.code,name:'玩家'+i,clientKey:'k'+i})).data);
 assert.equal((await call(url,'join',{code:a.code,name:'溢出'})).status,400);
 assert.equal((await call(url,'state',{code:a.code,token:'wrong'})).status,401);
 a=(await call(url,'state',{code:a.code,token:a.token})).data;const hostToken=users[0].token;
 assert.equal((await call(url,'start',{code:a.code,token:users[1].token,revision:a.revision})).status,400);
 a=(await call(url,'start',{code:a.code,token:hostToken,revision:a.revision,requestId:'start-1'})).data;assert.equal(a.game.hand.length,8);assert.ok(a.players.every(p=>!('token'in p)));assert.equal(a.game.hands,undefined);
 const duplicate=(await call(url,'start',{code:a.code,token:hostToken,revision:0,requestId:'start-1'})).data;assert.equal(duplicate.match,1);
 const turn=a.game.turn,actor=users[turn],own=(await call(url,'state',{code:a.code,token:actor.token})).data;const rank=own.game.hand[0];const payload={code:a.code,token:actor.token,revision:own.revision,requestId:'play-1',action:{type:'play',claim:'3',cards:{[rank]:1}}};
 const played=(await call(url,'action',payload)).data;const repeated=(await call(url,'action',payload)).data;assert.equal(played.game.pileCount,1);assert.equal(repeated.game.pileCount,1);
 assert.equal((await call(url,'action',{...payload,requestId:'stale'})).status,400);
 await close(server);({server,url}=await boot(file));const restored=(await call(url,'state',{code:a.code,token:actor.token})).data;assert.equal(restored.game.pileCount,1);assert.equal(restored.match,1);
 await call(url,'leave',{code:a.code,token:actor.token});const remaining=users.find((_,i)=>i!==turn);const reset=(await call(url,'state',{code:a.code,token:remaining.token})).data;assert.equal(reset.game,null);assert.equal(reset.players.length,5);
 const asset=await fetch(url+'/assets/fox.jpg');assert.equal(asset.status,200);const home=await fetch(url);assert.ok((await home.text()).includes('id="app"'));
 }finally{await close(server);fs.rmSync(dir,{recursive:true,force:true})}});
test('电脑陪练自动行动且无纯电脑残留房间',async()=>{let {server,url}=await boot(null);try{const a=(await call(url,'create',{name:'我',clientKey:'practice',practice:true,count:2})).data;assert.equal(a.players.length,2);assert.equal(a.game.hand.length,24);const s=(await call(url,'state',{code:a.code,token:a.token})).data;assert.equal(s.players[1].bot,true);await call(url,'leave',{code:a.code,token:a.token});assert.equal((await call(url,'state',{code:a.code,token:a.token})).status,410)}finally{await close(server)}});
test('语音鉴权、会话隔离、收件人隔离和 ACK 不影响游戏版本',async()=>{const {server,url}=await boot(null);try{
 const a=(await call(url,'create',{name:'甲'})).data,b=(await call(url,'join',{code:a.code,name:'乙'})).data,c=(await call(url,'join',{code:a.code,name:'丙'})).data,out=(await call(url,'create',{name:'外部'})).data;
 const auth=x=>({code:x.code,token:x.token});const sa='session-aaaaa',sb='session-bbbbb';
 assert.equal((await call(url,'voice-config',{code:a.code,token:'wrong'})).status,401);
 for(const [u,s] of [[a,sa],[b,sb]])assert.equal((await call(url,'voice',{...auth(u),enabled:true,session:s})).status,200);
 const baseline=(await call(url,'state',auth(a))).data.revision;
 const signal={...auth(a),session:sa,to:b.you,toSession:sb,data:{description:{type:'offer',sdp:'test-private-sdp'}}};
 assert.equal((await call(url,'signal',{...signal,to:out.you})).status,400);
 assert.equal((await call(url,'signal',{...signal,session:'old-session'})).status,400);
 assert.equal((await call(url,'signal',signal)).status,200);
 assert.equal((await call(url,'state',auth(c))).data.signals.length,0);
 assert.equal((await call(url,'state',auth(a))).data.signals.length,0);
 const received=(await call(url,'state',auth(b))).data;assert.equal(received.signals.length,1);
 assert.equal((await call(url,'state',{...auth(b),signalAck:received.signals[0].id})).data.signals.length,0);
 await call(url,'voice',{...auth(a),enabled:true,muted:true,session:sa});
 assert.equal((await call(url,'state',auth(a))).data.revision,baseline);
 await call(url,'voice',{...auth(b),enabled:false,session:sb});assert.equal((await call(url,'signal',signal)).status,400);
 }finally{await close(server)}});

test('普通玩家主动退出释放座位，旧凭据失效',async()=>{const {server,url}=await boot(null);try{const a=(await call(url,'create',{name:'房主'})).data;const b=(await call(url,'join',{code:a.code,name:'朋友',clientKey:'guest'})).data;await call(url,'disconnect',{code:a.code,token:b.token});assert.equal((await call(url,'state',{code:a.code,token:b.token})).status,401);assert.equal((await call(url,'state',{code:a.code,token:a.token})).data.players.length,1);const rejoin=(await call(url,'join',{code:a.code,name:'朋友',clientKey:'guest'})).data;assert.notEqual(rejoin.token,b.token)}finally{await close(server)}});
test('重开页面或断网后的同身份加入恢复原座位',async()=>{const {server,url}=await boot(null);try{const a=(await call(url,'create',{name:'房主',clientKey:'host-key'})).data;const b=(await call(url,'join',{code:a.code,name:'朋友',clientKey:'guest-key'})).data;await call(url,'start',{code:a.code,token:a.token,revision:b.revision});for(const [u,key]of [[a,'host-key'],[b,'guest-key']]){const before=(await call(url,'state',{code:a.code,token:u.token})).data;const back=(await call(url,'join',{code:a.code,clientKey:key})).data;assert.equal(back.token,u.token);assert.equal(back.players.length,2);assert.deepEqual(back.game.hand,before.game.hand)}}finally{await close(server)}});

test('房主主动退出解散房间，原成员无法继续操作或重入',async()=>{const {server,url}=await boot(null);try{const a=(await call(url,'create',{name:'房主'})).data;const b=(await call(url,'join',{code:a.code,name:'朋友'})).data;const result=await call(url,'disconnect',{code:a.code,token:a.token});assert.equal(result.data.dissolved,true);assert.equal((await call(url,'state',{code:a.code,token:b.token})).data.code,'ROOM_CLOSED');assert.equal((await call(url,'join',{code:a.code,token:b.token})).status,400)}finally{await close(server)}});
