// in-game (eval'd through __ev): a driver that only uses the controls (steer, brake, nitro), for a no-assist car
window.bot3=function(opt){opt=opt||{};const p=player;const st={wall:0,hits:0,big:0,oob:0,brake:0,minSpd:999,drifts:0,t:0,lapT:[],hitAt:[]};
  let cd=0,lastLap=p.lastLap||0;const N=opt.frames||60*200;
  for(let i=0;i<N&&G.mode!=='finish';i++){
    const u=p.speed,pos=posOf(p),hand=p.spec.handling,ch=(.8+.2*hand)*1.05*9.8;
    // safe speed from the bends ahead
    let vs=999,worst=0,wd=0;const len=p.br<0?1e9:BR[p.br].len;
    for(let d=4;d<=260;d+=4){if(pos+d>len)break;sampleAt(p.br,pos+d);const c=Math.abs(TS.c);if(c>Math.abs(worst)){worst=TS.c;wd=d;}
      const den=c-.0006*ch*(opt.mu||1);const vc=den>0?Math.sqrt(4.5*ch*(opt.mu||1)/den):999;vs=Math.min(vs,Math.sqrt(vc*vc+2*(opt.dec||28)*Math.max(0,d-10)));}
    // aim: pure pursuit at a point ahead, on the inside of the next bend a little
    const look=12+u*.42;const hw=hwAt(p.br,pos);let tx=opt.lane!==undefined?opt.lane:clamp(-Math.sign(worst)*Math.min(hw*.45,Math.abs(worst)*300),-hw*.5,hw*.5);
    if(opt.route&&p.br<0)for(const b of BR){const d=wrapD(b.s0,p.s),d2=wrapD(p.s,b.s0);
      if(b.kind!==opt.route){if((d>0&&d<260)||(d2>0&&d2<b.span&&sepM(b,d2)<GAP))tx=-b.side*9;continue;}
      if(d>0&&d<260)tx=b.side*9;else if(d2>0&&d2<b.span&&sepM(b,d2)<GAP)tx=offM(b,d2);}
    sampleAt(p.br,pos+look);const gx=TS.p.x+TS.r.x*tx,gz=TS.p.z+TS.r.z*tx;sampleE(p);const cx=TS.p.x+TS.r.x*p.x,cz=TS.p.z+TS.r.z*p.x;
    const hx=Math.cos(p.psi),hz=Math.sin(p.psi),dx=gx-cx,dz=gz-cz,ang=Math.atan2(hx*dz-hz*dx,hx*dx+hz*dz);
    const want=2*Math.max(u,5)*Math.sin(ang)/Math.hypot(dx,dz),full=2.6*STEER*(.85+.15*hand)*(1.15-.15*p.spec.mass)/(1+Math.max(0,u)/50);
    let steer=clamp(want/full,-1,1);
    const fast=u>vs*1.02;let brk=!opt.noBrake&&fast&&u>25&&!p.drift;
    if(opt.drift&&!p.drift&&fast&&Math.abs(worst)>1/70&&wd<70&&u>40&&cd<=0){brakeTap();cd=1.5;st.drifts++;}
    cd-=1/60;
    if(p.drift){steer=clamp(want/(full*1.3),-1,1);if(steer*p.driftDir<0)steer=0;brk=false;}
    if(brk)steer=0;
    if(opt.nitro&&!p.nitroLevel&&p.nitro>.5&&!fast&&!p.drift&&vs>u*1.3)pressNitro();
    p.botSteer=steer;p.botBrake=brk;if(brk)st.brake+=1/60;
    const w0=p.wallT,wr=p.stats.wrecks;
    update(1/60);st.t+=1/60;
    if(p.wallT>0&&G.mode==='race'){st.wall+=1/60;if(!(w0>0)){st.hits++;if(st.hitAt.length<12)st.hitAt.push(Math.round(p.s)+(p.br>=0?'b'+p.br:'')+'@'+Math.round(u*3.6));}}
    if(G.raceTime>5)st.minSpd=Math.min(st.minSpd,p.speed);
    if((p.lastLap||0)>lastLap){st.lapT.push(+p.lapTimes.at(-1).toFixed(1));lastLap=p.lastLap;}
  }
  p.botSteer=undefined;p.botBrake=undefined;st.oob=p.stats.oob||0;st.wrecks=p.stats.wrecks;st.minSpd=Math.round(st.minSpd*3.6);st.wall=+st.wall.toFixed(1);st.brake=+st.brake.toFixed(1);st.t=+st.t.toFixed(0);st.L=Math.round(L);st.dist=Math.round(p.dist);
  return st;};
'ok'
