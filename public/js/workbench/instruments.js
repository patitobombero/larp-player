import { clamp } from "./host.js";
const WInstruments=(()=>{
 const choice=(label,options,initial=0)=>({label,options,initial});
 const range=(label,min,max,initial,unit="",step=1)=>({label,min,max,initial,unit,step});
 const eq={low:range("Graves",-12,12,0," dB",.5),mid:range("Medios",-12,12,0," dB",.5),high:range("Agudos",-12,12,0," dB",.5)};
 const expression={level:range("Salida",0,115,92," %"),tune:range("Afinación",-50,50,0," ¢"),touch:range("Curva de ejecución",55,180,100," %")};
 const string={pluck:range("Posición de ataque",8,42,21," %"),hand:range("Traste preferido",0,15,2),noise:range("Ruido de ataque",0,100,20," %"),damp:range("Amortiguación",0,100,29," %"),
  articulation:choice("Articulación",["Púa","Dedos","Palm mute","Armónico natural"]),stroke:choice("Rasgueo",["Individual","Hacia abajo","Hacia arriba","Alterno"]),spreadMs:range("Apertura del rasgueo",0,145,52," ms"),stereo:range("Apertura estéreo",0,100,24," %")};
 const defs={
  fx:{title:"Larp FX",tone:"fx",models:choice("Forma del efecto",["Subida","Barrido descendente","Impacto","Textura estéreo"]),
   panels:[
    ["Generador",{duration:range("Duración",.15,5,1.4," s",.05),sweep:range("Recorrido",0,48,24," st"),density:range("Ruido",0,100,60," %"),
      cutoff:range("Brillo",220,18000,7200," Hz",10),stereo:range("Anchura",0,100,70," %")}],
    ["Interpretación",{release:range("Cola",.05,2,.34," s",.01),...expression}]
   ],
   presets:[["Subida de aire",{duration:2.4,sweep:33,density:85,stereo:88}],["Barrido analógico",{model:1,duration:1.5,sweep:30,density:28,cutoff:4300}],["Impacto de subgrave",{model:2,duration:.9,sweep:19,density:36,cutoff:2500,stereo:44}],["Niebla estéreo",{model:3,duration:4,density:91,stereo:100,release:1.4,cutoff:5400}]]
  },
  electric:{title:"Larp Electric Guitar",tone:"electric",models:choice("Marca y modelo",["Fender Player II Stratocaster · SSS"]),
   panels:[
    ["Captación",{pickup:choice("Selector de pastillas",["Puente","Puente + medio","Medio","Medio + mástil","Mástil"],3),coil:choice("Bobinado",["Single coil SSS","Doble single coil en paralelo","Humbucker en serie"]),tone:range("Tono pasivo",0,100,91," %"),cable:range("Capacitancia del cable",220,900,470," pF")}],
    ["Interpretación",{...string,bend:range("Bend",-12,12,0," st",.25),vibrato:range("Vibrato",0,65,8," ¢"),...expression}],
    ["Amplificador",{amp:choice("Amplificador",["Señal directa","Combo limpio","Combo al límite","Lead saturado"],1),cab:choice("Caja",["Directa","2×12 abierta","4×12 cerrada"],1),drive:range("Ganancia de entrada",0,100,14," %"),presence:range("Presencia",-8,8,1," dB",.5),...eq}]
   ],
   presets:[["Cristal del mástil",{pickup:4,coil:0,amp:1,drive:8,tone:94,low:1,mid:-1}],["Intermedia funk",{pickup:1,coil:0,amp:1,drive:12,tone:98,mid:-3}],["Doble paralelo",{pickup:3,coil:1,amp:1,drive:13}],["Puente al límite",{pickup:0,coil:0,amp:2,drive:34,high:1}],["Lead humbucker",{pickup:0,coil:2,amp:3,cab:2,drive:40,vibrato:24,mid:3}],["DI de estudio",{pickup:2,coil:0,amp:0,cab:0}]]
  },
  guitar:{title:"Larp Acoustic Guitar",tone:"acoustic",models:choice("Caja",["Dreadnought de acero","Cuerpo pequeño de acero","Clásica de nailon"]),
   panels:[
    ["Cuerdas",{...string,capo:range("Capo",0,12,0," st"),double:range("Doble toma",0,100,12," %"),...expression}],
    ["Captación",{mic:choice("Micrófono",["Mezcla de sala","Traste 12","Boca","Puente"],1),body:range("Resonancia de caja",0,100,67," %"),room:range("Aire de sala",0,100,13," %"),distance:range("Distancia",5,80,24," cm"),...eq}]
   ],
   presets:[["Fingerstyle cercano",{articulation:1,pluck:27,mic:1,noise:16}],["Dreadnought de estudio",{articulation:0,pluck:20,body:75,mic:1,room:20}],["Púa y ataque",{articulation:0,pluck:13,mic:3,noise:35,high:2}],["Nailon cálido",{model:2,articulation:1,pluck:31,body:51,high:-2}],["Palm mute",{articulation:2,damp:58,mic:1}],["Armónicos",{articulation:3,body:45,mic:1}]]
  },
  rhodes:{title:"Larp Rhodes",tone:"rhodes",models:choice("Perfil de lengüeta",["Cálido de escenario","Campana brillante","Bark de estudio"]),
   panels:[
    ["Lengüetas",{bell:range("Campana",0,100,43," %"),bark:range("Mordida",0,100,27," %"),noise:range("Ruido mecánico",0,100,20," %"),damper:range("Amortiguador",0,100,32," %"),pedal:range("Pedal",0,100,8," %"),...expression}],
    ["Preamplificador",{drive:range("Drive",0,100,15," %"),...eq,midHi:range("Medios altos",-12,12,0," dB",.5),tremolo:range("Trémolo estéreo",0,100,19," %"),speed:range("Velocidad",.2,12,4," Hz",.1),chorus:range("Chorus",0,100,9," %"),phaser:range("Phaser",0,100,0," %"),delay:range("Eco",0,100,0," %"),cab:choice("Salida",["DI","Combo abierto","Caja oscura"]),mic:choice("Micrófono",["Centro","Borde","Ambiente"])}]
   ],
   presets:[["Suitcase de noche",{tremolo:41,chorus:15}],["Campana",{model:1,bell:79,high:2,chorus:23}],["Bark al límite",{model:2,bark:76,drive:43,mid:2,cab:1}],["Keys espaciales",{chorus:45,delay:31,phaser:23}]]
  },
  piano:{title:"Larp Piano",tone:"piano",models:choice("Perfil",["Concierto","Fieltro","Vertical de sala"]),
   panels:[
    ["Mecánica",{hammer:range("Dureza de martillo",0,100,52," %"),rigid:range("Rigidez",50,200,100," %"),damper:range("Apagador",0,100,32," %"),pedal:range("Pedal",0,100,14," %"),noise:range("Ruido mecánico",0,100,24," %"),...expression}],
    ["Madera y sala",{resonance:range("Resonancia",0,100,49," %"),lid:range("Apertura de tapa",0,100,74," %"),perspective:range("Perspectiva",0,100,28," %"),room:range("Sala",0,100,17," %"),...eq}]
   ],
   presets:[["Concierto",{model:0,lid:93,hammer:56}],["Fieltro nocturno",{model:1,lid:32,hammer:18,high:-4,room:23}],["Vertical cercano",{model:2,perspective:16,noise:45,room:11}],["Pedal y ambiente",{pedal:66,resonance:82,room:36,perspective:71}]]
  },
  synth:{title:"Larp Sintetizador",tone:"synth",models:choice("Oscilador principal",["Diente de sierra","Pulso PWM","Triángulo","Seno FM"]),
   panels:[
    ["Osciladores",{detune:range("Unísono",0,45,9," ¢"),pulse:range("Anchura PWM",12,88,49," %"),sub:range("Suboscilador",0,100,23," %"),octave:range("Octava",-2,2,0),fm:range("Índice FM",0,6,1.3,"",.1),...expression}],
    ["Filtro y envolvente",{filterType:choice("Tipo de filtro",["Paso bajo","Paso banda","Paso alto"]),cutoff:range("Corte",55,16000,4000," Hz",5),res:range("Resonancia",.2,14,1.1,"",.1),filterEnv:range("Envolvente de filtro",-90,90,25," %"),
      attack:range("Ataque",.002,2,.018," s",.002),hold:range("Hold",0,1,0," s",.01),decay:range("Caída",.02,3,.28," s",.01),sustain:range("Sostenido",0,100,75," %"),release:range("Liberación",.01,4,.25," s",.01)}],
    ["Movimiento",{drive:range("Crunch",0,100,13," %"),rate:range("Velocidad LFO",.1,20,4.2," Hz",.1),vibrato:range("Vibrato",0,65,7," ¢"),spread:range("Estéreo",0,100,36," %"),delay:range("Eco",0,100,0," %"),room:range("Sala",0,100,11," %")}]
   ],
   presets:[["Lead de sierra",{model:0,cutoff:5600,detune:15,drive:24,delay:18}],["Pad PWM",{model:1,cutoff:3100,attack:.72,release:1.72,detune:21,room:45,spread:81}],["Bajo ácido",{model:0,cutoff:760,filterEnv:76,res:8.5,sub:37,octave:-1,sustain:33,decay:.16,drive:36}],["Sub redondo",{model:2,cutoff:520,octave:-1,sub:43,filterEnv:0}],["Pluck de pulso",{model:1,pulse:27,attack:.004,sustain:7,decay:.14,filterEnv:52}],["Campana FM",{model:3,fm:3.1,attack:.006,sustain:12,decay:.51,room:23}]]
  }
 };
 for(const d of Object.values(defs))d.parameters=Object.assign({model:d.models},...d.panels.map(([,v])=>v));
 const has=kind=>Object.hasOwn(defs,kind);
 function defaults(kind){
  return Object.fromEntries(Object.entries(defs[kind]?.parameters||{}).map(([k,p])=>[k,p.initial]));
 }
 function read(kind,raw){
  const base=defaults(kind);
  for(const [key,p] of Object.entries(defs[kind]?.parameters||{})){
   const x=raw?.[key];
   if(typeof x!=="number"||!Number.isFinite(x))continue;
   base[key]=p.options?Math.round(clamp(x,0,p.options.length-1)):clamp(x,p.min,p.max);
  }
  return base;
 }
 function preset(kind,i){
  const item=defs[kind]?.presets[i];
  return item?read(kind,item[1]):defaults(kind);
 }
 const get=t=>t.instrument||defaults(t.kind);
 const isGuitar=kind=>kind==="guitar"||kind==="electric";
 const pickPositions=[.041,.098,.163];
 const banks=[[0],[0,1],[1],[1,2],[2]];
 const semitone=(m)=>440*2**((m-69)/12);
 const sinc=x=>Math.abs(x)<1e-9?1:Math.sin(x)/x;
 function chooseString(m,hand=2,scale=.6477){
  const open=[40,45,50,55,59,64], candidates=open.map((midi,i)=>({index:i,fret:m-midi,length:scale*2**((midi-m)/12)})).filter(s=>s.fret>=0&&s.fret<=24);
  return candidates.sort((a,b)=>Math.abs(a.fret-hand)-Math.abs(b.fret-hand)||a.fret-b.fret)[0]||{index:m<40?0:5,fret:clamp(m-64,0,24),length:scale*2**(-clamp(m-64,0,24)/12)};
 }
 function pickupCircuit(f,v){
  const coil=Math.round(v.coil),R=[5900,3500,10800][coil],L=[2.45,1.7,4.5][coil];
  const C=(v.cable+[105,175,155][coil]+(1-v.tone/100)**2*2700)*1e-12,RL=250000;
  const w=2*Math.PI*f,a=1+R/RL-w*w*L*C,b=w*(R*C+L/RL);
  return {real:a/(a*a+b*b),imag:-b/(a*a+b*b),resonance:1/(2*Math.PI*Math.sqrt(L*C)),R,L,C,RL};
 }
 function pickupWeight(n,length,v){
  const sum=banks[Math.round(v.pickup)],coil=Math.round(v.coil);
  const aperture=coil===2?.014:.008;
  const point=x=>Math.sin(Math.PI*n*x/length)*sinc(Math.PI*n*aperture/(2*length));
  let pickup=0;
  for(const i of sum){
   const x=pickPositions[i],signal=coil===0?point(x):(point(x-.008)+point(x+.008))*.5*(coil===2?1.32:1);
   pickup+=signal;
  }
  return pickup/sum.length;
 }
 function strumDelay(note,v){
  if(!v.stroke)return 0;
  const index=chooseString(note.pitch+(v.capo??0),v.hand).index;
  const up=v.stroke===2||v.stroke===3&&(Math.floor(note.start*2+1e-7)%2===1);
  return v.spreadMs*.001*(up?5-index:index)/5;
 }
 return {defs,defaults,read,preset,get,has,isGuitar,chooseString,pickupWeight,pickupCircuit,semitone,pickPositions,strumDelay};
})();

export { WInstruments };
