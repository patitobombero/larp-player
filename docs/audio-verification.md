# Auditoría de audio de Larp Player

Los resultados corresponden a Chromium, señales de referencia generadas y las rutas reales del reproductor, Estudio y DDJ. Las referencias de código sirven para comparar el comportamiento y las decisiones de procesamiento. El método de Rubber Band R3 también se ejecutó localmente para la comparación de transposición.

## Continuidad de reproducción en DDJ

Las pistas que caben en el presupuesto de memoria se reproducen desde PCM a 44,1 kHz. El análisis sigue separado a 22,05 kHz. La reproducción desde el elemento de audio queda disponible para archivos largos, multicanal y equipos sin el procesador requerido. Al cambiar el punto de reproducción o entrar en un loop desde PCM, se cruzan las dos fuentes durante al menos 14 ms.

La ventana del transpositor se solapa al 75 %. Esto reduce a la mitad la frecuencia de las transformadas respecto a la versión anterior. Durante un tramo silencioso sostenido se suspenden las FFT. Si el procesador de tono falla, el canal recupera la señal directa. El control **Graves al centro** ahora usa un filtro de estantería en la señal lateral con hasta 30 dB de atenuación a baja frecuencia. La señal central se conserva en la matriz estéreo.

En Chromium, reproduje una señal continua en dos decks e introduje una espera de 180 ms al volver a iniciar el decodificador. La prueba activó Sync en reproducción, saltó en la pista y entró y salió de un loop. La versión anterior volvió a invocar el decodificador tres veces y registró 35 ventanas de 10 ms por debajo del umbral de silencio de la prueba. Con la ruta PCM, las 189 ventanas medidas quedaron por encima del umbral y el reloj se mantuvo en 139 BPM. La prueba controla la demora del decodificador y usa señales de referencia.

## Reloj fijo y espacio estéreo

