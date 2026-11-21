# Larp Player

Larp Player combina un reproductor, un sintetizador con secuenciador y una comunidad privada por invitación. El proyecto incluye la interfaz web en español y el servidor con SQLite persistente sobre Cloudflare Workers y Durable Objects.

El código se publica bajo licencia MIT. [Licencia](LICENSE) · [Créditos y recursos de terceros](THIRD-PARTY-NOTICES.md)

## Qué encontré en el HTML original

| Sección | Implementación original | Implementación actual |
| --- | --- | --- |
| Biblioteca y reproductor | Los audios se abrían con URL temporales. Las playlists se guardaban en `localStorage` y apuntaban a posiciones de una biblioteca en memoria. | Como visitante puedes reproducir audio temporal. Con una cuenta, los audios y playlists privadas se guardan en el servidor y las pistas se referencian por un identificador estable. |
| Sintetizador | Web Audio generaba el sonido, y la batería y el piano roll reproducían patrones en memoria. La descarga WAV llamaba a una API de Claude. | El Estudio tiene hasta veinte pistas, editor de notas, Larp FX, mezclador, grabación en vivo y exportación WAV de 48 o 96 kHz y 24 bits. Guarda el arreglo con sus muestras y ajustes de audio. |
| EQ y DAC | Ocho bandas, compresor, analizador, frecuencia de salida, afinación y tonos de prueba en el navegador. El soporte de DAC variaba según el dispositivo. | Cada cuenta puede guardar perfiles de audio con ocho filtros paramétricos, compresor, limitador, balance, afinación, medición y comparación A/B. La salida y frecuencia físicas dependen del navegador y del DAC. |
| Perfil | Identidad, perfil, chat y playlists compartidas dependían de `claude.use("user")`, `claude.use("db")` y `claude.use("assets")`. | Usuario y contraseña propios, sesión persistente, nombre visible, foto, biografía, gustos, tema y cambio de contraseña. |
| Amigos y chat | Se agregaban usuarios desde sugerencias, las conversaciones dependían del servicio original y compartir la URL general servía como invitación informal. | Cada cuenta puede generar enlaces de un solo uso válidos por siete días. El chat privado conserva mensajes, audio, stickers incluidos y stickers de imagen (PNG, JPEG, GIF o WebP). |
| Comunidad | La publicación guardaba nombres de pistas y recogía comentarios y calificaciones. | La comunidad puede reproducir y descargar el audio real de cada publicación, comentar y actualizar o quitar su voto de 1 a 5 estrellas. Cada publicación puede incluir hasta 20 pistas. |

El archivo original es independiente. Si conservas los audios que usabas allí, puedes abrirlos desde **Biblioteca** después de entrar a tu cuenta para guardarlos en el nuevo servidor. Los perfiles, archivos y conversaciones del servicio anterior requieren una exportación de ese servicio para migrarse.

## Probar en tu computadora

1. Instala Node.js 22 o posterior y abre una terminal en la carpeta de este proyecto.
2. Ejecuta `npm ci`.
3. Copia `.dev.vars.example` como `.dev.vars` y asigna a `LARP_SETUP_CODE` un código aleatorio de al menos 16 caracteres.
4. Ejecuta `npm run dev` y abre la dirección local que muestre Wrangler.
5. En **Perfil → Crear cuenta**, introduce ese código para registrar la primera cuenta. Luego entra en **Amigos → Crear enlace**. Prueba el enlace en otra ventana privada para crear una segunda cuenta.
6. En **Biblioteca**, sube un audio. Desde **Comunidad**, publícalo y prueba un comentario y una calificación desde la segunda cuenta.

Ejecuta las pruebas del DDJ con `node --test tests/ddj.test.mjs`.

Wrangler conserva la base de datos local en `.wrangler/state` entre reinicios. Esa base de datos se usa para la prueba local. La publicación en Cloudflare comienza con su propio almacenamiento.

## Publicar en el plan gratuito

