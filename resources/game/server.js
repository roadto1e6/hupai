const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {freshGame,act,snapshot,botAction,RuleError}=require('./engine');
const ART=['fox','rabbit','cat','bear','raccoon','owl'];
const ANIMALS=['阿木','小林','小满','阿岚','木木','团子'];
const uid=()=>crypto.randomBytes(24).toString('hex');
const requireRule=(ok,message)=>{if(!ok)throw new RuleError(message)};
function createGameServer({stateFile=null,botDelay=1500}={}){
 const rooms=new Map(),timers=new Map();
 const iceServers=(()=>{try{const config=process.env.HUPAI_ICE_SERVERS?JSON.parse(process.env.HUPAI_ICE_SERVERS):null;if(Array.isArray(config)&&config.length)return config}catch{}return [{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}]})();
 if(stateFile&&fs.existsSync(stateFile)){
  try{const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(saved.schema===2)for(const r of saved.rooms){if(Date.now()-r.touched<86400000&&r.players.some(p=>!p.bot)){r.players.forEach(p=>{p.seen=0;p.voice=false;p.voiceSession=null;p.signals=[]});rooms.set(r.code,r)}}}catch(e){console.error('Could not restore rooms',e.message)}
 }
 function save(){if(!stateFile)return;fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile+'.tmp',JSON.stringify({schema:2,rooms:[...rooms.values()].map(r=>({...r,players:r.players.map(p=>({...p,voice:false,voiceSession:null,signals:[],signalWindow:null}))}))}));fs.renameSync(stateFile+'.tmp',stateFile)}
 function publicState(r,p){const seat=r.players.indexOf(p);return {code:r.code,revision:r.revision,match:r.match,you:p.id,host:r.host,seat,notice:r.notice,players:r.players.map((x,i)=>({id:x.id,name:x.name,animal:ART[i],bot:x.bot,online:x.bot||Date.now()-x.seen<12000,voice:!!x.voice&&Date.now()-x.seen<12000,muted:!!x.muted,voiceSession:x.voiceSession||null})),game:snapshot(r.game,seat),signals:(p.signals||[]).filter(x=>Date.now()-x.at<60000)}}
 function stopBot(r){clearTimeout(timers.get(r.code));timers.delete(r.code)}
 function schedule(r){if(timers.has(r.code)||!r.game||r.game.phase!=='playing'||!r.players[r.game.turn]?.bot)return;const t=setTimeout(()=>{timers.delete(r.code);if(!rooms.has(r.code)||!r.game||r.game.phase!=='playing'||!r.players[r.game.turn]?.bot)return;try{act(r.game,r.game.turn,botAction(r.game,r.game.turn));r.revision++;r.touched=Date.now();save();schedule(r)}catch(e){console.error('Bot error',e)}},botDelay);t.unref();timers.set(r.code,t)}
 function person(n,bot=false){return {id:uid(),token:uid(),name:String(n||'旅人').replace(/[\x00-\x1f]/g,'').trim().slice(0,16)||'旅人',bot,seen:Date.now(),requests:[],voice:false,muted:false,voiceSession:null,signals:[]}}
 function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
 const root=path.join(__dirname,'public');
 const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/health'){respond(res,200,{ok:true,version:2});return}
  if(req.method==='GET'&&u.pathname==='/invite.json'){let publicUrl='';try{if(stateFile)publicUrl=fs.readFileSync(path.join(path.dirname(stateFile),'public-url.txt'),'utf8').trim()}catch{}respond(res,200,{publicUrl});return}
  if(req.method==='GET'){
   const rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);
   const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)){respond(res,403,{error:'禁止访问'});return}
   const ext=path.extname(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[ext];
   if(!mime||!fs.existsSync(file)||!fs.statSync(file).isFile()){respond(res,404,{error:'页面不存在'});return}
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(file).pipe(res);return;
  }
  if(req.method!=='POST'||u.pathname!=='/api'){respond(res,404,{error:'接口不存在'});return}
  let raw='';for await(const chunk of req){raw+=chunk;requireRule(Buffer.byteLength(raw)<=16384,'请求过大')}
  let a;try{a=JSON.parse(raw)}catch{throw new RuleError('请求格式错误')}
  requireRule(a&&typeof a==='object','无效请求');let r,p;
  if(a.type==='create'||a.type==='join'){
   if(a.type==='create'&&a.clientKey){r=[...rooms.values()].find(x=>x.createKey===a.clientKey);p=r?.players.find(x=>x.id===r.host)}
   if(a.type==='join'){r=rooms.get(String(a.code));requireRule(r,'房间不存在或已关闭');p=r.players.find(x=>(a.token&&x.token===a.token)||(a.clientKey&&x.joinKey===a.clientKey))}
   if(p){p.seen=Date.now();respond(res,200,{...publicState(r,p),token:p.token});return}
   if(a.type==='create'){
    requireRule(rooms.size<300,'当前房间过多，请稍后重试');let code;do{code=String(crypto.randomInt(100000,1000000))}while(rooms.has(code));
    r={code,createKey:String(a.clientKey||uid()),host:null,players:[],game:null,revision:0,match:0,notice:'',touched:Date.now()};rooms.set(code,r);
   }else{requireRule(!r.game,'本局已开始，请等待房主返回房间');requireRule(r.players.length<6,'房间已满')}
   p=person(a.name);p.joinKey=String(a.clientKey||uid());r.players.push(p);r.host??=p.id;r.revision++;
   if(a.type==='create'&&a.practice){const count=Number(a.count);requireRule(Number.isInteger(count)&&count>=2&&count<=6,'练习人数需为2–6人');for(let i=1;i<count;i++)r.players.push(person(ANIMALS[i],true));r.game=freshGame(r.players);r.match++}
   r.touched=Date.now();save();schedule(r);respond(res,200,{...publicState(r,p),token:p.token});return;
  }
  r=rooms.get(String(a.code));p=r?.players.find(x=>x.token===a.token);
  if(!p){respond(res,401,{error:'座位已失效，请重新加入',code:'AUTH_EXPIRED'});return}
  p.seen=Date.now();r.touched=Date.now();
  p.signals=(p.signals||[]).filter(x=>Date.now()-x.at<60000&&!(Number.isInteger(a.signalAck)&&x.id<=a.signalAck));
  if(a.type==='voice-config'){respond(res,200,{iceServers});return}
  if(a.type==='voice'){
   requireRule(!p.bot&&typeof a.enabled==='boolean','无效语音状态');
   if(a.enabled){requireRule(typeof a.session==='string'&&a.session.length>=12&&a.session.length<=80,'无效语音会话');if(p.voiceSession!==a.session)p.signals=[];p.voiceSession=a.session;p.voice=true;p.muted=!!a.muted}
   else if(!a.session||a.session===p.voiceSession){p.voice=false;p.muted=false;p.voiceSession=null;p.signals=[]}
   respond(res,200,publicState(r,p));return;
  }
  if(a.type==='signal'){
   requireRule(p.voice&&a.session===p.voiceSession,'请先加入语音');const target=r.players.find(x=>x.id===a.to);
   requireRule(target&&target!==p&&!target.bot&&target.voice&&target.voiceSession===a.toSession,'对方语音已断开');
   const d=a.data;requireRule(d&&typeof d==='object','无效信令');
   requireRule((d.description&&['offer','answer'].includes(d.description.type)&&typeof d.description.sdp==='string'&&d.description.sdp.length<=12000)||(d.candidate&&typeof d.candidate.candidate==='string'&&JSON.stringify(d.candidate).length<=2048),'无效信令');
   const now=Date.now();if(!p.signalWindow||now-p.signalWindow.at>10000)p.signalWindow={at:now,n:0};requireRule(++p.signalWindow.n<=160,'语音请求过于频繁');
   target.signals=(target.signals||[]).filter(x=>now-x.at<60000);requireRule(target.signals.length<120,'语音队列繁忙');
   r.signalSeq=(r.signalSeq||0)+1;target.signals.push({id:r.signalSeq,at:now,from:p.id,session:p.voiceSession,toSession:target.voiceSession,data:d});respond(res,200,{ok:true});return;
  }
  if(a.type==='state'){schedule(r);respond(res,200,publicState(r,p));return}
  if(a.requestId&&p.requests.includes(a.requestId)){respond(res,200,publicState(r,p));return}
  if(a.type!=='leave')requireRule(a.revision===r.revision,'局面已更新，请重新操作');
  if(['start','addbot','remove','lobby','rematch'].includes(a.type))requireRule(r.host===p.id,'只有房主可以操作');
  if(a.type==='start'||a.type==='rematch'){
   requireRule(a.type==='start'?!r.game:r.game?.phase==='finished','请先结束当前对局');requireRule(r.players.length>=2,'至少需要两位玩家');requireRule(r.players.every(x=>x.bot||Date.now()-x.seen<12000),'有玩家离线，请等待连接或返回房间调整');
   stopBot(r);r.game=freshGame(r.players);r.match++;r.notice='';
  }else if(a.type==='addbot'){requireRule(!r.game&&r.players.length<6,'当前不能添加电脑');r.players.push(person(ANIMALS[r.players.length],true))}
  else if(a.type==='remove'){requireRule(!r.game,'对局中不能移除座位');const target=r.players.find(x=>x.id===a.id);requireRule(target&&target!==p,'不能移除此座位');r.players=r.players.filter(x=>x!==target);r.notice=`${target.name} 已离开房间`}
  else if(a.type==='lobby'){requireRule(r.game?.phase==='finished','本局尚未结束');stopBot(r);r.game=null;r.notice='准备好后，房主可开始新局'}
  else if(a.type==='action'){requireRule(r.game,'游戏尚未开始');act(r.game,r.players.indexOf(p),a.action);stopBot(r)}
  else if(a.type==='leave'){
   stopBot(r);r.players=r.players.filter(x=>x!==p);
   if(!r.players.some(x=>!x.bot)){rooms.delete(r.code)}else{if(r.host===p.id)r.host=(r.players.find(x=>!x.bot&&Date.now()-x.seen<12000)||r.players.find(x=>!x.bot)).id;r.game=null;r.notice=`${p.name} 已退出；如有正在进行的对局则取消，不计胜负`;r.revision++}
   save();respond(res,200,{left:true});return;
  }else throw new RuleError('未知操作');
  r.revision++;if(a.requestId)p.requests=[...p.requests,a.requestId].slice(-40);save();schedule(r);respond(res,200,publicState(r,p));
 }catch(e){if(!(e instanceof RuleError))console.error(e);respond(res,e instanceof RuleError?400:500,{error:e instanceof RuleError?e.message:'服务暂时出错，请重试'})}});
 const cleanup=setInterval(()=>{for(const [key,r]of rooms)if(Date.now()-r.touched>86400000){stopBot(r);rooms.delete(key)}save()},60000);cleanup.unref();
 server.on('close',()=>{clearInterval(cleanup);for(const t of timers.values())clearTimeout(t);save()});for(const r of rooms.values())schedule(r);return server;
}
module.exports={createGameServer};
if(require.main===module){const server=createGameServer({stateFile:process.env.GAME_STATE_PATH||path.join(__dirname,'runtime','rooms.json')});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已占用，请设置其他 PORT':e.message);process.exitCode=1});server.listen(Number(process.env.PORT)||8787,'0.0.0.0',()=>console.log('唬牌 · 动物剧场 http://localhost:'+server.address().port));}
