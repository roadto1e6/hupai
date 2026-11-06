const path=require('node:path');const {spawn}=require('node:child_process');const {createGameServer}=require('./resources/game/server');
const server=createGameServer({stateFile:path.join(__dirname,'data','rooms.json')});let fallback=false;
server.on('error',error=>{if(error.code==='EADDRINUSE'&&!fallback){fallback=true;server.listen(0,'127.0.0.1')}else{console.error(error.message);process.exitCode=1}});
server.on('listening',()=>{const url='http://127.0.0.1:'+server.address().port;console.log('唬牌 · 动物剧场\n'+url+'\n保持此窗口运行；关闭此窗口即可停止本机服务。');spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,detached:true,stdio:'ignore'}).unref()});server.listen(8787,'127.0.0.1');
process.on('SIGINT',()=>{server.closeAllConnections();server.close(()=>process.exit(0))});