1. Abre una cuenta de Cloudflare con el plan **Workers Free** y habilita el subdominio `workers.dev` si Cloudflare te lo pide.
2. Ejecuta `npx wrangler login` y autoriza Wrangler en el navegador.
3. Ejecuta `npm run deploy`. Wrangler creará el Worker y su clase de almacenamiento SQLite, y mostrará la URL HTTPS asignada.
4. Genera un código inicial privado. Puedes usar `openssl rand -hex 24` si tienes OpenSSL.
5. Ejecuta `npx wrangler secret put LARP_SETUP_CODE` y pega el código cuando Wrangler lo solicite.
6. Abre la URL pública, usa el código para crear la primera cuenta y genera enlaces individuales desde **Amigos**. El código inicial solo funciona mientras la base esté vacía.

Conserva el nombre del Worker, la clase `LarpStore` y la migración `v1` al actualizar. La migración `v2` añade `LarpMediaV2` para los audios nuevos. La base original sigue conservando las cuentas, los archivos anteriores y las publicaciones. Los cambios de esquema de la actualización añaden tablas nuevas.

La interfaz usa `public/index.html` como estructura, `public/style.css` para el diseño y `public/main.js` para el arranque. En `public/js/` están los módulos de biblioteca, cuentas, comunidad, apariencia, audio, Estudio y EQ. Las rutas y el almacenamiento del Worker viven en `src/`.

## Datos, formatos y capacidad

- Cada audio de biblioteca o chat puede pesar hasta **200 MiB**. Hay **750 MiB por cuenta** y **3 GiB compartidos por el grupo**. Los stickers de imagen admiten hasta 2 MiB. El sampler decodifica muestras de hasta 32 MiB para tocarlas en tiempo real.
- La carga de audio utiliza partes de 4 MiB. Durante 24 horas puedes volver a seleccionar el mismo archivo para continuar o cancelar la carga desde Biblioteca.
- Un WAV estéreo de 24 bits a 48 kHz ocupa unos 16,5 MiB por minuto. El máximo de 200 MiB admite unos 12 minutos en ese formato. A 96 kHz, son unos 6 minutos. Para colecciones grandes, FLAC suele reducir el tamaño sin perder calidad.
- El perfil, la música privada y los proyectos son personales. Las publicaciones se comparten con las cuentas del grupo y los adjuntos del chat se entregan únicamente a los participantes. Para borrar una pista publicada, retira primero las publicaciones que la usan.
- El sitio conserva los formatos enumerados en el reproductor original. La posibilidad de reproducir o usar un archivo como muestra depende del decodificador del navegador. MP3, WAV, FLAC y OGG son opciones habituales.
- El chat abierto se actualiza cada cinco segundos. Al cerrar sesión o cambiar de pantalla se detiene la consulta periódica.
- El usuario de acceso es único y el nombre del perfil es editable. El cambio de contraseña requiere la contraseña actual. El perfil permite generar un código de recuperación de un solo uso. La cuenta se recupera con el usuario, ese código y una contraseña nueva.

