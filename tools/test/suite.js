// Redline Nights feature test suite. Eval'd inside the game (game.html?test=1) through __ev, so it sees the game's
// own variables. Everything is driven through the controls (botSteer/botBrake/pressNitro/brakeTap), at 60 Hz.
window.T={};
T.issues=[];T.note=(m)=>{if(T.issues.length<400)T.issues.push(m);};
// ------------------------------------------------------------------ driving bot (controls only)
T.drive=function(opt,st){const p=player;const u=p.speed,pos=posOf(p),hand=p.spec.handling,ch=(.8+.2*hand)*1.05*9.8;
  let vs=999,worst=0,wd=0;const len=p.br<0?1e9:BR[p.br].len;
  for(let d=4;d<=260;d+=4){if(pos+d>len)break;sampleAt(p.br,pos+d);const c=Math.abs(TS.c);if(c>Math.abs(worst)){worst=TS.c;wd=d;}
    const den=c-.0006*ch;const vc=den>0?Math.sqrt(4.5*ch/den):999;vs=Math.min(vs,Math.sqrt(vc*vc+2*(opt.dec||18)*Math.max(0,d-25)));}
  const look=12+u*.42,hw=hwAt(p.br,pos);
  let tx=opt.lane!==undefined?opt.lane:clamp(-Math.sign(worst)*Math.min(hw*.45,Math.abs(worst)*300),-hw*.5,hw*.5);
  if(opt.route&&p.br<0)for(const b of BR){const d=wrapD(b.s0,p.s),d2=wrapD(p.s,b.s0);
    if(b.kind!==opt.route){if((d>0&&d<260)||(d2>0&&d2<b.span&&sepM(b,d2)<GAP))tx=-b.side*9;continue;}
    if(d>0&&d<260)tx=b.side*9;else if(d2>0&&d2<b.span&&sepM(b,d2)<GAP)tx=offM(b,Math.min(b.span,d2+40));}
  if(opt.avoid){ // steer round roadblocks and traffic in the lane ahead
    for(const o of [...OBST.filter(o=>!o.dead),...traffic.filter(t=>!t.down&&!(t.flying>0))]){if(o.br!==p.br)continue;const d=dAlong(p.br,o.s!==undefined&&o.kind?o.s:posOf(o),pos);
      if(d>0&&d<70&&Math.abs(o.x-tx)<4.5)tx=o.x+(tx>o.x?5:-5)*(Math.abs(o.x+5)<hw-3||Math.abs(o.x-5)>=hw-3?1:-1);}}
  sampleAt(p.br,pos+look);const gx=TS.p.x+TS.r.x*tx,gz=TS.p.z+TS.r.z*tx;sampleE(p);const cx=TS.p.x+TS.r.x*p.x,cz=TS.p.z+TS.r.z*p.x;
  const hx=Math.cos(p.psi),hz=Math.sin(p.psi),dx=gx-cx,dz=gz-cz,ang=Math.atan2(hx*dz-hz*dx,hx*dx+hz*dz);
  const want=2*Math.max(u,5)*Math.sin(ang)/Math.hypot(dx,dz),full=2.6*STEER*(.85+.15*hand)*(1.15-.15*p.spec.mass)/(1+Math.max(0,u)/50);
  let steer=clamp(want/full,-1,1);
  const fast=u>vs*1.02;let brk=!opt.noBrake&&fast&&u>25&&!p.drift&&Math.abs(steer)<.35; // (brake + steer = drift, so only brake when nearly straight)
  if(opt.drift&&!p.drift&&fast&&Math.abs(worst)>1/70&&wd<70&&u>40&&st.cd<=0){brakeTap();st.cd=1.5;st.drifts++;}
  st.cd-=1/60;
  if(p.drift){steer=clamp(want/(full*1.3),-1,1);if(steer*p.driftDir<0)steer=0;brk=false;}
  if(brk)steer=0;
  if(opt.nitro&&!p.nitroLevel&&p.nitro>.5&&!fast&&!p.drift&&vs>u*1.3&&!p.air){pressNitro();st.nitros++;
    if(opt.nitro==='perfect')st.perfectAt=G.raceTime+.7;else if(opt.nitro==='pulse')st.perfectAt=G.raceTime+.15;}
  if(st.perfectAt&&G.raceTime>=st.perfectAt){if(p.nitroLevel===1)pressNitro();st.perfectAt=0;}
  p.botSteer=steer;p.botBrake=brk;
};
// ------------------------------------------------------------------ invariants, checked every frame
T.fin=v=>typeof v==='number'&&isFinite(v);
T.check=function(st,tag){const p=player;
  for(const k of ['x','speed','dist','y','psi','wvx','wvz','yawR','nitro'])if(!T.fin(p[k])){T.note(tag+' player.'+k+'='+p[k]);return false;}
  if(!T.fin(camera.position.x)||!T.fin(camera.position.y)){T.note(tag+' camera NaN');return false;}
  for(const r of rivals){if(r.out)continue;for(const k of ['x','dist','speed','y'])if(!T.fin(r[k])){T.note(tag+' rival '+r.name+'.'+k+'='+r[k]);return false;}}
  const nearFork=e=>BR.some(b=>e.br===b.i?Math.min(Math.abs(e.bs-b.split),Math.abs(e.bs-b.merge))<40:Math.min(Math.abs(wrapD(e.s,msB(b,b.split))),Math.abs(wrapD(e.s,msB(b,b.merge))))<40);
  if(!p.air&&!p.oob&&p.wreck<=0&&G.mode==='race'&&!nearFork(p)){const [lo,hi]=limits(p);if(p.x<lo-.6||p.x>hi+.6){st.escape=(st.escape||0)+1;if(st.escape===1)T.note(tag+' player outside limits x='+p.x.toFixed(1)+' ['+lo.toFixed(1)+','+hi.toFixed(1)+'] at '+(p.br<0?'s':'b'+p.br+':')+Math.round(posOf(p)));}}
  for(const r of rivals){if(r.out||r.air||r.wreck>0||nearFork(r))continue;const [lo,hi]=limits(r);if(r.x<lo-1.5||r.x>hi+1.5){st.rEsc=(st.rEsc||0)+1;if(st.rEsc<3)T.note(tag+' rival '+r.name+' outside limits x='+r.x.toFixed(1)+' ['+lo.toFixed(1)+','+hi.toFixed(1)+'] at '+(r.br<0?'s':'b'+r.br+':')+Math.round(posOf(r)));}}
  if(p.y<-3&&!p.oob){T.note(tag+' player below road y='+p.y.toFixed(1));return false;}
  return true;};