El reloj fijo retiene el BPM de entrada a Sync y avanza con `p(t) = p₀ + (t − t₀) BPM/60` a partir del tiempo del motor de audio. Pausar congela la fase. El selector **Seguir deck** permite usar el BPM instantáneo de un maestro variable. Editar **Reloj BPM** activa el modo fijo. La rejilla local cambia la velocidad nominal del deck para conservar el tiempo del reloj común. Una vez alineado, el ajuste de fase se limita a ±0,4 % de la velocidad nominal y descarta errores inferiores a 0,004 pulsos. [Mixxx 2.5, Sync de tempo constante o dinámico](https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx#sync-lock-with-dynamic-tempo)

La sala procesa la señal con una respuesta impulsional estéreo de 125 ms que contiene reflexiones tempranas a partir de 8 ms. Un filtro de paso alto a 215 Hz limita la energía de graves que llega a la convolución. **Tono de sala** mueve el corte superior entre 900 y 10 500 Hz y **Sala** determina su contribución. La matriz calcula `M = (L + R)/2` y `S = (L − R)/2`, después devuelve `M + wS` y `M − wS`. **Graves al centro** aplica un paso alto a 160 Hz a la fracción elegida de `S`. El paneo se aplica tras la matriz. [Especificación Web Audio, ConvolverNode](https://www.w3.org/TR/webaudio/#ConvolverNode)

En automático se estima el solape por bandas de los canales audibles, ponderado por EQ, trim, fader y crossfader. Un canal de referencia conserva los graves. Los secundarios pueden atenuar hasta 4,2 dB de graves y 2 dB de medios bajos. El paneo se desplaza como máximo un 13 % a cada lado, la anchura sube hasta 116 % y la sala entra con un nivel de hasta 9,9 %. La automatización suaviza los cambios con una constante de 300 ms. Al pasar a Manual se recuperan sus valores previos. Apagada conserva el paneo existente y deja la anchura al 100 % y la sala a 0 %.

| Prueba | Resultado |
| --- | --- |
| Reloj virtual de 10 minutos y regresión de cambio de maestro | El reloj fijo conservó BPM y fase con el paso del tiempo y mantuvo 132,25 BPM al cambiar de maestro y al intentar mover el fader sincronizado. |
| 138 segundos de audio real en Chromium | Dos decks mantuvieron el BPM fijado, primero 144 y luego 132,25, con tres tramos nativos distintos y la automatización estéreo activa. En 307 pares de ataques, el percentil 95 de separación fue de 0,29 ms. |
| Anchura, sala y compatibilidad mono | La anchura del 150 % multiplicó la señal lateral por 1,5 con un error de centro inferior a `2 × 10⁻⁸`. La anchura de 0 % anuló la señal lateral con la sala al 40 %. |
| Graves y paneo | Graves al centro redujo el lateral 9,8 dB en el estímulo compuesto de 64 Hz y 6 kHz. El paneo a la derecha dejó el canal izquierdo en silencio en la prueba. |
| Cabina | Verifiqué que el automático cambia al mover el crossfader, que Manual recupera sus parámetros y que se conservan al recargar en escritorio y móvil. |

## Sync, rejilla y mezcla armónica en Larp DDJ

**Sync.** El límite del fader manual de ±6 % impedía que una pista de 119 BPM siguiera a otra de 143 BPM. El nuevo reloj lee la fase del deck maestro y calcula el BPM instantáneo en cada tramo. La velocidad nominal de cada seguidor es `BPM reloj / (BPM pista / escala)`, con escala `1`, `1/2` o `2`, y el motor admite velocidades entre `0,25×` y `2×`. Al enlazar una pista durante la reproducción se alinea con el pulso más cercano. El control de fase corrige después la deriva de la fuente de audio. La rejilla, los saltos y la onda usan el mismo mapa de tiempo a pulsos. Si el maestro se detiene, otro deck activo toma la referencia. [Mixxx 2.5, Sync con tempo dinámico](https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx#sync-lock-with-dynamic-tempo)

**Rejilla y niveles.** Cada ataque se calcula con energía RMS en ventanas cortas de tres bandas y un piso local. Esta comparación reduce el efecto de los batimientos de notas sostenidas. Los pulsos se dibujan sobre un cursor común y las barras de compás tienen más contraste. La altura y el color de la onda estiman el resultado de los filtros y la ganancia del mixer. Los medidores capturan picos estéreo antes y después del fader con `dBFS = 20 log₁₀(pico)`. La onda se vuelve roja ante una sobrecarga medida en la cadena del deck. Los picos planos cerca de escala completa se marcan como posible recorte en el archivo. Esta detección identifica indicios de recorte digital. [Mixxx 2.5, gain staging](https://manual.mixxx.org/2.5/en/chapters/djing_with_mixxx#setting-your-levels-properly-gain-staging)

**Afinidad armónica.** El analizador usa ventanas Hann y FFT de 8192 muestras. Cada región de 1,5 s acumula distribución de las doce clases de nota y guarda hasta nueve parciales dominantes. Los perfiles de Krumhansl–Schmuckler dan la tonalidad global. La afinidad usa la distribución local y combina coincidencia de notas `Σ√(pᵢqᵢ)`, cercanía de centroides tonales de seis dimensiones y aspereza de parciales. La aspereza entre frecuencias usa `d = 0,24 |f₁ − f₂| / (0,021 min(f₁,f₂) + 19)` y `e^(−3,5 d) − e^(−5,75 d)`. Las ponderaciones de esos tres términos son `0,54`, `0,28` y `0,18` cuando existen parciales de los dos decks. La puntuación varía de 0 a 100. Se evalúan transposiciones de ±6 semitonos adicionales y se penalizan los cambios grandes. Una sugerencia aparece solo si mejora la afinidad calculada. El resultado se actualiza tras mover Key Shift y la decisión de aplicarlo queda en el deck. [Gebhardt, Davies y Seeber](https://doi.org/10.3390/app6050123) · [Harte, Sandler y Gasser](https://www.ofai.at/papers/oefai-tr-2006-13.pdf) · [Sethares](https://sethares.engr.wisc.edu/papers/consance.html) · [Perfiles tonales en Essentia](https://essentia.upf.edu/reference/streaming_Key.html)

| Prueba en Chromium | Resultado |
| --- | --- |
| Dos pistas de 143 y 119 BPM con acordes sostenidos y percusión | La detección midió 142,97 y 119,09 BPM. Sync superó el ajuste manual de ±6 %. |
| Maestro con segmentos de 143, 134 y 126 BPM | El seguidor llegó a 143 y 134 BPM en los dos primeros tramos observados. Un reloj fijo de 129 BPM gobernó los dos decks y **Seguir deck** devolvió el control al maestro. |
| Pulso variable detectado, de 143 a 126 BPM | Error de rejilla del percentil 95 de 16,6 ms frente a los ataques de la señal generada. Al pausar el deck A, el reloj eligió B. |
| Salidas de dos decks a 143 y 119 BPM con Sync | 50 pares de ataques. Percentil 95 de 0,39 ms y máximo de 0,43 ms. |
| Cuatro decks con cambio de maestro | Percentil 95 de desfase de rejilla de 6,7 ms en 140 observaciones. También pasaron loops, cues, MIDI y HID simulados. |
| Medición de Key Shift en un seguidor sincronizado | 440 Hz con Master Tempo y 523,25 Hz tras subir tres semitonos. |
| Afinidad, onda y mixer | Una combinación de Do y Do sostenido pasó de 18 a 86 sobre 100 con −1 semitono. Probé corte de graves, reducción de altura con el fader y píxeles rojos al elevar el trim por encima de escala completa. |

Los tests de cálculo se ejecutan con `node --test tests/ddj.test.mjs`.

## Larp DDJ y Mixxx 2.5

Revisé la rama 2.5 en `df861f63d11b0ba6ab9519a615dcb9b5113876c0`. Su motor permite configurar Rubber Band con ventana corta, canales juntos y modo de alta calidad. Larp procesa ventanas Hann de 2048 muestras a 44,1 y 48 kHz, y de 4096 a partir de 88,2 kHz, con un avance de un octavo de ventana. Redistribuye los picos al cambiar de tono y conserva la fase relativa de los bins que pertenecen al mismo pico. Mantiene el ataque de la pista como protección de transitorios para el cambio de tempo con tono fijo. [Motor de Mixxx 2.5](https://github.com/mixxxdj/mixxx/blob/2.5/src/engine/bufferscalers/enginebufferscalerubberband.cpp) · [Rubber Band](https://github.com/breakfastquay/rubberband)

La prueba usó una señal estéreo de seis tonos a 48 kHz con una diferencia de fase de 0,65 rad en el tono principal. Se aplicaron los mismos cocientes `2^(semitonos/12)` a la versión anterior, a esta versión y a la biblioteca nativa Rubber Band R3. El RMS se midió sobre la región estable de la salida. El error tonal en cents se calculó como `1200 × log₂(fmedida / fobjetivo)` para el componente más fuerte.

| Semitonos | Error tonal Larp | RMS anterior | RMS actual | RMS R3 |
| --- | ---: | ---: | ---: | ---: |
| −5 | −0,073 cents | 0,19177 | 0,16847 | 0,17523 |
| +2 | −0,032 cents | 0,16771 | 0,17185 | 0,17528 |
| +7 | +0,041 cents | 0,09303 | 0,15595 | 0,17526 |

Los tres desplazamientos conservaron 0,65 rad de diferencia de fase en Larp. A +7 semitonos, la diferencia de nivel frente a R3 pasó de −5,50 a −1,01 dB. La comparación mide tono, nivel y fase del estímulo controlado. Para música real, las diferencias de tratamiento de transitorios y de timbre requieren una comparación de escucha con niveles igualados.

- **Cuatro decks:** sincronicé pistas de prueba con rejillas variables y ejercité loops, cues, transposición y tempo. El percentil 95 del desfase de rejilla después del arranque fue de 12,5 ms. En una medición independiente de las salidas de dos decks, usé 48 pares de ataques a lo largo de 25 s con efectos. El percentil 95 fue de 0,794 ms y el máximo fue de 0,907 ms.
- **Controladora:** verifiqué el aprendizaje MIDI y HID mediante eventos simulados. La rama 2.5 enumera los CDJ‑850, CDJ‑900 y CDJ‑2000 en su mapeo Pioneer. El PR 16943 incluye un mapeo Denon MC3000. La evaluación del CDJ‑3000 por USB, su jog, la pantalla y su salida física queda pendiente con un dispositivo conectado. [Mapeo HID de Mixxx 2.5](https://github.com/mixxxdj/mixxx/blob/2.5/res/controllers/Pioneer%20CDJ%20HID.hid.xml) · [PR 16943](https://github.com/mixxxdj/mixxx/pull/16943)

## Instrumentos

La batería de pruebas renderizó 11 variantes. Sus picos estuvieron entre −32,56 y −20,58 dBFS con la configuración de prueba. Verifiqué que salieran señales finitas, con ataque y caída y sin saturación. Son medidas de la ejecución de prueba. El nivel resultante varía con la interpretación, los ajustes y el número de voces.

| Instrumento | Diferencia comprobada en el código | Referencia |
| --- | --- | --- |
| Guitarra eléctrica | Faust excita una cuerda de guía de onda. Larp combina tomas DI, modos de cuerda, selectores de posición y un circuito de pastilla RLC. Las tomas son de un Fender en posición de puente. Las demás posiciones y bobinas son simuladas. | [Faust PhysModels](https://github.com/grame-cncm/faustlibraries/blob/master/physmodels.lib) · [FreePats DI](https://github.com/freepats/electric-guitar-FSBS-direct/tree/4c1d54601836c3e1a262b0bb0f3dea0c0a881ad3) |
| Guitarra acústica de acero | El punto de pulsación altera los modos en ambos modelos. Faust usa realimentación de guía de onda. Larp suma parciales amortiguados, pérdida por cuerda y modos propios de caja. | [Faust PhysModels](https://github.com/grame-cncm/faustlibraries/blob/master/physmodels.lib) |
| Guitarra de nailon | sfizz activa regiones según nota y velocidad. Larp combina tomas estéreo del banco Meta con resonancia modal y extiende el rango con síntesis. | [sfizz Voice](https://github.com/sfztools/sfizz/blob/HEAD/src/sfizz/Voice.cpp) · [Meta Nylon Guitar](https://github.com/facebookincubator/Meta-open-sound/tree/514c926efecdb3c7812bf00eedf8e5c8d61dd681/systems/instruments/meta-nylon-guitar) |
| Piano | sfizz admite regiones, curvas y capas por velocidad. Larp mezcla tomas estéreo con modos de cuerda, resonancia y respuesta del pedal. | [sfizz Voice](https://github.com/sfztools/sfizz/blob/HEAD/src/sfizz/Voice.cpp) · [Meta Piano](https://github.com/facebookincubator/Meta-open-sound/tree/514c926efecdb3c7812bf00eedf8e5c8d61dd681/systems/instruments/meta-piano) |
| Rhodes | STK Rhodey usa cuatro operadores FM. Larp usa modos de lámina ponderados por la fuerza del martillo y añade ruido mecánico. | [STK Rhodey](https://github.com/thestk/stk/blob/master/src/Rhodey.cpp) |
| Sintetizador | Surge trata las discontinuidades en su oscilador clásico. Larp usa formas periódicas de banda limitada, FM y filtros de síntesis cuya Q se unificó con la ruta de audio. | [Surge Classic Oscillator](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/oscillators/ClassicOscillator.cpp) |
| Bajo | STK Plucked introduce pérdidas en una línea de retardo realimentada. Larp aplica pérdidas dependientes del armónico a los modos de cuerda. | [STK Plucked](https://github.com/thestk/stk/blob/master/src/Plucked.cpp) |
| 808 | El VCO abierto de VCV Rack documenta las familias de osciladores y su tratamiento espectral. Larp sintetiza el subgrave con caída exponencial hacia `f₀`, seguida de un decaimiento de amplitud independiente. | [VCV Rack Fundamental VCO](https://github.com/VCVRack/Fundamental/blob/HEAD/src/VCO.cpp) |
| Flauta | STK modela el chorro de aire y el tubo como dos retardos. Larp combina modos de tubo con ruido de soplo y cambios espectrales por intensidad. | [STK Flute](https://github.com/thestk/stk/blob/master/src/Flute.cpp) |
| Cello | STK Bowed modela la fricción y los tramos a ambos lados del arco. Larp combina modos de cuerda y cavidad con modulación del arco y vibrato. | [STK Bowed](https://github.com/thestk/stk/blob/master/src/Bowed.cpp) |
| Batería | Hydrogen reproduce capas de muestras según la velocidad. Larp modela membranas y platos con parciales y ruido, y acepta muestras en los pads. | [Hydrogen Sampler](https://github.com/hydrogen-music/hydrogen/blob/HEAD/src/core/Sampler/Sampler.cpp) |

## Plugins de Estudio

Se ejercitaron los controles activos y el apagado de los siete efectos insertables. En la prueba de bypass, el residuo máximo fue inferior a `7 × 10⁻⁷` de amplitud lineal. El límite de ganancia del plugin se comprueba por circuito y preset. Para cada ecuación y los controles disponibles, consulta el [diseño de procesadores](../README.md#procesadores).

| Plugin | Diferencia comprobada en el código | Referencia |
| --- | --- | --- |
| Amplificador | Guitarix deriva redes de tono de circuitos en Faust. El ampli Larp usa dos etapas de saturación sobremuestreadas, ecualización en cascada y una caja convolutiva. La mejora de Q también alcanza los filtros de caja. | [Guitarix Tone Stack](https://github.com/brummer10/guitarix/blob/master/trunk/src/faust/tonestack.dsp) |
| Overdrive / Distortion | Fire compensa el nivel en función de un exponente de ganancia. Larp usa compensación por raíz cuadrada y dispone de cruce Linkwitz–Riley de cuarto orden para tres bandas. | [Fire Drive Compensation](https://github.com/jerryuhoo/Fire/blob/master/Source/DSP/DriveCompensation.h) |
| Fuzzy | BYOD Fuzz Machine usa modelos dinámicos. Larp usa cinco curvas estáticas polarizables, sobremuestreo configurable y control de tono. | [BYOD Fuzz Machine](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/drive/fuzz_machine/FuzzMachine.cpp) |
| Reverb / Chorus / Dimension | Dragonfly separa reflexiones tempranas y campo tardío, con difusión y decaimiento por bandas. Larp combina convolución de sala, modulación de retardo y una matriz estéreo. | [Dragonfly Hall DSP](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-hall-reverb/DSP.cpp) |
| Sustain Lead | BYOD ofrece compresión de rodilla suave. Larp asocia la compresión a la envolvente del instrumento para sostener un nivel mientras la voz está activa. | [BYOD Compressor](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/other/Compressor.cpp) |
| Pad Vault | Hydrogen controla por voz el nivel, el panorama y la envolvente del disparo. Larp incluye estos ajustes por pad, afinación y filtro común al kit. | [Hydrogen Sampler](https://github.com/hydrogen-music/hydrogen/blob/HEAD/src/core/Sampler/Sampler.cpp) |
| Drum Circuit | BYOD suaviza tiempo, corte y realimentación de su delay estéreo. Larp combina un retardo filtrado sincronizable con sala convolutiva y saturación en paralelo. | [BYOD Delay](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/other/Delay.cpp) |
| Calibrador BPM | Signalsmith Stretch usa información espectral para mantener coherencia. El flujo de Estudio mantiene el tono con solapamiento y correlación temporal en ventanas de 46 ms. Una referencia de 440 Hz mantuvo su frecuencia de 120 a 150 BPM y pasó de 5,065 a 4,065 s, incluidos fundidos. | [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch) |

## Ecualizador y limitador

Mixxx usa varios biquads para su EQ de mezclador inspirado en Xone. CamillaDSP implementa biquads configurables y EasyEffects integra el EQ de LSP. En Larp, el EQ del reproductor es paramétrico y el gráfico y el render usan los mismos parámetros que la reproducción. Con `Q = 1/√2`, el paso alto o bajo Butterworth tiene una ganancia en el corte de `20 log₁₀(1/√2) = −3,0103 dB`. Web Audio espera la Q de estos dos tipos en dB. El medidor toma picos independientes por canal y combina la potencia de ambos en el analizador espectral. El ajuste de margen calcula el máximo de la curva con el trim y el techo configurados. [Mixxx EQ](https://github.com/mixxxdj/mixxx/blob/2.5/src/effects/backends/builtin/threebandbiquadeqeffect.cpp) · [CamillaDSP](https://github.com/HEnquist/camilladsp/blob/master/src/filters/biquad.rs) · [EasyEffects](https://github.com/wwmm/easyeffects/blob/HEAD/src/equalizer.cpp) · [Web Audio](https://www.w3.org/TR/webaudio-1.1/) · [Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)

El limitador mantiene juntos los canales, mira 4 ms hacia delante y estima tres valores intermedios por intervalo con una interpolación sinc de 32 coeficientes. Aplica `g = min(1, techo / pico)` y recupera el nivel suavemente en unos 85 ms. El ajuste de ganancia en escucha y el render comparten el mismo procesador en navegadores con AudioWorklet. La vía alternativa usa un compresor y un techo de muestras. [x42 Digital Peak Limiter](https://github.com/x42/dpl.lv2) · [ITU‑R BS.1770](https://www.itu.int/rec/R-REC-BS.1770/en)

| Prueba | Resultado |
| --- | --- |
| Paso alto y bajo a 44,1, 48, 96 y 192 kHz | −3,0103 dB en el corte en las cuatro frecuencias de muestreo. |
| Banda paramétrica centrada en 997 Hz | +9,000 dB al solicitar +9 dB. El shelf configurado a −9 dB midió −4,500 dB en su punto medio. |
| Bypass sin dinámica con canales en oposición | La diferencia máxima de cada muestra fue cero. Balance a 100 % derecha anuló izquierda y conservó derecha. |
| Techo de −2 dB con señal de entrada por encima de escala completa | Pico de muestra de 0,7943282 tanto en AudioWorklet como en exportación. |
| Compresor y WAV | Se midieron 288 muestras de retardo a 48 kHz. El render compensa la latencia y reserva el final de la señal. También se descargó y comprobó la cabecera de un WAV estéreo de 48 kHz y 24 bits desde el formulario. |
| Pico entre muestras con FFmpeg | A un techo de −1 dB, las cuatro sinusoides con ataque de 5 ms dieron −1,0 dBTP. Un arranque artificial de 12 kHz y fase de 45° en la primera muestra llegó a −0,5 dBTP. El control intermuestreo es una estimación. |

## Reproductor y regresión del sitio

En Chromium a 1440, 390 y 320 píxeles de ancho comprobé la portada a disco completo, el reemplazo de portada al cambiar de archivo, la portada predeterminada Larper, la cola, la pausa desde el disco y la preferencia de movimiento reducido. El extractor leyó portadas incluidas en archivos MP3, FLAC, M4A, Opus y WAV. Probé también la lectura parcial de un MP3 ya guardado en Biblioteca y confirmé que la portada se muestra a su dueño y que el servidor rechaza la lectura desde una sesión de invitado. El flujo de Estudio, WAV en Biblioteca y publicación en Comunidad se verificó con dos cuentas de prueba en una instancia local aislada.