[Cuotas de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Precios y uso de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## Larp DDJ

Larp DDJ se abre desde su propia pestaña y carga sus módulos al entrar. La vista automática muestra cuatro decks en pantallas amplias y Deck ampliado con selector A–D en pantallas estrechas. El crossfader asigna A y C al lado izquierdo y B y D al derecho. El selector del plugin también permite fijar la vista en el dispositivo. Usa la biblioteca y las playlists de la cuenta, o abre archivos del dispositivo. Los decks pueden seguir sonando al pasar al Estudio. La toma del mezclador se puede descargar como WAV, guardar en la biblioteca o abrir como clip.

- **Cabina** carga por defecto con Load Lock, Single, Auto Cue Memory, Quantize a un pulso, Beat Jump de 16, ocho Hot Cues de colores, forma de onda 3Band, tiempo restante, jog Vinyl, ±6 %, Master Tempo y Slip desactivado.
- Activa **Sync** en los decks que quieres enlazar. El reloj arranca en **Fijo** y conserva el BPM al atravesar distintos tramos, cambiar de maestro o mover el fader de un deck sincronizado. Ajusta el tempo común en **Reloj BPM**. Selecciona **Seguir deck** si quieres que **Master** gobierne el tempo variable y la fase. Cada pista requiere un beatgrid. En **Beatgrid → Probar detección** puedes revisar una nueva propuesta antes de guardar una rejilla de la biblioteca.
- Abre **Estéreo** en la cabina para ajustar el espacio de cada canal. **Automática** usa el solape de la mezcla para aplicar un recorte suave de graves y medios bajos y ajustar el espacio estéreo y la sala. **Manual** ofrece paneo, anchura, nivel y tono de la sala y graves al centro. A 0 % de anchura, la señal antes del paneo es mono.
- Importa el XML de colección de rekordbox después de cargar los archivos con sus nombres originales. Larp DDJ usa los puntos TEMPO y POSITION_MARK para cuadrícula, cue y loops. **My Settings** importa y exporta perfiles de Larp DDJ como JSON. El aro al aire y la expulsión controlan los decks virtuales.
- **Auriculares / PFL** permite seleccionar una salida de preescucha por separado cuando el navegador y el sistema la ofrecen. Sin una salida elegida, PFL comparte el máster.
- Las ondas muestran graves, medios y agudos sobre el mismo cursor, con líneas para pulsos y compases. El tamaño y el color reflejan EQ, trim, fader y crossfader. El rojo señala sobrecarga medida o posible recorte digital en el archivo. **Key Shift** transpone por semitonos y la afinidad armónica se calcula de forma continua con los pasajes actuales de ambos decks. La tabla de fuentes busca, ordena por pista o BPM y pagina en bloques de 80. El análisis y los efectos que requieren audio decodificado admiten hasta 64 MiB y 12 minutos.
- El Estudio incorpora de nuevo el piano manual de 25 teclas, tercer oscilador, unísono, regiones de audio con recorte y una forma de canción de hasta cinco minutos. El modo de patrón sigue disponible. Se pueden importar los proyectos JSON de la interfaz alterna y exportar proyectos actuales con sus referencias a muestras.
- En **EQ y DAC → Exportar audio con EQ aplicado** se puede imprimir la cadena de audio como WAV de 48 kHz y 24 bits. La exportación admite pistas de hasta 48 MiB y cuatro minutos.

La tabla nueva `dj_tracks` guarda beatgrids, frases y puntos de cue por usuario y pista. My Settings y Tag List se guardan como preferencias. La base y el almacenamiento de audio conservan las vinculaciones de producción previas.

[Recursos oficiales del CDJ-3000](https://support.pioneerdj.com/hc/en-us/sections/4416175863961-cdj-3000) · [Especificación XML de rekordbox](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf)

- **Controladoras MIDI / HID** permite asignar teclas, perillas y faders a los cuatro decks. El mapeo se guarda en el navegador por cuenta. MIDI acepta Note, Control Change y Pitch Bend. HID aprende pulsaciones binarias y valores absolutos de un byte en las interfaces que el navegador expone.

### Cálculos de Sync

La detección extrae ataques de percusión como incrementos de energía RMS respecto al nivel local de cada banda. La autocorrelación de los ataques `R[k] = Σ e[n] · e[n−k]` estima el período inicial. Si el período en cuadros de análisis es `k` y se analizan `F` cuadros por segundo, el tempo inicial es `BPM = 60F/k`. Una regresión local de tiempo contra número de pulso estima los cambios de tempo. [Cálculos y pruebas de la cabina](docs/audio-verification.md#sync-rejilla-y-mezcla-armónica-en-larp-ddj)

En reproducción, el reloj compartido avanza `BPM/60` pulsos por segundo de AudioContext. Cada deck toma el tempo local de su cuadrícula y su velocidad base es `BPM compartido / BPM local`, considerando relaciones de medio o doble tempo. El error envuelto en `[−0,5, 0,5)` pulsos entra en un control proporcional e integral. Para expresarlo en milisegundos se multiplica por `60000/BPM compartido`. **Master Tempo** compensa el cambio de tono con `−12 log₂(velocidad)` semitonos. La ventana Hann tiene 2048 muestras a frecuencias de salida comunes y un salto de un cuarto de ventana. Ambos canales reciben el mismo retardo cuando Sync comparte ese procesador. El eco usa tres cuartos de pulso y la reverb usa una respuesta impulsional estéreo. [Continuidad y pruebas del DDJ](docs/audio-verification.md#continuidad-de-reproducción-en-ddj)

La arquitectura usa como referencias los controles de Beat Sync del CDJ-3000 y la selección de referencia de Mixxx, con implementación propia en Web Audio. [Manual CDJ-3000](https://www.pioneer-dj.de/wp-content/uploads/2024/02/Pioneer-DJ-CDJ-3000-User-Manual.pdf) · [Motor de Mixxx](https://github.com/mixxxdj/mixxx/blob/main/src/engine/sync/enginesync.cpp) · [Beatgrids de tempo variable](https://manual.mixxx.org/2.7/en/chapters/preferences/beat_detection)

## Biblioteca, Estudio y comunidad

- Biblioteca reconoce etiquetas de archivos MP3 con ID3 y FLAC y permite editar los datos de cualquier pista. Reordena las playlists desde su editor y usa **A continuación** y el botón de cola del reproductor. Las pistas guardadas en tu cuenta retoman su posición en pausa en el mismo navegador.
- Estudio guarda un borrador por cuenta en el dispositivo, incluidas muestras temporales, con deshacer y rehacer. **Grabar notas** captura en la cuadrícula con el transporte encendido. Las regiones de audio se pueden mover con el puntero o con las flechas. Los WAV de mezcla o pista individual se exportan a 48 kHz en 16 o 24 bits.
- Los comentarios de Comunidad pueden enlazar a un segundo de una pista. El listado de Amigos muestra mensajes pendientes y cada conversación tiene un panel de audios. Eliminar una amistad cierra su conversación y el acceso por chat a sus adjuntos. Una invitación aceptada vuelve a habilitar ese historial.

## Resolución y salida

En **EQ y DAC → Resolución y salida**, Larp lee la frecuencia y los bits declarados por los archivos WAV PCM y FLAC de la biblioteca. La ruta directa reproduce fuera del motor de EQ y dinámica. El modo Web Audio muestra la frecuencia de procesamiento y avisa cuando difiere de la frecuencia de la pista en el reproductor. **Guardar en mi cuenta** recuerda la ruta de cada usuario.

La referencia de 997 Hz genera un WAV estéreo de 96 kHz y 24 bits en el dispositivo. La frecuencia que muestra el DAC puede contrastarse durante la reproducción. La profundidad de bits recibida y el remuestreo que pueda aplicar el sistema requieren medición externa. El uso del logotipo Hi-Res Audio requiere la licencia de JAS. [Definición de Hi-Res Audio](https://www.jas-audio.or.jp/english/hi-res-logo-en) · [Solicitud de licencia](https://www.jas-audio.or.jp/english/hi-res-logo-en/hi-res-logo-application-process)

## Actualización del Estudio y del perfil

El Estudio abre vacío e importa y guarda proyectos locales `.larp.json`. **Subir** renderiza la mezcla estéreo a 48 kHz y 24 bits. El WAV se guarda en **Biblioteca → Pistas** y aparece en el selector de Comunidad. La publicación se confirma desde Comunidad. **Guardar proyecto** exporta el arreglo editable `.larp.json`. **Biblioteca → Proyectos** conserva las copias editables ya subidas. **Total de pasos** ajusta la duración del patrón entre 1 y 1024 semicorcheas. El selector de compás muestra grupos de 16, incluidos los pasos de un último compás incompleto. Incluye 20 pistas, los paneles Larp Instruments, el Mixer con conexiones entre canales, grabación con entrada de cuatro pulsos y el calibrador de BPM. **Proyectos anteriores** abre el editor con los borradores y proyectos de la versión anterior.

El perfil permite elegir qué publicaciones y nombres de playlists mostrar a otras cuentas del grupo. Los archivos privados siguen sujetos a los permisos de Biblioteca, Comunidad y Amigos. **Avisos** se abre por separado y usa el historial existente de mensajes, comentarios y publicaciones. Las nuevas calificaciones incorporan fecha para el panel. El ajuste de apariencia y la configuración del vinilo se guardan por cuenta.

El parche mantiene el Worker `larp-player`, las vinculaciones `LARP` y `MEDIA` y las etiquetas de migración `v1` y `v2`. El esquema añade una tabla de actividad para calificaciones mediante `CREATE TABLE IF NOT EXISTS`. La prueba de actualización arranca el código anterior y el nuevo sobre el mismo almacenamiento local con registros de prueba. Para revisar el paquete de producción se puede ejecutar `npx wrangler versions upload --dry-run --keep-vars --strict`.

## Diseño y mediciones de audio

Consulta las comparaciones por instrumento y efecto, las mediciones de EQ y la prueba frente a Rubber Band R3 en la [auditoría de audio](docs/audio-verification.md).

El flujo de exportación, el diseño de Larp FX y las cadenas de inserts por instrumento están en la [guía de sonido del Estudio](docs/studio-hires.md).

### Instrumentos por grabación y modelado

- **Eléctrica** mezcla 25 tomas directas y los modos calculados de cada cuerda. Arranca cada toma cerca del ataque y elige zona por distancia a la nota y a su velocidad. La transposición de semitonos usa `r = 2^(Δn/12)`. La pastilla de la toma es de puente. Las demás posiciones y configuraciones de bobina se estiman con filtros, más una capa modal donde cada armónico se pondera por `sin(π n x/L) · sinc(π n a/(2L))`. El circuito RLC aporta `H(jω) = 1 / [1 + R/RL − ω²LC + jω(RC + L/RL)]`. El banco DI es un Fender grabado directamente y el instrumento adopta la geometría Strat del modelo existente. [FreePats FSBS Direct, CC0](https://github.com/freepats/electric-guitar-FSBS-direct/tree/4c1d54601836c3e1a262b0bb0f3dea0c0a881ad3) · [Modelos físicos de Faust](https://faustlibraries.grame.fr/libs/physmodels/) · [Modelado de posición de pastilla](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2015/MohamadDixonHarte-DAFx2015-PickupPositionModelling.pdf)
- **Piano y nailon** usan 28 y 18 tomas estéreo, respectivamente, mezcladas con el modelo de la cuerda. Las tomas se cargan al abrir el instrumento o al renderizarlo. El modelo cubre las notas fuera del banco. Se conservaron la resonancia de caja, la articulación y la respuesta del pedal. [Meta Piano](https://github.com/facebookincubator/Meta-open-sound/tree/514c926efecdb3c7812bf00eedf8e5c8d61dd681/systems/instruments/meta-piano) · [Meta Nylon Guitar](https://github.com/facebookincubator/Meta-open-sound/tree/514c926efecdb3c7812bf00eedf8e5c8d61dd681/systems/instruments/meta-nylon-guitar)
- La acústica de acero tiene un modo adicional de caja y pérdidas según cuerda. En bajo y Rhodes se recalibraron los parciales de ataque. En 808 la caída de frecuencia se mueve entre `1,24f₀` y `1,36f₀` según velocidad y vuelve a `f₀` en 43 ms. Los platos añaden parciales inarmónicos. La flauta dosifica la transición al espectro fuerte y el cello incorpora modulación de arco a 4,7 Hz.

### Procesadores

| Procesador | Señal y controles |
| --- | --- |
| Amplificador | Filtro de entrada → preamp → saturación asimétrica → EQ de 3 bandas → compresión de etapa → saturación de potencia → presencia → caja y micrófono → volumen. Una curva usa `[tanh(k(x+b))−tanh(kb)]/[k(1−tanh²(kb))]`, con ganancia unitaria alrededor de cero. Preamp y máster usan `10^(dB/20)`. Las etapas no lineales sobremuestrean a 4×. La caja convoluciona la señal con reflexiones tempranas y modos amortiguados `A·e^(−t/τ)·sin(2πft)`. Un ampli insertado sustituye la etapa integrada de la eléctrica. |
| Overdrive / Distortion | El modo Pedal interpola entre `tanh(gx)` y recorte duro. Tres bandas divide en 210 y 2250 Hz con Linkwitz–Riley de cuarto orden y redes paso todo de compensación de fase. Cada banda se satura a 4× con ganancia propia. El nivel húmedo incorpora la compensación `1/√(1+0,012·drive)`. |
| Fuzzy | Cinco curvas de saturación seleccionables. Polarización suma un offset antes de la curva y resta su salida en reposo. Incluye sobremuestreo 1×, 2× o 4×, filtro de tono y mezcla seca/húmeda. |
| Reverb, Chorus y Dimension | Convolución con ruido estéreo decaído por `(1−t/T)^3`, líneas de retardo moduladas por LFO, matriz estéreo y eco con realimentación filtrada acotada a 0,78. |
| Sustain Lead | Compresor con umbral `−12−0,16·amount` dB y relación `1+0,029·amount`. A la envolvente de la cuerda se le asigna un nivel sostenido y tiempos independientes de ataque y caída. |
| Pad Vault | Volumen y filtro por kit. Cada pad cambia su frecuencia o velocidad a `2^(cents/1200)`, con volumen, ataque y balance propios. |
| Drum Circuit | Saturación paralela a 2×, convolución de sala y dos líneas de eco con filtros. En modo Sync, `T=división × 60/BPM`. |
| Calibrador BPM | `r=BPM proyecto/BPM origen`. WSOLA reposiciona ventanas de 46 ms, busca coincidencias por correlación local y mezcla con fundidos complementarios. Mantiene el tono a velocidad distinta. |

Fire aporta referencias de cruces, sobremuestreo y compensación de ganancia. Guitarix y Neural Amp Modeler documentan enfoques de tono, caja e identificación de amplificadores. El enlace suministrado para Guitar Rig incluye instrucciones de instalación y un descriptor. La referencia de funciones de Guitar Rig es la ficha oficial de Native Instruments. [Fire y su licencia AGPL](https://github.com/jerryuhoo/Fire) · [Guitarix](https://github.com/brummer10/guitarix/tree/master/trunk/src) · [Neural Amp Modeler](https://github.com/sdatkinson/neural-amp-modeler) · [Native Instruments](https://www.native-instruments.com/products/guitar-rig-pro)

### DDJ y mezcla

Se revisó Mixxx 2.5, commit `df861f63d11b0ba6ab9519a615dcb9b5113876c0`. `lib` contiene las dependencias de ReplayGain, QM DSP, HID, PortAudio y xwax, entre otras. El control de transporte está en `src/engine` y las asignaciones en `res/controllers`. El PR 16943 se ocupa principalmente de un mapeo Denon MC3000. El archivo Pioneer CDJ HID de la rama enumera CDJ-850, CDJ-900 y CDJ-2000. Larp implementa una cabina de navegador y aprendizaje de entradas. La compatibilidad nativa con pantallas, LEDs y protocolos USB de hardware requiere un perfil por dispositivo. [Mixxx 2.5](https://github.com/mixxxdj/mixxx/tree/2.5) · [Motor 2.5](https://github.com/mixxxdj/mixxx/tree/2.5/src/engine) · [Mapeo HID de la rama](https://github.com/mixxxdj/mixxx/blob/2.5/res/controllers/Pioneer%20CDJ%20HID.hid.xml) · [PR 16943](https://github.com/mixxxdj/mixxx/pull/16943)

La nivelación filtra ambos canales con ponderación K y mide bloques solapados de 400 ms. Aplica puerta absoluta a −70 LUFS y relativa a −10 LU. La corrección hacia −18 LUFS tiene un máximo de +9 dB y deja 1 dB de margen de pico de muestra por pista. Para un ejemplo de prueba, el analizador midió −17,95 LUFS y FFmpeg ebur128 midió −17,8 LUFS. Las pruebas con cuatro pistas de tempo variable ubicaron el percentil 95 de desfase entre decks en 10,6 ms tras el arranque. Las asignaciones MIDI y HID se validaron con eventos simulados.
