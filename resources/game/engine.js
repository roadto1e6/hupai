const {randomInt}=require('node:crypto');
const TYPES=['A','2','3','4','5','JOKER'];
class RuleError extends Error {}
const check=(ok,message)=>{if(!ok)throw new RuleError(message)};
function shuffle(items,rng=Math.random){for(let i=items.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[items[i],items[j]]=[items[j],items[i]]}return items}
const secureRandom=()=>randomInt(0,0x100000000)/0x100000000;
function freshGame(players,rng=secureRandom){
 check(players.length>=2&&players.length<=6,'需要 2–6 位玩家');
 const cards=shuffle(TYPES.flatMap(t=>Array(8).fill(t)),rng);
 const order=shuffle(players.map((_,i)=>i),rng); // Extra cards assigned independently of the starting seat.
 const hands=players.map(()=>[]);cards.forEach((c,i)=>hands[order[i%players.length]].push(c));
 const starter=Math.floor(rng()*players.length);
 const g={hands,active:players.map(()=>true),turn:starter,starter,round:1,claim:null,pile:[],last:null,pending:null,winner:null,discarded:[],phase:'playing',version:1,history:[],event:null};
 log(g,{kind:'start',actor:starter,text:`本局开始 · ${players.length} 人，首家随机产生`});return g;
}
function log(g,e){g.event={id:g.version,...e};g.history.unshift({id:g.version,round:g.round,...e});g.history=g.history.slice(0,60)}
function newRound(g,starter){g.round++;g.starter=starter;g.turn=starter;g.active.fill(true);g.claim=null;g.last=null;g.pending=null;g.pile=[]}
function win(g,actor){g.winner=actor;g.phase='finished';g.turn=null;g.pending=null}
function next(g,actor){for(let step=1;step<=g.hands.length;step++){const n=(actor+step)%g.hands.length;if(g.active[n]){g.turn=n;return}}throw new Error('No active player')}
function resolvePasses(g,actor){
 const last=g.last;
 if(g.active.every((a,i)=>!a||i===last.actor)){
  const count=g.pile.length;g.discarded.push(...g.pile);g.pile=[];
  if(g.pending!==null){win(g,last.actor);log(g,{kind:'win-pass',actor:last.actor,count,text:'最后一手全部放行，不揭牌获胜'});}
  else {const starter=last.actor;newRound(g,starter);log(g,{kind:'discard',actor:starter,count,text:'其他玩家全部不要，整堆不翻开弃置'});}
 }else{next(g,actor);log(g,{kind:'pass',actor,text:'不要 · 退出本轮'});}
}
function act(g,actor,action){
 check(g.phase==='playing','本局已经结束');check(actor===g.turn,'还没有轮到你');check(g.active[actor],'你已退出本轮');
 check(action&&typeof action==='object','无效操作');
 const type=action.type;
 if(type==='play'){
  check(g.pending===null,'最后一手待确认，只能质疑或不要');
  const counts=action.cards;check(counts&&typeof counts==='object'&&!Array.isArray(counts),'请选择手牌');
  const cards=[];for(const [t,n]of Object.entries(counts)){check(TYPES.includes(t)&&Number.isInteger(n)&&n>=0&&n<=4,'选牌数量无效');for(let k=0;k<n;k++)cards.push(t)}
  check(cards.length>=1&&cards.length<=4,'每手需要出 1–4 张');
  const hand=[...g.hands[actor]];for(const card of cards){const at=hand.indexOf(card);check(at>=0,'所选牌超过持有数量');hand.splice(at,1)}
  const claim=g.claim??action.claim;check(TYPES.slice(0,5).includes(claim),'请选择 A、2、3、4、5 中的一个点数');
  check(g.claim===null||action.claim===undefined||action.claim===g.claim,'本轮不能更改宣称');
  g.version++;g.hands[actor]=hand;g.claim=claim;g.pile.push(...cards);g.last={actor,cards};
  if(hand.length===0)g.pending=actor;
  next(g,actor);log(g,{kind:g.pending!==null?'last-hand':'play',actor,claim,count:cards.length,text:g.pending!==null?'最后一手 · 等待质疑或放行':'出牌'});
 }else if(type==='pass'){
  check(g.last!==null,'新一轮首家必须出牌');g.version++;g.active[actor]=false;resolvePasses(g,actor);
 }else if(type==='challenge'){
  check(g.last!==null,'还没有可质疑的牌');check(g.last.actor!==actor,'不能质疑自己的牌');
  const last=g.last;const revealed=[...last.cards];const truth=revealed.every(c=>c===g.claim||c==='JOKER');const count=g.pile.length;const claim=g.claim;
  const loser=truth?actor:last.actor,winner=truth?last.actor:actor;const final=g.pending!==null;
  g.version++;g.hands[loser].push(...g.pile);g.pile=[];
  if(final&&truth)win(g,last.actor);else newRound(g,winner);
  log(g,{kind:final&&truth?'win-challenge':'challenge',actor,author:last.actor,truth,loser,roundWinner:winner,revealed,claim,count,final,text:truth?'判真 · 质疑者收走整堆':'判假 · 出牌者收走整堆'});
 }else throw new RuleError('未知操作');
 return g;
}
function snapshot(g,seat){
 if(!g)return null;
 const {hands,pile,last,discarded,...safe}=g;
 return {...safe,active:[...g.active],hand:[...hands[seat]],counts:hands.map(h=>h.length),pileCount:pile.length,discardCount:discarded.length,last:last?{actor:last.actor,count:last.cards.length}:null,history:g.history.map(e=>({...e})),event:g.event?{...g.event}:null};
}
function botAction(g,seat,rng=secureRandom){
 const last=g.last;
 if(g.pending!==null)return {type:rng()<.58?'challenge':'pass'};
 if(last&&last.actor!==seat){if(rng()<.20)return {type:'challenge'};if(rng()<.16)return {type:'pass'}}
 const hand=g.hands[seat],freq=Object.fromEntries(TYPES.map(t=>[t,hand.filter(x=>x===t).length]));
 const claim=g.claim??[...TYPES.slice(0,5)].sort((a,b)=>freq[b]-freq[a])[0];
 const honest=hand.filter(c=>c===claim||c==='JOKER');const bluff=rng()<.23||honest.length===0;
 const candidates=bluff?shuffle([...hand],rng):honest;
 const amount=Math.min(candidates.length,1+Math.floor(rng()*Math.min(4,candidates.length)));
 const cards={};for(const c of candidates.slice(0,amount))cards[c]=(cards[c]??0)+1;
 return {type:'play',cards,claim};
}

module.exports={TYPES,RuleError,shuffle,secureRandom,freshGame,act,snapshot,botAction};