// ------------------------------------------------------------------ a whole race in a mode, with one car
T.race=function(carIdx,mode,opt){opt=opt||{};const tag=MAP_ID+'/'+CARS[carIdx].shape.model+'/'+mode;
  G.modeSel=mode;G.lapsSel=opt.laps||1;setPlayerCar(carIdx);G.resShown=false;startRace();G.paused=false;
  const st={cd:0,drifts:0,nitros:0,wall:0,hits:0,stuck:0,maxStuck:0,frames:0,minSpd:999,perfectAt:0};const p=player;
  const N=60*(opt.secs||170);let ok=true;
  for(let i=0;i<N;i++){
    if(G.mode==='race')T.drive(opt,st);else{p.botSteer=undefined;p.botBrake=undefined;}
    const w0=p.wallT;update(1/60);st.frames++;
    if(!T.check(st,tag)){ok=false;break;}
    if(G.mode==='race'){if(p.wallT>0&&!(w0>0))st.hits++;
      if(p.speed<4&&p.wreck<=0&&!p.oob){st.stuck+=1/60;st.maxStuck=Math.max(st.maxStuck,st.stuck);}else st.stuck=0;
      if(G.raceTime>6&&p.wreck<=0&&!p.oob)st.minSpd=Math.min(st.minSpd,p.speed);}
    if(G.resShown)break;
  }
  p.botSteer=undefined;p.botBrake=undefined;
  const res={tag,mode:G.mode,shown:!!G.resShown,t:+G.raceTime.toFixed(1),place:standings().indexOf(p)+1,laps:p.lapTimes.map(x=>+x.toFixed(1)),
    hits:st.hits,wrecks:p.stats.wrecks,oob:p.stats.oob||0,drifts:st.drifts,nitros:st.nitros,perfect:p.stats.perfect,knock:p.stats.knock,
    maxStuck:+st.maxStuck.toFixed(1),minKmh:Math.round(st.minSpd*3.6),rivalsDone:rivals.filter(r=>r.finished).length,elim:G.elimOrder.length};
  if(st.maxStuck>3)T.note(tag+' stuck for '+res.maxStuck+' s');
  if(!res.shown)T.note(tag+' results never shown (mode '+G.mode+', t '+res.t+')');
  if(mode==='classic'&&res.shown&&res.rivalsDone<rivals.length&&G.raceTime<240){} // rivals may still be racing
  if(res.oob)T.note(tag+' went out of bounds '+res.oob+'x');
  return res;};
