(()=>{
'use strict';
class HupaiVoice{
 constructor({send,notify,changed}){this.send=send;this.notify=notify;this.changed=changed;this.stream=null;this.session=null;this.me=null;this.room=null;this.members=[];this.peers=new Map();this.ack=0;this.processing=Promise.resolve();this.starting=false;this.muted=false;this.error='';this.blocked=false;this.generation=0;this.spoken=new Set();this.iceServers=[];this.audioContext=null;this.meterTimer=null;this.confirmed=false}
 status(){return {enabled:!!this.stream,starting:this.starting,muted:this.muted,error:this.error,blocked:this.blocked,connections:[...this.peers.values()].filter(x=>x.pc.connectionState==='connected').length,speaking:[...this.spoken]}}
 changedNow(){this.changed?.(this.status())}
 async start(){
  if(this.stream||this.starting)return;
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('语音需要 HTTPS 邀请链接或本机 localhost');
  const generation=++this.generation;this.starting=true;this.error='';this.changedNow();
  try{
   const AudioContext=window.AudioContext||window.webkitAudioContext;this.audioContext=new AudioContext();await this.audioContext.resume();
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return}
   this.stream=stream;this.session=crypto.randomUUID();this.ack=0;this.muted=false;
   const config=await this.send('voice-config');if(generation!==this.generation)return;this.iceServers=config.iceServers;
   const reply=await this.send('voice',{enabled:true,muted:false,session:this.session});if(generation!==this.generation)return;
   this.confirmed=true;this.localMeter=this.meter(stream);this.meterTimer=setInterval(()=>this.measure(),120);
   for(const t of stream.getAudioTracks())t.onended=()=>{if(this.stream){this.stop();this.notify('麦克风已断开')}};
   await this.sync(reply);
  }catch(e){this.cleanup();this.error=e.name==='NotAllowedError'?'未获得麦克风权限':e.name==='NotFoundError'?'没有检测到麦克风':e.message;throw Error(this.error)}
  finally{if(generation===this.generation){this.starting=false;this.changedNow()}}
 }
 meter(stream){if(!this.audioContext)return null;const source=this.audioContext.createMediaStreamSource(stream),analyser=this.audioContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);return {source,analyser,data:new Uint8Array(256)}}
 measure(){const next=new Set();const active=m=>{if(!m)return false;m.analyser.getByteTimeDomainData(m.data);let sum=0;for(const x of m.data)sum+=((x-128)/128)**2;return Math.sqrt(sum/m.data.length)>.025};if(!this.muted&&active(this.localMeter))next.add(this.me);for(const [id,p]of this.peers)if(active(p.meter))next.add(id);if([...next].join()!==[...this.spoken].join()){this.spoken=next;this.changedNow()}}
 sync(s){
  this.me=s.you;this.room=s.code;this.members=s.players||[];
  if(this.stream&&this.confirmed){const own=this.members.find(p=>p.id===this.me);if(!own?.voice||own.voiceSession!==this.session){this.cleanup();this.error='语音已断开，请重新开启';this.changedNow();return Promise.resolve()}}
  if(this.stream&&this.confirmed){const ids=new Set(this.members.filter(p=>p.id!==this.me&&p.voice&&p.online&&!p.bot).map(p=>p.id));for(const [id,peer]of this.peers){const m=this.members.find(p=>p.id===id);if(!ids.has(id)||peer.session!==m.voiceSession)this.closePeer(id)}for(const id of ids)if(!this.peers.has(id))this.createPeer(this.members.find(p=>p.id===id))}
  const incoming=(s.signals||[]).filter(x=>x.id>this.ack).sort((a,b)=>a.id-b.id);
  this.processing=this.processing.catch(()=>{}).then(async()=>{for(const sig of incoming){if(sig.id<=this.ack)continue;try{if(this.stream&&sig.toSession===this.session)await this.receive(sig)}catch(e){this.error='语音协商失败，可重新加入';this.changedNow()}this.ack=Math.max(this.ack,sig.id)}});return this.processing;
 }
 createPeer(member){
  if(!this.stream||!member.voiceSession)return null;
  const pc=new RTCPeerConnection({iceServers:this.iceServers});const peer={pc,id:member.id,session:member.voiceSession,polite:this.me>member.id,makingOffer:false,ignoreOffer:false,isSettingRemoteAnswerPending:false,candidates:[],retries:0,retryTimer:null,audio:null,meter:null};this.peers.set(member.id,peer);
  const signal=data=>this.send('signal',{to:member.id,session:this.session,toSession:peer.session,data});
  peer.signal=signal;
  pc.onicecandidate=({candidate})=>{if(candidate&&this.stream)signal({candidate:candidate.toJSON()}).catch(()=>{})};
  pc.onnegotiationneeded=async()=>{try{peer.makingOffer=true;await pc.setLocalDescription();if(this.stream&&pc.signalingState!=='closed')await signal({description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}})}catch(e){if(pc.signalingState!=='closed'){this.error='语音正在重新连接';this.changedNow()}}finally{peer.makingOffer=false}};
  pc.ontrack=({track,streams})=>{const remote=streams[0]||new MediaStream([track]);if(!peer.audio){peer.audio=document.createElement('audio');peer.audio.autoplay=true;peer.audio.setAttribute('playsinline','');peer.audio.dataset.voicePeer=member.id;document.body.append(peer.audio)}peer.audio.srcObject=remote;peer.audio.play().catch(()=>{this.blocked=true;this.changedNow()});if(!peer.meter)peer.meter=this.meter(remote)};
  pc.onconnectionstatechange=()=>{this.changedNow();if(pc.connectionState==='connected'){clearTimeout(peer.retryTimer);peer.retryTimer=null;this.error=''}if(['failed','disconnected'].includes(pc.connectionState)&&!peer.retryTimer){peer.retryTimer=setTimeout(()=>{peer.retryTimer=null;if(!this.stream||pc.connectionState==='closed'||pc.connectionState==='connected')return;if(peer.retries++<2){pc.restartIce()}else{this.error='部分语音未连接，可重新加入';this.changedNow()}},pc.connectionState==='failed'?1000:6500)}};
  for(const track of this.stream.getTracks())pc.addTrack(track,this.stream);return peer;
 }
 async receive(sig){const member=this.members.find(p=>p.id===sig.from);if(!member?.voice||member.voiceSession!==sig.session)return;const peer=this.peers.get(sig.from)||this.createPeer(member);if(!peer)return;const {pc}=peer,{description,candidate}=sig.data;
  if(description){const readyForOffer=!peer.makingOffer&&(pc.signalingState==='stable'||peer.isSettingRemoteAnswerPending),collision=description.type==='offer'&&!readyForOffer;peer.ignoreOffer=!peer.polite&&collision;if(peer.ignoreOffer)return;peer.isSettingRemoteAnswerPending=description.type==='answer';await pc.setRemoteDescription(description);peer.isSettingRemoteAnswerPending=false;for(const c of peer.candidates.splice(0))await pc.addIceCandidate(c);if(description.type==='offer'){await pc.setLocalDescription();await peer.signal({description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}})}}
  else if(candidate&&!peer.ignoreOffer){if(pc.remoteDescription)await pc.addIceCandidate(candidate);else peer.candidates.push(candidate)}
 }
 async toggleMute(){if(!this.stream)return this.start();this.muted=!this.muted;this.stream.getAudioTracks().forEach(t=>t.enabled=!this.muted);this.changedNow();await this.send('voice',{enabled:true,muted:this.muted,session:this.session})}
 async resumeAudio(){await this.audioContext?.resume();let blocked=false;for(const p of this.peers.values())if(p.audio)try{await p.audio.play()}catch{blocked=true}this.blocked=blocked;this.changedNow()}
 closePeer(id){const p=this.peers.get(id);if(!p)return;clearTimeout(p.retryTimer);p.pc.onnegotiationneeded=null;p.pc.onconnectionstatechange=null;p.pc.onicecandidate=null;p.pc.ontrack=null;p.pc.close();p.audio?.remove();p.meter?.source.disconnect();this.peers.delete(id)}
 cleanup(){this.generation++;this.confirmed=false;this.starting=false;clearInterval(this.meterTimer);this.meterTimer=null;for(const id of [...this.peers.keys()])this.closePeer(id);if(this.stream){for(const t of this.stream.getTracks()){t.onended=null;t.stop()}}this.stream=null;this.localMeter?.source.disconnect();this.localMeter=null;this.audioContext?.close().catch(()=>{});this.audioContext=null;this.spoken.clear();this.blocked=false;this.muted=false;this.changedNow()}
 async stop(){const session=this.session;this.cleanup();this.session=null;if(session)try{await this.send('voice',{enabled:false,session})}catch{}}
 async diagnostics(){const peers=[];for(const [id,p]of this.peers){const stats=await p.pc.getStats();let sent=0,received=0;stats.forEach(x=>{if(x.type==='outbound-rtp'&&(x.kind==='audio'||x.mediaType==='audio'))sent+=x.bytesSent||0;if(x.type==='inbound-rtp'&&(x.kind==='audio'||x.mediaType==='audio'))received+=x.bytesReceived||0});peers.push({state:p.pc.connectionState,sent,received})}return {...this.status(),peers,microphoneActive:!!this.stream?.getAudioTracks().some(t=>t.readyState==='live'),trackEnabled:!!this.stream?.getAudioTracks().some(t=>t.enabled)}}
}
window.HupaiVoice=HupaiVoice;
})();
