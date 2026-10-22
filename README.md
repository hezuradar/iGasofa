# ⛽ iGasofa

Web que localiza las **gasolineras más cercanas** a tu ubicación o a un **código postal**, o **todas las
que hay en tu ruta** entre un origen y un destino. Muestra el **precio de cada carburante** (gasóleo,
gasolinas 95/98, premium, GLP,…) y **resalta la más barata** tanto en el listado como en el mapa.
Funciona en escritorio y en el **móvil**.

Los datos son los **oficiales del Ministerio de Industria, Comercio y Turismo** (precios que las
gasolineras están obligadas a comunicar), no hay datos inventados ni aproximaciones.

![Stack](https://img.shields.io/badge/Node-18%2B-0f1720) ![Dependencias](https://img.shields.io/badge/dependencias-0-0b6b3d) ![Licencia](https://img.shields.io/badge/licencia-MIT-1a73e8)

---

## Puesta en marcha

```bash
node server.js
```

Y abre **http://127.0.0.1:3000**. No hace falta `npm install`: el proyecto **no tiene dependencias**.

```bash
npm test      # 42 tests con el runner nativo de Node (node --test), sin red
```

```bash
PORT=8080 HOST=0.0.0.0 node server.js   # cambiar puerto / exponer en la red
```

> La geolocalización del navegador exige **HTTPS o localhost**. Si abres la web desde otra IP de tu
> red sin HTTPS, la ubicación no funcionará, pero el **código postal sí**.

### Publicarla gratis en Render

El repositorio incluye [`render.yaml`](render.yaml), así que el despliegue es casi automático:

1. Entra en [render.com](https://render.com) con tu cuenta de GitHub.
2. **New → Blueprint** y elige este repositorio. Render lee `render.yaml` y crea el servicio
   `igasofa` en el plan gratuito.
3. Pulsa **Apply**. Al terminar tendrás una dirección pública con HTTPS
   (`https://igasofa-xxxx.onrender.com`), en la que la geolocalización también funciona.

Cada `git push` a `main` vuelve a desplegar. En el plan gratuito el servicio **se duerme tras unos
15 minutos sin visitas**: la primera visita después tarda alrededor de un minuto, porque además
descarga de nuevo los precios del Ministerio.

---

## Funcionalidades

| | |
|---|---|
| **Ubicación o código postal** | Botón de geolocalización o búsqueda por CP (5 dígitos) |
| **Gasolineras en ruta** | Modo *En ruta*: origen y destino (ciudad, dirección, CP o tu ubicación). Se traza la ruta por carretera y se listan todas las gasolineras a menos de 1, 2, 5 o 10 km del trayecto, en orden de kilómetro, con la más barata señalada en el mapa y en la lista |
| **Lista cómoda** | Filtro por nombre, marca o calle; paginación de 30 en 30; otros carburantes plegados; cabecera fija con el recuento; botón *Ver en la lista* desde el mapa y el resumen |
| **Versión móvil** | Pestañas *Lista* / *Mapa* abajo, barra de búsqueda que se pliega tras buscar una ruta, objetivos táctiles de 44 px y respeto de las zonas seguras del iPhone |
| **Precios completos** | 24 carburantes: Gasóleo A, Gasolina 95 E5/E10/E25/E85, 98 E5/E10, Gasóleo Premium, GLP, biodiésel, biometanol, GNC/GNL, biogases, AdBlue, diésel y gasolina renovables, hidrógeno, metanol y amoniaco |
| **Mejor precio resaltado** | Ficha verde en el listado + pin verde con estrella en el mapa + resumen con el ahorro frente a la media y a la más cara de la zona |
| **Precios por tramos** | Cada precio se colorea como barato / medio / caro según los terciles de la zona, en el mapa y en el listado, con la diferencia frente al mejor |
| **Distribución de precios** | Histograma de la zona con mínimo, máximo y media |
| **Ahorro por depósito** | Coste de llenar el depósito (5–200 L, configurable) y lo que te ahorras frente a la media y a la más cara |
| **Abiertas ahora** | Se interpreta el horario declarado (`L-V: 06:00-22:00; S-D: …`, 24 h, tramos partidos, tramos que cruzan la medianoche) y se muestra *Abierta · cierra 22:00* o *Cerrada · abre 07:00*; filtro para ocultar las cerradas |
| **Venta restringida** | Las gasolineras sólo para socios (`Tipo Venta = R`) se señalan y no cuentan como mejor precio |
| **Enlace compartible** | La URL guarda CP o ruta, carburante y radio (`?cp=20560&producto=G95E5`, `?origen=Oñati&destino=Bilbao`); botón *Compartir*. La ubicación GPS nunca va a la URL ni se guarda |
| **Preferencias** | Carburante, radio, orden, filtros, depósito y último CP se recuerdan en el navegador |
| **Mapa tipo Google Maps** | Basemap vectorial de Carto (estilo Google) con callejero y satélite, conmutables |
| **Capa vectorial** | Basemap vectorial real de Carto (MapLibre GL) con etiquetas y calles nítidas a cualquier zoom, sincronizado con Leaflet |
| **Marcadores con precio** | Cada pin muestra el €/L del producto elegido; las gasolineras cercanas se agrupan en círculos con el número y el precio mínimo |
| **Ordenación y filtros** | Por distancia, por precio ascendente o descendente; radio de 2 a 50 km; filtro de las que tienen el producto seleccionado |
| **Navegación** | Enlace a Google Maps para ver la gasolinera o calcular la ruta |
| **Accesible** | Enlace *Saltar a la lista*, lista ordenada (`<ol>`) con cada ficha etiquetada por su nombre, precios leídos como «1,669 euros por litro», foco gestionado al paginar o al venir del mapa, botones reales, foco visible en marcadores, `prefers-reduced-motion` respetado, Esc para salir de pantalla completa |

---

## Arquitectura

```
iGasofa/
├── server.js              Servidor Node sin dependencias: API + estáticos + caché
├── lib/
│   └── corredor.js        Gasolineras a lo largo de una ruta (rejilla espacial) y simplificación del trazado
├── config.json            Opcional: { "cartoKey": "…" } para usar tu clave de Carto
├── package.json
├── render.yaml            Despliegue en Render (plan gratuito)
├── tests/
│   ├── corredor.test.js   Gasolineras en ruta
│   ├── horario.test.js    Intérprete de horarios
│   └── server.test.js     Utilidades, caché del dataset, API (también /api/ruta) y estáticos
└── public/
    ├── index.html
    ├── styles.css
    ├── js/                Cliente en módulos ES nativos (sin compilación)
    │   ├── app.js         Arranque, búsquedas, preferencias, URL y eventos
    │   ├── comun.js       Estado compartido, DOM y utilidades
    │   ├── analisis.js    Precios, tramos, horarios, filtros y orden
    │   ├── mapa.js        Mapa, marcadores, popups, ruta y vistas móviles
    │   └── panel.js       Resumen, información de la ruta y lista
    ├── mapa-vector.js     Capa base vectorial (MapLibre sincronizado con Leaflet)
    ├── horario.js         Intérprete de horarios (compartido con los tests)
    └── vendor/
        ├── leaflet/       Leaflet 1.9.4 vendorizado (funciona sin CDN)
        └── maplibre/      MapLibre GL JS 5.24.0 vendorizado (capa vectorial)
```

### Capas del mapa

El conmutador de capas ofrece tres opciones, **todas sin clave de API**:

| Capa | Motor | Notas |
|---|---|---|
| **Estilo Google · Vector** | MapLibre GL | Estilo vectorial de Carto (`gl/voyager-gl-style/style.json`): calles y etiquetas vectoriales. Es la que se usa por defecto |
| **Callejero** | Leaflet | Teselas estándar de OpenStreetMap. Actúa también de reserva si la vectorial no puede cargarse |
| **Satélite** | Leaflet | Imágenes de Esri World Imagery |

### Clave de API de Carto (opcional)

**Ninguna capa necesita clave.** Carto sirve su modalidad pública sin autenticación, así que la web
funciona tal cual, sin configuración. Si tienes una clave de [Carto Basemaps](https://carto.com/basemaps)
y quieres que las peticiones de la capa vectorial (teselas, glifos y sprite) se contabilicen en tu
cuenta, puedes activarla de dos formas:

```bash
# 1) Variable de entorno
CARTO_KEY=TU_CLAVE node server.js
```

```json
// 2) Fichero config.json en la raíz del proyecto
{ "cartoKey": "TU_CLAVE" }
```

El servidor la lee al arrancar y la expone en `GET /api/estado` como `carto.clave`; el cliente la
añade a las URLs de teselas vectoriales, glifos y sprite. **Es una clave pública de cliente**: va a
parar al navegador, igual que en cualquier web que use un mapa. Si no hay clave (o la clave no llega),
la aplicación sigue funcionando con normalidad.

### Servidor (`server.js`)

* Descarga **una sola vez** el dataset oficial (~12 MB, ~11.400 estaciones) y lo **cachea en memoria
  30 minutos**. Las peticiones posteriores se resuelven en milisegundos.
* Si el Ministerio no responde al refrescar, **se siguen sirviendo los últimos precios** (la respuesta
  lleva `desactualizado: true` y la web lo avisa) y se reintenta en la siguiente petición. Las
  descargas tienen tiempo máximo (60 s Ministerio, 10 s Nominatim).
* Sirve los estáticos con **gzip, ETag y 304**; las librerías de `vendor/` se cachean una semana.
* Cabeceras de seguridad (`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`) y sólo acepta `GET`/`HEAD`.
* Normaliza cada registro: precios con coma decimal → número, lat/lon WGS84, y un diccionario
  `precios` con sólo los carburantes que esa gasolinera publica.
* Calcula distancias por **Haversine** y filtra por radio.
* **Rutas**: resuelve origen y destino (coordenadas, CP o texto libre con Nominatim, en la misma cola
  de 1 petición/segundo), pide el trayecto al servidor público de **OSRM** (sin clave; configurable
  con `OSRM_URL`) y lo cachea. Las gasolineras se buscan con una rejilla espacial sobre los tramos del
  trazado: Madrid → Barcelona (621 km, ~11.400 estaciones) se resuelve en unos 0,2 s.

### API

| Endpoint | Descripción |
|---|---|
| `GET /api/estaciones?lat=&lon=&radio=` | Gasolineras alrededor de unas coordenadas (radio en km, máx. 50) |
| `GET /api/postal/:cp?radio=` | Resuelve el CP y devuelve las gasolineras cercanas |
| `GET /api/ruta?origen=&destino=&desvio=` | Ruta por carretera y gasolineras a menos de `desvio` km (1, 2, 5 o 10), con `kmRuta` y `desvio` en cada una |
| `GET /api/productos` | Catálogo de carburantes con su clave y nombre |
| `GET /api/estado` | Fecha de los datos, nº de estaciones, estado de la caché y clave de Carto activa |
| `GET /api/refrescar` | Fuerza la descarga del dataset (como mucho una vez cada 2 minutos; si no, 429) |

### Resolución del código postal

Se probaron tres vías, de más a menos precisa:

1. **Estaciones con ese mismo CP** en el dataset oficial → centro exacto, sin llamadas externas.
2. **Geocodificación con Nominatim** (OpenStreetMap), con caché en memoria (también de los CP
   inexistentes) y una cola que garantiza 1 petición/segundo aunque lleguen varias a la vez, según su
   política de uso. Cubre los CP sin ninguna gasolinera registrada.
3. **Aproximación por provincia**, usando el prefijo de dos dígitos del CP, como último recurso.

### Fuentes de datos

* **Precios**: API REST del Ministerio de Industria, Comercio y Turismo
  (`sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes`).
* **Geocodificación de CP**: [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap).
* **Rutas**: [OSRM](https://project-osrm.org/) (servidor de demostración público, para uso moderado).
* **Mapa**: [Leaflet](https://leafletjs.com/) + [MapLibre GL JS](https://maplibre.org/) + teselas
  [CartoDB](https://carto.com/basemaps/) y [Esri World Imagery](https://www.esri.com/).

---

## Detalles de implementación

* **Agrupación de marcadores por celdas de pantalla** (74 px): con 200 gasolineras en 10 km los
  precios se solapaban y eran ilegibles. Ahora se agrupan en círculos con el número de estaciones y
  el precio mínimo; al hacer clic se amplía el mapa y se separan.
* **La mejor gasolinera siempre se dibuja aparte**, en verde y por encima de los grupos, porque es el
  dato que se busca.
* **Los marcadores tienen nombre accesible** (`aria-label`) y el precio del grupo se pinta con un
  pseudo-elemento CSS, para que el texto visible y el nombre accesible coincidan (WCAG 2.2 AA).
* **Sin CDN**: Leaflet y MapLibre están vendorizados en `public/vendor/`, así que el mapa carga aunque
  falte conexión con unpkg o jsdelivr. MapLibre sólo se descarga cuando el usuario elige la capa
  vectorial, de forma que la carga inicial no se resiente.
* **Capa vectorial híbrida**: MapLibre pinta el basemap vectorial de Carto en un lienzo propio
  (`#mapa-fondo`) y **Leaflet sigue siendo el motor** de marcadores, agrupación, popups e
  interacción. Así se conserva todo el comportamiento ya probado sin reescribirlo.
* **Cámaras sincronizadas**: al mover o hacer zoom en Leaflet se replica la vista en MapLibre con
  `jumpTo`. Leaflet trabaja con teselas de 256 px y MapLibre con de 512 px, así que el zoom de
  MapLibre es `zoom − 1`; con ello **ambos mapas abarcan exactamente el mismo territorio**.
* **Si la capa vectorial falla** (WebGL no disponible, estilo no accesible, timeout), se avisa por
  toast y se vuelve automáticamente a la última capa raster que se estuviera usando, o al
  callejero si no hubiera ninguna.
* **Precios formateados en español** (`1,739 €/L`) con `Intl.NumberFormat`.
* **Los popups sobreviven al repintado**: los marcadores se regeneran en cada `moveend` (para
  reagruparlos), así que se recuerda qué popup estaba abierto y se reabre en el marcador nuevo. El
  repintado se aplaza fuera del evento para no destruir un popup mientras su autoPan lo abre.
* **Búsquedas sin carreras**: si se lanza una búsqueda antes de que responda la anterior, la
  respuesta antigua se descarta.

---

## Comprobaciones realizadas

* ✅ Búsqueda por CP y por geolocalización simulada (Madrid, A Coruña).
* ✅ Cambio de carburante, ordenación por precio, filtro de producto y cambio de radio.
* ✅ CP sin coincidencia exacta (`15001` → geocodificado a A Coruña).
* ✅ CP inválido y CP inexistente (`99999` → 404 controlado).
* ✅ Responsive verificado a 400 px: mapa arriba, panel abajo, sin desbordamiento horizontal.
* ✅ Capa vectorial: se renderizan calles, límites y topónimos reales (Madrid, Bilbao, Sevilla…),
  con la cámara sincronizada con Leaflet (mismos límites geográficos al 4º decimal) y sin errores de
  consola.
* ✅ Ninguna capa exige clave de API: el conmutador sólo ofrece capas que funcionan en la modalidad
  pública. Si se configura una clave, llega a las teselas vectoriales, glifos y sprite.
* ✅ La capa vectorial es la de por defecto; si su estilo no se puede cargar (fallo de red simulado),
  se avisa por toast y el mapa cae al callejero sin quedarse en blanco.
* ✅ Pantalla completa: el lienzo vectorial se redimensiona correctamente al entrar y al salir.
* ✅ Cambio de capa en caliente: al volver a una capa raster el motor MapLibre se destruye y el
  contenedor queda limpio.
* ✅ Capa vectorial a 400 px: el lienzo se ajusta al alto del mapa y el diseño móvil (mapa arriba,
  panel abajo) se mantiene sin desbordamiento.
* ✅ Cambiar de capa mientras la vectorial se está cargando no deja el mapa a medias ni avisa de
  un error falso.
* ✅ `npm test`: 32 tests (intérprete de horarios, caché del dataset con fallo y caducidad simulados,
  API, gzip/ETag, CSP, path traversal).
* ✅ El intérprete reconoce el 100 % de los 11.399 horarios reales del dataset (1.166 formatos).
* ✅ Navegador: búsqueda por URL (`?cp=20560`), cambio de radio conservando el CP, cambio de
  carburante, filtros, orden por precio, depósito, CP inexistente, dos búsquedas seguidas y popups
  abiertos tras `flyTo` sin errores de consola; 400 px sin desbordamiento horizontal.

---

## Limitaciones

* El dataset oficial **no incluye todas las gasolineras** de España: hay estaciones que no
  comunican precio (sobre todo las de servicio gratuito o las más pequeñas) y el Ministerio tarda en
  reflejar los cambios.
* Los **horarios** que aparecen son los declarados por la propia gasolinera; *Abierta/Cerrada* se
  calcula con la hora del dispositivo y no tiene en cuenta festivos. Cuando sólo se declara el lunes
  (`L: 24H`, bastante habitual) el resto de días se muestra como desconocido.
* La **geolocalización** requiere HTTPS o localhost.
* El **desvío** de cada gasolinera es la distancia en línea recta a la ruta, no el rodeo real por
  carretera (una gasolinera al otro lado de una autovía puede exigir un rodeo mayor).
* El servidor público de **OSRM** es de demostración: para un uso intenso conviene montar uno propio y
  apuntar `OSRM_URL` a él.
* La **capa vectorial** necesita WebGL: en navegadores o equipos sin aceleración por hardware puede
  no dibujarse. En ese caso la app cae automáticamente en la capa raster, así que el mapa sigue
  siendo utilizable.
* El Ministerio **no garantiza** la disponibilidad de su API: si cae, la web avisa y conserva la
  última caché en memoria.

---

MIT