// ------------------------------------------------------------------ feature probes on this map
T.clear=s=>{for(let k=0;k<200;k++){const t=mod(s+k*15);if(!GAPS.some(g=>{const d=wrapD(t,g.s0);return d>-200&&d<g.len+150;})&&!BR.some(b=>{const d=wrapD(t,b.s0);return d>-150&&d<b.span+100;})&&!RAMPS.some(r=>r.br<0&&Math.abs(wrapD(t,r.s))<120)&&Math.abs(wrapD(t,TUNNEL.s0+(TUNNEL.s1-TUNNEL.s0)/2))>(TUNNEL.s1-TUNNEL.s0)/2+60)return t;}return s;};
T.setAt=function(br,s,x,spd){const p=player;G.mode='race';G.paused=false;p.oob=null;p.wreck=0;p.stunt=null;p.settle=null;p.tricks=[];p.ghost=0;p.air=false;p.y=0;p.vy=0;p.ramp=null;p.spin=null;p.drift=false;p.nitroLevel=0;
  p.br=br;if(br<0){p.dist=s;p.s=mod(s);}else{p.bs=s;p.dist=mainS(br,s);p.s=mod(p.dist);}p.x=x;alignToTrack(p,spd);p.speed=spd;p.lastLap=p.lastLap||0;};
