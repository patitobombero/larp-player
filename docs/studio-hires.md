# Estudio · sonido, inserts y exportación

**Descargar WAV** y **Subir** renderizan la misma mezcla estéreo en PCM de 24 bits. Puedes elegir 48 o 96 kHz. **Subir** crea una pista privada en Biblioteca y desde allí puedes elegirla para publicar en Comunidad. **Guardar proyecto** descarga el arreglo editable. El render admite cinco minutos de arreglo, incluida la compensación de latencia, y reserva hasta 14 segundos para las colas de los efectos. Usa 48 kHz si necesitas reducir memoria y tamaño de archivo.

## Larp FX

Añade **FX · Efectos tocables** desde el selector de pistas. **Subida**, **Barrido descendente** e **Impacto** completan su recorrido al disparar una nota. **Textura estéreo** entra en fase de liberación al soltar la tecla. Los presets de **Subida de aire**, **Barrido analógico**, **Impacto de subgrave** y **Niebla estéreo** son puntos de partida.

El panel Larper muestra el contorno de frecuencia y la envolvente. Sus perillas ajustan duración, recorrido, proporción de ruido, brillo, anchura, cola, afinación, curva de ejecución y salida. El instrumento usa el teclado manual, las notas del arreglo, MIDI importado y la grabación con cuatro pulsos de entrada. El recorrido tonal usa `f₂/f₁ = 2^(semitonos/12)`. El filtro limita el barrido y el ruido se abre mediante paneo y un retardo lateral de hasta 11 ms. El impacto baja dos octavas respecto a la tecla.

## Cadenas sugeridas

Las cadenas son puntos de partida. Añade cada insert desde **Mixer → Plugins** y ajusta sus perillas escuchando con el bypass. Los insertos propuestos para cada canal también tienen acceso directo en su panel.

| Instrumento | Plugins | Diseño y función |
| --- | --- | --- |
| Guitarra eléctrica | Amplificador, Overdrive, Sustain Lead, Tape Echo | Cabezal con canales Limpio, Crunch, Lead y Bajo, pedal de ganancia, control de cola y eco ámbar. Un ampli insertado sustituye al integrado. |
| Guitarra acústica | Channel EQ, Dynamics, Reverb · Chorus · Dimension | Rack turquesa para resonancias, compresor azul de ataque moderado y sala violeta corta. |
| Piano | Channel EQ, Reverb · Chorus · Dimension | EQ de medios ajustables y sala estéreo. Reduce la cola si se superponen muchas notas. |
| Rhodes | Dynamics, Reverb · Chorus · Dimension, Tape Echo | Dinámica suave, chorus para el movimiento de las lengüetas y repetición filtrada. |
| Sintetizador | Channel EQ, Tape Echo, Reverb · Chorus · Dimension | Filtro para abrir espacio, eco al tempo y sala estéreo para leads o pads. |
| Bajo | Channel EQ, Dynamics, Amplificador | EQ de graves, control de picos y canal de amplificador **Bajo** para añadir armónicos. |
| 808 | Channel EQ, Dynamics | Conservar el fundamental y contener los picos. Ajusta el paso alto por debajo de las notas graves que uses. |
| Flauta | Channel EQ, Reverb · Chorus · Dimension | Ajuste de aspereza en medios y sala corta con la respiración audible al frente. |
| Cello | Channel EQ, Dynamics, Reverb · Chorus · Dimension | Ajuste de caja, compresión que deja pasar el ataque del arco y sala con poco retorno. |
| Batería | Pad Vault, Channel EQ, Drum Circuit, Dynamics | Pads naranjas con ataque, afinación y balance por pieza, circuito de color para distorsión y eco, y compresión de grupo. |
| Larp FX | Channel EQ, Tape Echo, Reverb · Chorus · Dimension | Paso alto para limpiar una subida, repeticiones sincronizadas y control de la profundidad estéreo. |
| Audio importado | Calibrador BPM, Channel EQ, Dynamics | Ajuste al tempo, ecualización por canal y dinámica. |
| Bus y máster | Channel EQ, Dynamics | Control tonal y de picos del conjunto. Conviene comparar al mismo volumen. |

### Inserciones nuevas y revisión de las existentes

