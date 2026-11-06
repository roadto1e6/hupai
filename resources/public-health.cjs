const https=require('node:https');
const net=require('node:net');
const cache=new Map();
function getJSON(url,lookup,timeout=6000){return new Promise((resolve,reject)=>{
 let timer;const req=https.get(url,{lookup,headers:{accept:'application/dns-json, application/json'}},res=>{let body='';res.on('data',chunk=>{body+=chunk;if(body.length>65536)req.destroy(new Error('Response too large'))});res.on('end',()=>{clearTimeout(timer);if(res.statusCode!==200){const e=new Error('HTTP '+res.statusCode);e.code='HTTP_'+res.statusCode;reject(e);return}try{resolve(JSON.parse(body))}catch(e){reject(e)}});res.on('error',reject)});
 timer=setTimeout(()=>{const e=new Error('Request timed out');e.code='ETIMEDOUT';req.destroy(e)},timeout);req.on('error',e=>{clearTimeout(timer);reject(e)});
})}
async function publicHealth(url){
 const target=new URL('/health',url);if(target.protocol!=='https:'||!target.hostname.endsWith('.trycloudflare.com'))throw Error('Invalid tunnel URL');
 try{return (await getJSON(target)).version===2}catch(e){if(!['ENOTFOUND','EAI_AGAIN'].includes(e.code))throw e}
 let entry=cache.get(target.hostname);
 if(!entry||entry.until<Date.now()){
  const result=await getJSON('https://dns.alidns.com/resolve?type=A&name='+encodeURIComponent(target.hostname));
  const addresses=(result.Answer||[]).filter(a=>a.type===1&&net.isIPv4(a.data)).map(a=>a.data);
  if(!addresses.length){const e=new Error('DNS lookup failed');e.code='ENOTFOUND';throw e}
  entry={addresses,until:Date.now()+60000};cache.set(target.hostname,entry);
 }
 let error;
 for(const address of entry.addresses){try{const lookup=(hostname,options,cb)=>options.all?cb(null,[{address,family:4}]):cb(null,address,4);return (await getJSON(target,lookup)).version===2}catch(e){error=e}}
 throw error;
}
module.exports={publicHealth};
