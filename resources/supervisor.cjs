'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {createGameServer}=require('./game/server');
const {publicHealth}=require('./public-health.cjs');
function extractPublicUrl(line){return line.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/)?.[0]||null}
class ServiceManager{
  constructor({dataDir,emit=()=>{},log=()=>{},spawnTunnel,probe,retryDelay=1200,timeoutMs=120000}={}){
    this.dataDir=dataDir;this.emit=emit;this.log=log;
    this.spawnTunnel=spawnTunnel||((url)=>spawn(path.join(__dirname,'bin','cloudflared.exe'),['tunnel','--no-autoupdate','--protocol','http2','--url',url],{windowsHide:true,stdio:['ignore','pipe','pipe']}));
    this.probe=probe||publicHealth;this.retryDelay=retryDelay;this.timeoutMs=timeoutMs;
    this.state={phase:'stopped',localUrl:'',publicUrl:'',message:''};this.epoch=0;this.pending=null;this.server=null;this.tunnel=null;this.abort=null;
  }
  update(patch){Object.assign(this.state,patch);this.emit({...this.state});}
  async start(){
    if(this.pending)return this.pending;
    const epoch=++this.epoch;
    this.pending=this.connect(epoch).finally(()=>{if(epoch===this.epoch)this.pending=null});
    return this.pending;
  }
  async connect(epoch){
    this.update({phase:'starting',publicUrl:'',message:''});
    try{
      fs.mkdirSync(this.dataDir,{recursive:true});this.writeLink('');
      if(!this.server){
        const startingServer=this.server=createGameServer({stateFile:path.join(this.dataDir,'rooms.json')});
        this.binding=new Promise((resolve,reject)=>{startingServer.once('error',reject);startingServer.listen(0,'127.0.0.1',resolve)});
        await this.binding;this.binding=null;
        if(epoch!==this.epoch)return;
        this.update({localUrl:`http://127.0.0.1:${startingServer.address().port}/`});
      }
      if(epoch!==this.epoch)return;
      this.endTunnel();this.abort=new AbortController();
      this.update({phase:'connecting'});
      const child=this.tunnel=this.spawnTunnel(this.state.localUrl);
      let candidate,verifying=false,settled=false,timer,lastError;
      await new Promise((resolve,reject)=>{
        const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve()};
        this.abort.signal.addEventListener('abort',()=>finish(new Error('cancelled')),{once:true});
        timer=setTimeout(()=>finish(new Error(lastError?.code==='ENOTFOUND'?'临时域名解析失败，请检查 DNS 后重试。':lastError?.code==='ETIMEDOUT'?'公网访问超时，请重试。':'公网验证超时'+(lastError?.code?'（'+lastError.code+'）':'')+'，请重试。')),this.timeoutMs);timer.unref();
        const verify=async()=>{
          if(verifying||!candidate)return;verifying=true;
          try{
            while(!settled&&epoch===this.epoch){
              let healthy=false;try{healthy=await this.probe(candidate)}catch(error){lastError=error;this.log("Public health check: "+(error.code||error.message))}
              if(healthy){
                if(!settled&&epoch===this.epoch){this.writeLink(candidate);this.update({phase:'ready',publicUrl:candidate,message:''});finish();}
                return;
              }
              await new Promise(r=>{const t=setTimeout(r,this.retryDelay);t.unref()});
            }
            if(!settled)finish(new Error('公网入口暂未就绪，可以重新连接。'));
          }catch(error){finish(error)}
        };
        const lines=stream=>{let buffer='';stream.on('data',chunk=>{buffer+=chunk.toString();const parts=buffer.split(/\r?\n/);buffer=parts.pop();for(const line of parts){this.log(line);const url=extractPublicUrl(line);if(url&&!candidate){candidate=url+'/';verify();}}})};
        lines(child.stdout);lines(child.stderr);
        child.once('error',finish);
        child.once('exit',()=>{
          finish(new Error('公网连接已中断，请重新连接。'));
          if(epoch===this.epoch&&this.state.phase==='ready'){this.writeLink('');this.update({phase:'offline',publicUrl:'',message:'公网连接已中断，本机牌局仍然保留。'})}
        });
      });
    }catch(error){
      if(epoch!==this.epoch)return;
      this.log(String(error));this.endTunnel();this.writeLink('');
      this.update({phase:'error',publicUrl:'',message:error.message==='cancelled'?'连接已取消':error.message});
    }
  }
  writeLink(url){fs.writeFileSync(path.join(this.dataDir,'public-url.txt'),url)}
  endTunnel(){if(this.abort){this.abort.abort();this.abort=null}if(this.tunnel){this.tunnel.kill();this.tunnel=null}}
  async stop(){
    ++this.epoch;this.pending=null;this.endTunnel();
    const server=this.server,binding=this.binding;this.server=null;
    if(binding)await binding.catch(()=>{});
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    this.writeLink('');this.update({phase:'stopped',localUrl:'',publicUrl:'',message:''});
  }
}
module.exports={ServiceManager,extractPublicUrl};
if(require.main===module){
  const dataDir=path.join(process.env.HUPAI_DATA_DIR,'animal-theatre-v2');
  fs.mkdirSync(dataDir,{recursive:true});
  const log=line=>{try{const p=path.join(dataDir,'launcher.log');if(fs.existsSync(p)&&fs.statSync(p).size>2000000)fs.writeFileSync(p,'');fs.appendFileSync(p,new Date().toISOString()+' '+line+'\n')}catch{}};
  const manager=new ServiceManager({dataDir,log,emit:state=>process.stdout.write(JSON.stringify(state)+'\n')});
  let stopping=false;
  const readline=require('node:readline').createInterface({input:process.stdin});
  readline.on('line',async line=>{
    try{const {command}=JSON.parse(line);if(command==='start'&&!stopping)manager.start();if(command==='stop'){stopping=true;await manager.stop();stopping=false}if(command==='shutdown'){stopping=true;await manager.stop();process.exit(0)}}catch(error){log(String(error))}
  });
  readline.on('close',async()=>{await manager.stop();process.exit(0)});
  manager.start();
}