- **Channel EQ** usa un paso alto Butterworth con corte seleccionable, estanterías de 160 Hz y 5 kHz, y un filtro de medios con frecuencia, Q y ganancia independientes. El valor inicial es plano. [Diseño de filtros biquad](https://www.w3.org/TR/audio-eq-cookbook/)
- **Dynamics** tiene umbral, ratio, rodilla, ataque, liberación y salida. El motor utiliza el compresor estéreo de Web Audio. [DynamicsCompressorNode](https://www.w3.org/TR/webaudio/#DynamicsCompressorNode)
- **Tape Echo** usa dos líneas filtradas, saturación suave a 4× y realimentación máxima del 74 %. El panel ámbar separa el reloj, la división, el color y el cruce estéreo. En Sync, ambas líneas usan una repetición de `pulsos × 60/BPM` segundos. La entrada duplica correctamente una fuente mono hacia ambos lados. [DelayNode](https://www.w3.org/TR/webaudio/#DelayNode)
- **Overdrive** en modo Pedal y **Drum Circuit** ahora sobremuestrean a 4×. **Fuzzy** conserva el selector de 1×, 2× y 4×. **Dimension** abre la señal lateral por encima de 145 Hz y conserva el panorama original de los graves. El amplificador, Sustain, Pad Vault y el calibrador BPM se revisaron junto al resto de la cadena. [Comparaciones por procesador](audio-verification.md#plugins-de-estudio)

## Revisión por instrumento

| Instrumento | Ajuste o comprobación |
| --- | --- |
| Eléctrica | Comprobé la capa DI con los parciales de cuerda y el amplificador. El ataque de púa responde a la velocidad. |
| Acústicas de acero y nailon | Ajusté el balance de graves, medios y agudos para distinguir dreadnought, cuerpo pequeño y nailon. |
| Piano | Diferencié concierto, fieltro y vertical con filtros de voicing, apertura de tapa y dureza de martillo. |
| Rhodes | Separé los tres perfiles con ecualización y saturación, manteniendo el trémolo y el chorus ajustables. |
| Sintetizador | Medí sierra, PWM, triángulo y FM. La modulación FM sigue la afinación y limita su índice cerca de Nyquist. |
| Bajo | Comprobé el cuerpo modal y el ataque de pulsación en registro grave. |
| 808 | Ajusté la respuesta de los sobretonos a timbre y velocidad, y conservé la caída de afinación al fundamental. |
| Flauta | El soplo, el tiempo de ataque y el brillo responden a la velocidad. |
| Cello | Ajusté el ataque y brillo según la velocidad y comprobé vibrato, arco y cuerpo. |
| Batería | Comprobé los ocho pads. Cada golpe sintético cambia su punto de lectura de ruido según el pad y el instante para evitar ataques idénticos. |
| FX | Comprobé cuatro modos, la apertura estéreo, los presets y la grabación en el patrón. |

## Alcance de Hi-Res

El motor renderiza a la frecuencia elegida, estima picos intermuestreo con interpolación 4× y reduce la mezcla completa cuando supera el techo de −1 dBTP estimado. La cuantización aplica dither triangular de un LSB a 24 bits. El ajuste de pico conserva la relación entre pistas y el balance estéreo. [ITU-R BS.1770](https://www.itu.int/rec/R-REC-BS.1770/en)

Los bancos incluidos de eléctrica, piano y nailon son FLAC de **48 kHz y 16 bits**. El modo de 96 kHz procesa el proyecto a esa frecuencia y conserva la resolución de trabajo para la mezcla y los efectos. La capacidad de las tomas de origen y la frecuencia del dispositivo de salida se evalúan por separado. La calibración de la eléctrica con tomas propias de la Fender Player II y las escuchas de referencia en DAC y monitores físicos siguen pendientes.

## Verificación

| Prueba en Chromium y señal de referencia | Resultado |
| --- | --- |
| 23 perfiles de instrumentos a 48 y 96 kHz | Todos produjeron PCM estéreo finito. La mayor diferencia de RMS entre frecuencias de render fue 1,16 dB en el sintetizador FM. |
| Diez inserts de señal | Cada insert cambió la señal con los ajustes de prueba. El bypass regresó a la referencia dentro de la tolerancia de medición. |
| Calibrador BPM | Una señal de 440 Hz conservó su frecuencia al pasar de 100 a 120 BPM. |
| Mezcla de prueba sobrecargada | La salida corregida alcanzó −1,00 dBTP estimado. Una señal de prueba también verificó la detección de picos entre muestras. |
| Grabación de FX y exportación | Los cuatro pulsos de entrada precedieron a la grabación de la nota. La descarga se abrió como PCM estéreo de 96 kHz y 24 bits, también confirmado con FFprobe. |
| Subida y privacidad | Dos cuentas de una instancia local comprobaron que la pista aparece en Biblioteca, se mantiene privada y se puede publicar manualmente en Comunidad. |