T.run=function(frames,opt,until){const st={cd:0,drifts:0,nitros:0,perfectAt:0};for(let i=0;i<frames;i++){T.drive(opt||{},st);update(1/60);if(!T.check(st,MAP_ID+' probe'))return false;if(until&&until())return true;}return null;};
T.probes=function(){const p=player,out=[];G.modeSel='classic';G.lapsSel=5;startRace();G.countdown=0;G.mode='race';
  for(let i=0;i<10;i++)update(1/60);
  // ramps: every ramp launches and lands back on the road
  RAMPS.forEach((r,i)=>{T.setAt(r.br,r.s-45,r.x,48);forkCheck(p);if(p.br!==r.br)return;let launched=false,landed=false;
    T.run(60*6,{lane:r.x},()=>{if(p.air)launched=true;if(launched&&!p.air){landed=true;return true;}});
    if(!launched)T.note(MAP_ID+' ramp '+i+' '+Object.keys(RAMP_TYPES).find(k=>RAMP_TYPES[k]===r.T)+' at '+Math.round(r.s)+(r.br>=0?' (branch '+r.br+')':'')+' never launched');
    else if(!landed||p.oob)T.note(MAP_ID+' ramp '+i+' at '+Math.round(r.s)+' landing failed'+(p.oob?' (OOB)':''));});
  // 360 in the air off the biggest ramp, then the payout
  {const r=RAMPS.find(r=>r.T===RAMP_TYPES.mega)||RAMPS[0];if(r){T.setAt(r.br,r.s-45,r.x,55);let did=false;const n0=p.stats.stunts;
    T.run(60*7,{lane:r.x},()=>{if(p.air&&!did&&p.airT>.05){brakeTap();brakeTap();did=true;}return did&&!p.air;});
    if(!did)T.note(MAP_ID+' air 360: never got airborne');else if(p.stats.stunts<=n0)T.note(MAP_ID+' air 360 did not pay out (spin '+!!p.spin+')');}}
  // ground 360 pays nitro
  {const ob=OBST.map(o=>o.dead);OBST.forEach(o=>o.dead=1); // (clear of roadworks, which would wreck the car first)
   T.setAt(-1,T.clear(L*.5),laneX(p,1),50);p.nitro=.2;T.run(30,{});const n0=p.nitro;brakeTap();brakeTap();T.run(60,{});if(!(p.nitro>n0+.05))T.note(MAP_ID+' ground 360 gave no nitro ('+n0.toFixed(2)+'->'+p.nitro.toFixed(2)+')');
   OBST.forEach((o,i)=>o.dead=ob[i]);}
  // gaps: cleared at racing speed
  GAPS.forEach((g,i)=>{T.setAt(-1,g.s0-160,0,72);p.stats.oob=0;let air=false;const r=T.run(60*8,{lane:0,noBrake:true},()=>{if(p.air)air=true;return air&&!p.air||p.oob;});
    if(p.oob||p.stats.oob)T.note(MAP_ID+' gap '+i+' at '+Math.round(g.s0)+': fell in at '+Math.round(p.speed*3.6)+' km/h');else if(!air)T.note(MAP_ID+' gap '+i+' no jump');});
  p.stats.oob=0;
  // forks: each route can be taken, and the car ends up on it
  for(const b of BR){T.setAt(-1,b.s0-300,0,55);let on=false;T.run(60*25,{route:b.kind},()=>{if(p.br===b.i&&b.len*.5<p.bs){on=true;return true;}});
    if(!on)T.note(MAP_ID+' could not take the '+b.kind+' route (br '+p.br+')');
    T.setAt(-1,b.s0-300,0,55);let off=false;const other=b.kind==='short'?'long':'short';
    T.run(60*20,{route:BR.some(c=>c.kind===other)?other:'none'},()=>{if(p.br<0&&wrapD(p.s,b.s0)>b.span*.6){off=true;return true;}if(p.br===b.i&&p.bs>b.len*.5)return true;});
    if(!off)T.note(MAP_ID+' could not stay on the main road past the '+b.kind+' fork (br '+p.br+' bs '+Math.round(p.bs)+' x '+p.x.toFixed(1)+' side '+b.side+')');}
  // fork divider: straddle it and you crash
  for(const b of BR){const n=b.nose,w0=p.stats.wrecks;if(!n){T.note(MAP_ID+' '+b.kind+' fork has no divider');continue;}
    // put the car on the main road 25 m before the nose, straight at it, and let it roll
    T.setAt(-1,msB(b,b.split)-25,0,40);projectTo(p,n.x-n.fx*25,n.z-n.fz*25);p.psi=Math.atan2(n.fz,n.fx);p.wvx=n.fx*40;p.wvz=n.fz*40;p._spd=40;
    for(let i=0;i<90&&p.stats.wrecks===w0;i++){p.botSteer=0;p.botBrake=false;update(1/60);}p.botSteer=undefined;p.botBrake=undefined;
    if(p.stats.wrecks===w0)T.note(MAP_ID+' driving straight into the '+b.kind+' divider did not crash');p.wreck=0;}
  // canisters add nitro
  {const k=PICK.find(k=>k.br<0&&k.y===0);if(k){T.setAt(-1,k.s-60,k.x,40);p.nitro=0;T.run(60*3,{lane:k.x,noBrake:true},()=>p.nitro>.09);if(!(p.nitro>=.09))T.note(MAP_ID+' nitro canister not collected');}}
  // boost pad
  {const pd=PADS.find(q=>q.br<0);if(pd){T.setAt(-1,pd.s-50,pd.x,40);let got=false;T.run(60*3,{lane:pd.x},()=>{if(p.padT>0)got=true;return got;});if(!got)T.note(MAP_ID+' boost pad not triggered');}}
  // roadworks: block wrecks without nitro, smashes with it; barrels slow
  {const blk=OBST.filter(o=>o.kind==='block'&&o.br<0);if(blk.length){const o=blk[0];OBST.forEach(q=>{q.dead=0;q.mesh.visible=true;placeObst(q);});
    T.setAt(-1,o.s-80,o.x,45);const w0=p.stats.wrecks;T.run(60*4,{lane:o.x,noBrake:true},()=>p.stats.wrecks>w0);if(p.stats.wrecks===w0)T.note(MAP_ID+' drove through a roadblock without nitro');
    p.wreck=0;OBST.forEach(q=>{q.dead=0;placeObst(q);});const o2=blk[1]||blk[0];T.setAt(-1,o2.s-80,o2.x,45);p.nitro=1;pressNitro();const w1=p.stats.wrecks;T.run(60*3,{lane:o2.x,noBrake:true},()=>o2.dead);
    if(!o2.dead)T.note(MAP_ID+' nitro did not smash the roadblock');if(p.stats.wrecks>w1)T.note(MAP_ID+' wrecked on a roadblock while on nitro');}}
  // traffic: hitting a parked car sends it flying
  {const straight=s=>{for(let d=0;d<=90;d+=6){sample(s+d);if(Math.abs(TS.c)>1/400)return false;}return true;};
   const t=traffic.find(t=>t.br<0&&!t.down&&T.clear(t.s-70)===mod(t.s-70)&&straight(t.s-70))||traffic.find(t=>t.br<0&&!t.down&&T.clear(t.s-70)===mod(t.s-70));if(t){T.setAt(-1,t.s-70,t.x,45);T.run(60*3,{lane:t.x,noBrake:true},()=>t.flying>0||t.down);if(!(t.flying>0||t.down))T.note(MAP_ID+' drove through parked traffic');}}
  // takedown: nitro ram into a rival
  {const r=rivals[0];if(r&&G.rules.knock){T.setAt(-1,T.clear(L*.3),laneX(p,1),60);r.br=-1;r.dist=p.dist+9;r.s=mod(r.dist);r.x=p.x;r.lane=1;r.laneCD=5;traffic.forEach(t=>{if(t.br<0&&Math.abs(wrapD(t.s,p.s))<300)t.down=true;});r.speed=40;r.wreck=0;r.out=false;const k0=p.stats.knock;p.nitro=1;pressNitro();
    let minD=99;const o={lane:p.x};T.run(60*4,o,()=>{o.lane=r.x;if(r.br===p.br)minD=Math.min(minD,Math.hypot(dAlong(-1,posOf(r),posOf(p)),r.x-p.x));return p.stats.knock>k0;});
    if(p.stats.knock===k0)T.note(MAP_ID+' nitro ram on a rival did not take it down (closest '+minD.toFixed(1)+' m, rival x '+r.x.toFixed(1)+' me '+p.x.toFixed(1)+')');}}
  // shockwave knocks nearby cars
  {T.setAt(-1,T.clear(L*.6),0,50);const k0=p.stats.knock;rivals.forEach((r,i)=>{r.br=-1;r.dist=p.dist+10+i*6;r.s=mod(r.dist);r.x=(i%2?4:-4);r.wreck=0;r.out=false;});p.nitro=1;pressNitro();pressNitro();
    if(p.nitroLevel!==3)T.note(MAP_ID+' full-bar double tap did not give shockwave (level '+p.nitroLevel+')');else if(p.stats.knock===k0)T.note(MAP_ID+' shockwave knocked nobody down');}
  // nitro types: each gives the expected level, and taps never cancel
  {T.setAt(-1,T.clear(L*.2),0,40);p.nitro=.6;pressNitro();T.run(40,{});pressNitro();if(p.nitroLevel!==2)T.note(MAP_ID+' perfect tap gave level '+p.nitroLevel);pressNitro();if(p.nitroLevel!==2)T.note(MAP_ID+' extra tap changed perfect nitro');
   p.nitroLevel=0;p.nitro=.6;pressNitro();T.run(6,{});pressNitro();if(p.nitroLevel!==4)T.note(MAP_ID+' quick double tap gave level '+p.nitroLevel);
   p.nitroLevel=0;p.nitro=.6;pressNitro();T.run(80,{});pressNitro();if(p.nitroLevel!==4)T.note(MAP_ID+' late second tap gave level '+p.nitroLevel);
   p.nitroLevel=0;p.nitro=.3;pressNitro();let t=0;while(p.nitroLevel&&t<60*30){T.run(1,{});t++;}if(p.nitroLevel)T.note(MAP_ID+' nitro never ran out');}
  // drift: starts, chains, ends nitro, charges nitro
  {T.setAt(-1,T.clear(L*.45),0,60);p.nitro=.5;pressNitro();p.botSteer=1;p.botBrake=true;update(1/60);p.botBrake=false;for(let i=0;i<20;i++)update(1/60);
    if(!p.drift)T.note(MAP_ID+' brake+steer did not start a drift');else{if(p.nitroLevel)T.note(MAP_ID+' drift did not end nitro');const d0=p.driftDir;p.botSteer=-1;for(let i=0;i<20;i++)update(1/60);if(p.drift&&p.driftDir===d0)T.note(MAP_ID+' counter-steer did not chain the drift');
      p.botSteer=0;for(let i=0;i<120;i++)update(1/60);if(p.drift)T.note(MAP_ID+' drift did not end after letting go');}
    p.botSteer=undefined;p.botBrake=undefined;}
  // out of bounds: fly off an open edge and get put back
  {let k=-1;for(let j=0;j<NS;j+=5)if(ER[j]&&ROR[j]>=11&&!GAPK[j]&&Math.abs(wrapD(j/NS*L,0))>300&&!BR.some(b=>{const d=wrapD(j/NS*L,b.s0);return d>-100&&d<b.span+100;})){k=j;break;}
    if(k>=0){const s=k/NS*L;T.setAt(-1,s,0,45);const hi=limits(p)[1];p.x=hi+5;p.air=true;p.y=2;p.vy=0;p.airT=0;let saw=false;T.run(60*5,{lane:40,noBrake:true},()=>{if(p.oob)saw=true;return saw&&!p.oob;});
      if(!saw)T.note(MAP_ID+' launching over the run-off barrier was not out of bounds');}}
  // cameras: every one renders
  for(let c=0;c<CAMS.length;c++){cycleCam();T.setAt(-1,L*.33,0,50);for(let i=0;i<30;i++)update(1/60);renderer.render(scene,camera);if(!T.fin(camera.position.x))T.note(MAP_ID+' camera '+CAMS[camMode].n+' NaN');}
  // ghost contact: drive through a rival
  {SET.contact=false;G.rules=rulesFor('classic');T.setAt(-1,T.clear(L*.3),laneX(p,1),60);const r=rivals[0];r.br=-1;r.dist=p.dist+30;r.s=mod(r.dist);r.x=p.x;r.speed=30;r.wreck=0;const s0=p.speed;T.run(60*2,{lane:p.x,noBrake:true});
    if(r.wreck>0)T.note(MAP_ID+' ghost mode: rival still knocked');SET.contact=true;G.rules=rulesFor('classic');}
  // a car already in the air that skims a ramp's lip takes that ramp (it launches again)
  {const r=RAMPS.find(r=>r.br<0&&r.T!==RAMP_TYPES.gap&&r.T!==RAMP_TYPES.mega);if(r){T.setAt(-1,r.s+r.T.len-4,r.x,50);p.air=true;p.y=rEnd(r,r.x)+.8;p.vy=-2;p.airT=.5;
    let up=false;for(let i=0;i<20&&!up;i++){p.botSteer=0;p.botBrake=false;update(1/60);up=p.air&&p.vy>0;}p.botSteer=undefined;p.botBrake=undefined;
    if(!up)T.note(MAP_ID+' skimming a ramp in the air did not launch the car');}}
  // forks: driving through with no steering, nothing but a wall may swing the camera (a swing reads as being steered)
  for(const b of BR){T.setAt(-1,msB(b,b.split)-70,offM(b,Math.max(0,wrapD(msB(b,b.split),b.s0)-1))/2,50);camInit=false;
    const v0=new THREE.Vector3(),v1=new THREE.Vector3();cameraFollow(1/60);camera.getWorldDirection(v0);let worst=0;
    for(let i=0;i<90&&p.wreck<=0;i++){p.botSteer=0;p.botBrake=false;update(1/60);cameraFollow(1/60);camera.getWorldDirection(v1);if(p.wallT<=0)worst=Math.max(worst,v1.angleTo(v0)*57.3);v0.copy(v1);}
    p.botSteer=undefined;p.botBrake=undefined;p.wreck=0;if(worst>8)T.note(MAP_ID+' '+b.kind+' fork: camera swung '+worst.toFixed(0)+'° in one frame');}
  // flips: a normal ramp taken on all four wheels never rolls the car, whatever the angle; one side's wheels on it does
  {const r=RAMPS.find(r=>r.br<0&&!r.T.roll&&r.T!==RAMP_TYPES.gap&&r.T.w<10);if(r){const ob=OBST.map(o=>o.dead);OBST.forEach(o=>o.dead=1);
    const take=(x,a)=>{T.setAt(-1,r.s-12,x,55);p.psi+=a;p.wvx=Math.cos(p.psi)*55;p.wvz=Math.sin(p.psi)*55;let st=null;
      for(let i=0;i<50&&!st;i++){p.botSteer=0;p.botBrake=false;update(1/60);if(p.air&&p.stunt)st=p.stunt.t;}
      p.botSteer=undefined;p.botBrake=undefined;p.wreck=0;p.air=false;p.y=0;p.vy=0;p.stunt=null;p.tricks=[];return st;};
    for(const a of [-.26,0,.26]){const st=take(r.x-Math.tan(a)*(12+r.T.len/2),a);if(st!=='jump')T.note(MAP_ID+' all four wheels on a ramp at '+Math.round(a*57.3)+'° gave '+st);}
    const st=take(r.x+r.T.w/2,0);if(st!=='roll')T.note(MAP_ID+' one side\'s wheels on a ramp gave '+st+', not a roll');
    // landing a roll on the roof wrecks; landing it upright, or on its side (it tips back onto its wheels), doesn't
    for(const [ang,want] of [[Math.PI,true],[Math.PI*2+.2,false],[Math.PI/2,false],[Math.PI*2-1.6,false]]){T.setAt(-1,T.clear(L*.6),0,40);p.air=true;p.y=.4;p.vy=-6;p.airT=1;p.stunt={t:'roll',dir:1,w:0,ang};
      const w0=p.stats.wrecks;for(let i=0;i<10;i++){p.botSteer=0;p.botBrake=false;update(1/60);}p.botSteer=undefined;p.botBrake=undefined;
      if((p.stats.wrecks>w0)!==want)T.note(MAP_ID+' landing a roll at '+Math.round(ang*57.3)+'° '+(want?'did not wreck':'wrecked'));p.wreck=0;}
    OBST.forEach((o,i)=>o.dead=ob[i]);}}
  // more airtime, more barrel rolls, every one landed on the wheels: a twist roll over 0.8 / 1.6 / 2.6 s of flight
  {const ob=OBST.map(o=>o.dead);OBST.forEach(o=>o.dead=1); // (clear of roadworks)
  for(const [air,want] of [[.8,1],[1.6,2],[2.6,3]]){T.setAt(-1,T.clear(L*.7),0,40);const vy=air*24/2;p.air=true;p.y=0;p.vy=vy;p.airT=0;p.airMax=air;
    p.stunt=twistRoll(1,air);p.stunt.ang=0;p.rampType=RAMP_TYPES.twist;const w0=p.stats.wrecks,k0=p.stats.stunts;
    for(let i=0;i<Math.ceil(air*60)+10&&p.air;i++){p.botSteer=0;p.botBrake=false;update(1/60);}p.botSteer=undefined;p.botBrake=undefined;
    if(p.stats.wrecks>w0)T.note(MAP_ID+' a '+air+' s twist roll wrecked');else if(p.stats.stunts-k0!==want)T.note(MAP_ID+' a '+air+' s twist roll gave '+(p.stats.stunts-k0)+' rolls, not '+want);p.wreck=0;}
  OBST.forEach((o,i)=>o.dead=ob[i]);}
  // a twist ramp taken properly always lands its barrel roll on the wheels, at any speed and anywhere across it
  {const ob=OBST.map(o=>o.dead);OBST.forEach(o=>o.dead=1);
    for(const r of RAMPS.filter(r=>r.T.roll))for(const v of [45,60,75,92])for(const dx of [-1.5,0,1.5]){
      T.setAt(r.br,r.s-12,r.x+dx,v);p.wallT=0;const w0=p.stats.wrecks,k0=p.stats.stunts;let flew=false;
      for(let i=0;i<300;i++){p.botSteer=0;p.botBrake=false;p.nitroLevel=0;update(1/60);if(p.air)flew=true;if(flew&&!p.air)break;if(p.stats.wrecks>w0)break;}
      p.botSteer=undefined;p.botBrake=undefined;
      if(p.stats.wrecks>w0)T.note(MAP_ID+' twist ramp at '+Math.round(r.s)+' wrecked at '+Math.round(v*3.6)+' km/h (x '+dx+')');
      else if(flew&&p.stats.stunts===k0)T.note(MAP_ID+' twist ramp at '+Math.round(r.s)+' gave no barrel roll at '+Math.round(v*3.6)+' km/h');
      p.wreck=0;p.air=false;p.y=0;p.stunt=null;p.tricks=[];}
    OBST.forEach((o,i)=>o.dead=ob[i]);}
  // walls: only driving nearly straight into one at speed wrecks; a fast glancing hit, or a slow head-on one, doesn't
  {let s0=-1;for(let s=L*.1;s<L*.9&&s0<0;s+=20){let ok=true;for(let d=-20;d<80;d+=6){const k=kOf(s+d);sample(s+d);if(ER[k]!==0||Math.abs(TS.c)>1/500||inGap(-1,s+d)){ok=false;break;}}
      if(ok&&!BR.some(b=>{const d=wrapD(s,b.s0);return d>-120&&d<b.span+120;})&&!RAMPS.some(r=>r.br<0&&Math.abs(wrapD(s,r.s))<60))s0=s;} // (clear of forks and ramps)
    if(s0>=0){const ob=OBST.map(o=>o.dead);OBST.forEach(o=>o.dead=1);
      for(const [deg,v,want,gap] of [[20,80,false,6],[70,60,true,6],[70,14,false,3]]){const [,hi]=limits({br:-1,s:s0,x:0});T.setAt(-1,s0,hi-gap,v);p.wallT=0;const a=deg/57.3;p.psi+=a;p.wvx=Math.cos(p.psi)*v;p.wvz=Math.sin(p.psi)*v;p._spd=v;
        const w0=p.stats.wrecks;for(let i=0;i<60&&!(p.wallT>0)&&p.stats.wrecks===w0;i++){p.botSteer=0;p.botBrake=false;update(1/60);}update(1/60);p.botSteer=undefined;p.botBrake=undefined;
        if((p.stats.wrecks>w0)!==want)T.note(MAP_ID+' wall hit at '+deg+'° and '+Math.round(v*3.6)+' km/h '+(want?'did not wreck':'wrecked'));p.wreck=0;}
      OBST.forEach((o,i)=>o.dead=ob[i]);}}
  const gl=renderer.getContext().getError();if(gl)T.note(MAP_ID+' GL error '+gl);
  return 'probes done';};
'suite ok'
