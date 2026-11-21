import { clamp } from "./host.js";
import { WInstruments } from "./instruments.js";
const WPhysical=(()=>{
 const tau=2*Math.PI;
 const hz=midi=>440*2**((midi-69)/12);
 const stiff=(f,b,n)=>f*n*Math.sqrt((1+b*n*n)/(1+b));
 const roots=[2.4048255577,3.8317059702,5.1356223018,5.5200781103,6.3801618952];
 const membrane=(base)=>roots.map(r=>base*r/roots[0]);
 const profiles={
  electric:{transient:[2980,.010,.024]},
  bass808:{transient:[1050,.005,.009]},
  guitar:{body:[[104,14,.85],[188,20,-.36],[242,25,.31],[381,34,.18],[668,48,-.12],[1018,77,.09]],returnGain:.31,transient:[1900,.018,.042]},
  parlor:{body:[[123,18,.79],[210,21,-.28],[279,27,.45],[432,36,.20],[742,55,-.13]],returnGain:.36},
  nylon:{body:[[96,12,.92],[174,17,-.34],[236,24,.36],[365,29,.31],[616,42,-.11]],returnGain:.31},
  piano:{body:[[174,15,.72],[287,22,-.40],[419,38,.29],[705,51,.25],[1130,67,-.12]],returnGain:.24,transient:[2850,.012,.027]},
  rhodes:{transient:[1640,.013,.019]},
  bass:{body:[[67,11,.8],[171,23,-.37],[395,48,.17]],returnGain:.22,transient:[1530,.017,.020]},
  flute:{breath:[2420,.051,.032],vibrato:[5.1,11,.24]},
  cello:{vibrato:[4.7,15,.17],body:[[113,12,.51],[196,17,-.66],[285,24,.35],[451,36,.25],[760,65,-.13]],returnGain:.34,breath:[1120,.016,.010],vibrato:[5.6,16,.19]}
 };
 function partials(kind,pitch,velocity,timbre,rate,fine=0,settings=null){
  const cfg=settings||WInstruments.defaults(kind),v=velocity/127,color=timbre/100,p=[];
  const guitar=WInstruments.isGuitar(kind),minimumPartialAmplitude=guitar?.00055:.005;
  const f=hz(pitch+(kind==="synth"?cfg.octave*12:kind==="guitar"?cfg.capo:0));
  const put=(wave,hz,amp,decay=0,remain=0,sweep=1,extra={})=>{
   const adjusted=hz*2**((Math.abs(fine)+55)/1200);
   if(adjusted*sweep<rate*.46&&Math.abs(amp)>minimumPartialAmplitude)p.push({wave,hz,amp,decay,remain,sweep,...extra});
  };
  if(kind==="synth"){
   const wave=["sawtooth","pulse","triangle","sine"][cfg.model];
   const oscillatorOptions={pulse:cfg.pulse/100,fm:cfg.model===3?cfg.fm:0};
   put(wave,f,.72,0,0,1,oscillatorOptions);
   if(cfg.detune>0){
    put(wave,f,.31,0,0,1,{...oscillatorOptions,detune:cfg.detune});
    put(wave,f,.24,0,0,1,{...oscillatorOptions,detune:-cfg.detune*.77});
   }
   put("sine",f*.5,cfg.sub*.0048);
  }
  if(kind==="bass808"){
   [.87,.092,.038].forEach((amp,i)=>put("sine",f*(i+1),amp,i?.083:0,i?.21:0,1.24+.12*v));
  }
  if(kind==="piano"){
   const b=(.00016+.00005*2**((pitch-60)/36))*(cfg.rigid/100)*[1,.84,1.22][cfg.model];
   for(let n=1;n<=9;n++){
    const x=.098+(100-cfg.hammer)*.00039;
    const hammer=Math.sin(x*Math.PI*n)/Math.sin(x*Math.PI);
    const amp=(.82/(n**1.28))*hammer*Math.exp(-(n-1)*(.24-.11*v-.05*color-.085*cfg.hammer/100));
    put("sine",stiff(f,b,n),amp,(.75+.68*(1-v))*(1.23-cfg.damper*.006+cfg.pedal*.007)/n**1.11,.014);
   }
   if(pitch>=48&&pitch<=89)put("sine",f*2**((2+1.6*v)/1200),.19,.54,.055);
  }
  if(guitar){
   const electric=kind==="electric",art=cfg.articulation,mute=art===2,harmonic=art===3;
   const scale=electric?.6477:[.64516,.632,.650][cfg.model];
   const wire=WInstruments.chooseString(pitch+(electric?0:cfg.capo),cfg.hand,scale);
   const x=clamp(cfg.pluck/100*(art===1?1.14:1),.055,.49);
   const scaleDecay=(1.18-cfg.damp*.0075)*(mute?.20:1);
   const b=(electric?.000047:[.000057,.000059,.000024][cfg.model])*(1+wire.fret*.017);
   for(let n=1;n<=(electric?21:20);n++){
    if(harmonic&&n%2)continue;
    const mode=stiff(f,b,n),strike=Math.sin(Math.PI*n*x)/Math.sin(Math.PI*x);
    const softness=art===1?.135:mute?.18:.042+wire.index*.003;
    let amp=.94*strike*Math.exp(-(n-1)*(softness+(1-v)*.10))/n**(electric?.75:1.39);
    let phase=0;
    if(electric){
     const r=WInstruments.pickupCircuit(mode,cfg);
     amp*=WInstruments.pickupWeight(n,wire.length,cfg)*Math.min(3.9,Math.hypot(r.real,r.imag));phase=Math.atan2(r.imag,r.real);
    }else{
     const mic=[.95,1,.88,1.13][cfg.mic],brightness=([1,.98,.81,1.22][cfg.mic])**((n-1)*.33);
     amp*=mic*brightness;
    }
    const decay=(electric?1.02:[.88,.73,.74][cfg.model])*scaleDecay/n**(electric?.59:.72);
    put("sine",mode,amp,decay,.016,1,{phase});
    if(!electric&&n<=4&&cfg.double>0&&!mute){
     const detune=(n%2?1:-1)*(3+cfg.double*.09);
     put("sine",mode,amp*cfg.double*.0028,decay*.89,.013,1,{detune,phase:.53});
    }
   }
  }
  if(kind==="bass"){
   const x=.105+.065*(1-color),b=.00017;
   for(let n=1;n<=11;n++){
    const pluck=Math.sin(Math.PI*n*x)/Math.sin(Math.PI*x);
    const roll=Math.exp(-(n-1)*(.27-.17*v-.08*color));
    put("sine",stiff(f,b,n),.94*pluck*roll/n**1.50,(1.06-.42*v)/n**1.05,.021);
   }
  }
  if(kind==="rhodes"){
   for(const [n,ratio,base,fade] of [[1,1,.84,.73],[2,2,.13,.25],[3,3.004,.10,.18],[4,4.009,.066,.12],[5,5.021,.032,.075],[7,7.063,.115,.049],[9,9.21,.053,.031]]){
    const bell=n>=5?(cfg.bell/50)*[1,1.34,.81][cfg.model]:1;
    const bark=n>=2&&n<=4?(1+cfg.bark*.011*[.92,.73,1.26][cfg.model]*v):1;
    put("sine",f*ratio,base*bell*bark*(n===1?1:(.24+.75*v+.42*color)),fade*(1.14-cfg.damper*.005+cfg.pedal*.006),n===1?.15:.008);
   }
  }
  if(kind==="flute"){
   // El perfil de mayor intensidad se calibra con el espectro de Do4 de UNSW.
   const soft=[.037,.018,.009,.004,.002],strong=[2.91,2.19,2.80,2.13,1.79];
   const line=clamp((velocity-40)/80,0,1)**1.17;
   put("sine",f,1);
   for(let i=0;i<soft.length;i++){
    const from=soft[i],to=strong[i];
    const amp=from*Math.pow(to/from,line)*Math.pow(.88+.24*color,(i+1)*.45);
    put("sine",f*(i+2),amp,.18,.985);
   }
  }
  if(kind==="cello"){
   for(let n=1;n<=10;n++){
    const bow=Math.sin(Math.PI*n*(.077+.03*(1-color)));
    const amp=n===1?.63:bow*.67/(n**.95)*Math.exp(-(n-1)*(.105-.053*v))*((-1)**(n+1));
    put("sine",f*n,amp,n===1?0:.15, .91);
   }
  }
  const total=p.reduce((sum,m)=>sum+Math.abs(m.amp),0)||1;
  return p.map(m=>({...m,amp:m.amp/Math.max(1,total*.85)}));
 }
 const bodyImpulses=new WeakMap(),radiators=new WeakMap();
 function makeIR(context,kind){
  if(!bodyImpulses.has(context))bodyImpulses.set(context,new Map());
  const cache=bodyImpulses.get(context);
  if(cache.has(kind))return cache.get(kind);
  const model=profiles[kind],sr=context.sampleRate;
  const ir=context.createBuffer(2,Math.ceil(sr*.31),sr);
  for(let side=0;side<2;side++){
   const y=ir.getChannelData(side);
   let norm=0;
   for(let i=0;i<y.length;i++){
    const t=i/sr;
    const shaped=model.body.reduce((v,[f,d,a],k)=>v+Math.sin(tau*f*(side?1.0008:1)*t)*Math.exp(-d*t)*a*(side&&k%2?.90:1),0);
    y[i]=shaped*(1-Math.exp(-1800*t))*(1-Math.min(1,Math.max(0,(t-.275)/.035)));
    norm+=Math.abs(y[i]);
   }
   if(norm)for(let i=0;i<y.length;i++)y[i]/=norm;
  }
  cache.set(kind,ir);return ir;
 }
 function radiate(context,kind,source,target,sendAmount=1) {
  const model=profiles[kind];if(!model?.body)return;
  if(!radiators.has(target))radiators.set(target,new Map());
  const map=radiators.get(target);
  if(!map.has(kind)){
   const body=context.createConvolver(),gain=context.createGain();
   body.normalize=false;body.buffer=makeIR(context,kind);
   gain.gain.value=model.returnGain;
   body.connect(gain).connect(target);map.set(kind,body);
  }
  if(sendAmount===1){source.connect(map.get(kind));return null;}
  const send=context.createGain();send.gain.value=sendAmount;
  source.connect(send).connect(map.get(kind));return send;
 }
 return {hz,stiff,membrane,partials,profiles,makeIR,radiate};
})();

export { WPhysical };
