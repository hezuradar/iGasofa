'use strict';

/**
 * iGasofa — servidor de precios de carburantes (Ministerio de Industria, Comercio y Turismo)
 *
 * Sin dependencias externas: sólo módulos nativos de Node.
 *
 *   node server.js            → http://127.0.0.1:3000
 *   PORT=8080 node server.js
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { estacionesEnRuta, simplificar } = require('./lib/corredor');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const MINETUR = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';
const USER_AGENT = 'iGasofa/1.0 (app local de precios de carburantes; node)';
const CACHE_TTL_MS = 30 * 60 * 1000; // el Ministerio actualiza a diario; refresco cada 30 min
const RADIO_MAX_KM = 50;
const MAX_RESULTADOS = 400;
const TIMEOUT_MINETUR_MS = 60 * 1000;
const TIMEOUT_GEO_MS = 10 * 1000;
const GEO_INTERVALO_MS = 1100; // política de Nominatim: 1 petición/segundo
const REFRESCO_MIN_MS = 2 * 60 * 1000; // /api/refrescar no puede forzar descargas en bucle
const REINTENTO_MS = 60 * 1000; // pausa tras un fallo del Ministerio antes de reintentar
const GEO_COLA_MAX = 20; // consultas a Nominatim en espera como máximo
const GEO_CACHE_MAX = 2000;
const LUGAR_MAX_CHARS = 120;

// Rutas por carretera: servidor público de OSRM (sin clave, uso moderado).
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const TIMEOUT_RUTA_MS = 15 * 1000;
const RUTA_CACHE_MAX = 200;
const DESVIOS_KM = [1, 2, 5, 10];
const DESVIO_DEFECTO_KM = 2;
const MAX_RESULTADOS_RUTA = 3000;
const RUTAS_POR_MINUTO = 20;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/* ------------------------------------------------------------------ *
 * Clave de Carto (opcional)
 *
 * Ninguna capa de la web exige clave: Carto sirve su modalidad pública
 * sin autenticación. Si aun así tienes una clave de Carto Basemaps, se
 * puede usar para que las peticiones del estilo vectorial (teselas,
 * glifos y sprite) se contabilicen en tu cuenta:
 *
 *   CARTO_KEY=…  node server.js
 *   o config.json → { "cartoKey": "…" }
 *
 * Sin clave, la aplicación funciona exactamente igual.
 * ------------------------------------------------------------------ */
function leerClaveCarto() {
  const deEntorno = String(process.env.CARTO_KEY || '').trim();
  if (deEntorno) return deEntorno;
  const fichero = path.join(__dirname, 'config.json');
  if (!fs.existsSync(fichero)) return '';
  try {
    // Se quita el BOM: algunos editores (Notepad en Windows) lo escriben.
    const texto = fs.readFileSync(fichero, 'utf8').replace(/^\uFEFF/, '');
    const cfg = JSON.parse(texto);
    if (cfg && typeof cfg.cartoKey === 'string') return cfg.cartoKey.trim();
    console.warn('[carto] config.json no contiene "cartoKey"; se usa la modalidad pública.');
  } catch (err) {
    console.warn(`[carto] no se pudo leer config.json (${err.message}); se usa la modalidad pública.`);
  }
  return '';
}

const CARTO_KEY = leerClaveCarto();

/* ------------------------------------------------------------------ *
 * Catálogo de carburantes
 * `campo` es la clave exacta que usa el dataset oficial en cada registro.
 * ------------------------------------------------------------------ */
const PRODUCTOS = [
  { key: 'GOA',    campo: 'Precio Gasoleo A',                  nombre: 'Gasóleo A',            abrev: 'Diésel',        grupo: 'gasoleo',  principal: true,  orden: 1 },
  { key: 'G95E5',  campo: 'Precio Gasolina 95 E5',              nombre: 'Gasolina 95 E5',       abrev: 'Gasolina 95',  grupo: 'gasolina', principal: true,  orden: 2 },
  { key: 'G98E5',  campo: 'Precio Gasolina 98 E5',              nombre: 'Gasolina 98 E5',       abrev: 'Gasolina 98',  grupo: 'gasolina', principal: true,  orden: 3 },
  { key: 'GOA+',   campo: 'Precio Gasoleo Premium',             nombre: 'Gasóleo Premium',      abrev: 'Diésel Premium', grupo: 'gasoleo', principal: true,  orden: 4 },
  { key: 'GLP',    campo: 'Precio Gases licuados del petróleo',  nombre: 'Gases licuados (GLP)', abrev: 'GLP',          grupo: 'otros',    principal: true,  orden: 5 },
  { key: 'G95E10', campo: 'Precio Gasolina 95 E10',             nombre: 'Gasolina 95 E10',      abrev: 'Gasolina 95 E10', grupo: 'gasolina', principal: false, orden: 6 },
  { key: 'G95E5+', campo: 'Precio Gasolina 95 E5 Premium',      nombre: 'Gasolina 95 E5 Premium', abrev: 'Gasolina 95 Premium', grupo: 'gasolina', principal: false, orden: 7 },
  { key: 'G98E10', campo: 'Precio Gasolina 98 E10',             nombre: 'Gasolina 98 E10',      abrev: 'Gasolina 98 E10', grupo: 'gasolina', principal: false, orden: 8 },
  { key: 'G95E25', campo: 'Precio Gasolina 95 E25',             nombre: 'Gasolina 95 E25',      abrev: 'Gasolina 95 E25', grupo: 'gasolina', principal: false, orden: 9 },
  { key: 'G95E85', campo: 'Precio Gasolina 95 E85',             nombre: 'Gasolina 95 E85',      abrev: 'Gasolina 95 E85', grupo: 'gasolina', principal: false, orden: 10 },
  { key: 'DREN',   campo: 'Precio Diésel Renovable',            nombre: 'Diésel renovable',     abrev: 'Diésel renovable', grupo: 'gasoleo', principal: false, orden: 11 },
  { key: 'GREN',   campo: 'Precio Gasolina Renovable',          nombre: 'Gasolina renovable',   abrev: 'Gasolina renovable', grupo: 'gasolina', principal: false, orden: 12 },
  { key: 'GOB',    campo: 'Precio Gasoleo B',                   nombre: 'Gasóleo B',            abrev: 'Diésel B',      grupo: 'gasoleo',  principal: false, orden: 13 },
  { key: 'GOC',    campo: 'Precio Gasoleo C',                   nombre: 'Gasóleo C',            abrev: 'Diésel C',      grupo: 'gasoleo',  principal: false, orden: 14 },
  { key: 'BIO',    campo: 'Precio Biodiesel',                    nombre: 'Biodiésel',            abrev: 'Biodiésel',    grupo: 'otros',    principal: false, orden: 15 },
  { key: 'BIE',    campo: 'Precio Bioetanol',                    nombre: 'Bioetanol',            abrev: 'Bioetanol',    grupo: 'otros',    principal: false, orden: 16 },
  { key: 'GNC',    campo: 'Precio Gas Natural Comprimido',      nombre: 'Gas natural comprimido', abrev: 'GNC',         grupo: 'otros',    principal: false, orden: 17 },
  { key: 'GNL',    campo: 'Precio Gas Natural Licuado',          nombre: 'Gas natural licuado',  abrev: 'GNL',          grupo: 'otros',    principal: false, orden: 18 },
  { key: 'BGNC',   campo: 'Precio Biogas Natural Comprimido',   nombre: 'Biogás comprimido',    abrev: 'Biogás CNC',   grupo: 'otros',    principal: false, orden: 19 },
  { key: 'BGNL',   campo: 'Precio Biogas Natural Licuado',       nombre: 'Biogás licuado',       abrev: 'Biogás GNL',   grupo: 'otros',    principal: false, orden: 20 },
  { key: 'ADB',    campo: 'Precio Adblue',                      nombre: 'AdBlue',               abrev: 'AdBlue',       grupo: 'otros',    principal: false, orden: 21 },
  { key: 'H2',     campo: 'Precio Hidrogeno',                   nombre: 'Hidrógeno',            abrev: 'H2',           grupo: 'otros',    principal: false, orden: 22 },
  { key: 'MET',    campo: 'Precio Metanol',                     nombre: 'Metanol',              abrev: 'Metanol',      grupo: 'otros',    principal: false, orden: 23 },
  { key: 'AMO',    campo: 'Precio Amoniaco',                    nombre: 'Amoniaco',             abrev: 'Amoniaco',     grupo: 'otros',    principal: false, orden: 24 },
];

const PRODUCTO_POR_CAMPO = new Map(PRODUCTOS.map((p) => [p.campo, p]));

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */
function aNumero(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number.parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function limpiarCp(cp) {
  return String(cp || '').trim().replace(/\s+/g, '');
}

/* ------------------------------------------------------------------ *
 * Caché del dataset oficial
 * ------------------------------------------------------------------ */
const cache = { fecha: null, estaciones: null, cargadoAt: 0, cargando: null, error: null };

function normalizar(bruto, i) {
  const lat = aNumero(bruto['Latitud']);
  const lon = aNumero(bruto['Longitud (WGS84)']);
  if (lat === null || lon === null) return null;

  const precios = {};
  for (const [campo, prod] of PRODUCTO_POR_CAMPO) {
    const v = aNumero(bruto[campo]);
    if (v !== null) precios[prod.key] = v;
  }

  return {
    id: bruto.IDEESS || `e${i}`,
    rotulo: (bruto['Rótulo'] || 'Sin nombre').trim(),
    direccion: (bruto['Dirección'] || '').trim(),
    localidad: (bruto['Localidad'] || '').trim(),
    municipio: (bruto['Municipio'] || '').trim(),
    provincia: (bruto['Provincia'] || '').trim(),
    cp: (bruto['C.P.'] || '').trim(),
    idProvincia: (bruto['IDProvincia'] || '').trim(),
    lat,
    lon,
    margen: (bruto['Margen'] || '').trim(),
    horario: (bruto['Horario'] || '').trim(),
    tipoVenta: (bruto['Tipo Venta'] || '').trim(),
    tipo: (bruto['Remisión'] || '').trim(),
    precios,
  };
}

let ultimoFallo = 0;

/**
 * Devuelve el dataset. Con datos caducados se responden al momento y se
 * refresca en segundo plano: nadie espera al Ministerio si hay algo que
 * enseñar. Tras un fallo no se reintenta hasta pasado REINTENTO_MS.
 */
async function cargarDataset(forzar = false) {
  const vigente = cache.estaciones && Date.now() - cache.cargadoAt < CACHE_TTL_MS;
  if (!forzar && vigente) return cache;

  const enEspera = Date.now() - ultimoFallo < REINTENTO_MS;
  if (!cache.cargando && (forzar || !enEspera)) cache.cargando = descargarDataset();

  if (!forzar && cache.estaciones) return cache;
  if (cache.cargando) return cache.cargando;
  throw new Error(`El Ministerio no responde (${cache.error || 'sin datos'})`);
}

/** Descarga el dataset. La promesa compartida nunca rechaza si hay caché anterior. */
async function descargarDataset() {
  // Cede el turno: así `cache.cargando` ya está asignado cuando corre el `finally`.
  await null;
  try {
    const r = await fetch(`${MINETUR}/EstacionesTerrestres/`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MINETUR_MS),
    });
    if (!r.ok) throw new Error(`El Ministerio respondió ${r.status}`);
    const j = await r.json();
    const lista = j['ListaEESSPrecio'] || [];
    const estaciones = [];
    for (let i = 0; i < lista.length; i++) {
      const e = normalizar(lista[i], i);
      if (e) estaciones.push(e);
    }
    cache.fecha = j['Fecha'] || null;
    cache.estaciones = estaciones;
    cache.cargadoAt = Date.now();
    cache.error = null;
    ultimoFallo = 0;
    console.log(`[dataset] ${estaciones.length} estaciones cargadas · fecha oficial: ${cache.fecha}`);
    return cache;
  } catch (err) {
    cache.error = err.message;
    ultimoFallo = Date.now();
    // Si ya había datos se siguen sirviendo: es mejor un precio de hace una
    // hora que un error. Se reintenta pasado REINTENTO_MS.
    if (cache.estaciones) {
      console.warn(`[dataset] no se pudo refrescar (${err.message}); se mantiene la caché anterior`);
      return cache;
    }
    throw err;
  } finally {
    cache.cargando = null;
  }
}

/* ------------------------------------------------------------------ *
 * Geocodificador de códigos postales (Nominatim) con caché y límite de ritmo
 * ------------------------------------------------------------------ */
const geoCache = new Map();
let geoCola = Promise.resolve();
let geoEnCola = 0;
let geoUltimaLlamada = 0;

/**
 * Las llamadas a Nominatim se encadenan para respetar su límite aunque lleguen
 * a la vez. La cola es limitada: si se llena, quien llama cae a la
 * aproximación por provincia en lugar de esperar minutos.
 */
function geocodificar(clave, consulta) {
  if (geoCache.has(clave)) return Promise.resolve(geoCache.get(clave));
  if (geoEnCola >= GEO_COLA_MAX) return Promise.reject(new Error('cola del geocodificador llena'));
  geoEnCola++;
  const turno = geoCola.then(() => consultarNominatim(clave, consulta)).finally(() => { geoEnCola--; });
  geoCola = turno.catch(() => {});
  return turno;
}

const geocodificarCp = (cp) =>
  geocodificar(`cp:${cp}`, `postalcode=${encodeURIComponent(cp)}&country=Spain`);

const geocodificarTexto = (texto) =>
  geocodificar(`q:${texto.toLowerCase()}`, `q=${encodeURIComponent(texto)}&countrycodes=es`);

/** Caché acotada: con búsquedas de texto libre podría crecer sin límite. */
function guardarGeo(clave, valor) {
  if (geoCache.size >= GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(clave, valor);
}

async function consultarNominatim(clave, consulta) {
  if (geoCache.has(clave)) return geoCache.get(clave);
  const espera = GEO_INTERVALO_MS - (Date.now() - geoUltimaLlamada);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  geoUltimaLlamada = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?${consulta}&format=jsonv2&limit=1&addressdetails=0`;
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_GEO_MS),
  });
  if (!r.ok) throw new Error(`El geocodificador respondió ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j) || j.length === 0) {
    guardarGeo(clave, null); // un lugar inexistente no se vuelve a consultar
    return null;
  }

  const res = {
    lat: Number.parseFloat(j[0].lat),
    lon: Number.parseFloat(j[0].lon),
    nombre: j[0].display_name || clave,
  };
  guardarGeo(clave, res);
  return res;
}

/* ------------------------------------------------------------------ *
 * Rutas (OSRM)
 * ------------------------------------------------------------------ */

/** Error con mensaje para el usuario y código HTTP propio. */
class ErrorUsuario extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

const RE_COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Origen o destino: "lat,lon" (ubicación del usuario), código postal o texto libre. */
async function resolverLugar(texto, estaciones, papel) {
  const t = String(texto || '').trim();
  if (t.length < 2 || t.length > LUGAR_MAX_CHARS) {
    throw new ErrorUsuario(400, `Indica un ${papel} válido (entre 2 y ${LUGAR_MAX_CHARS} caracteres).`);
  }

  const c = RE_COORDS.exec(t);
  if (c) {
    const lat = Number(c[1]);
    const lon = Number(c[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ErrorUsuario(400, `Coordenadas de ${papel} no válidas.`);
    return { lat, lon, nombre: 'Tu ubicación' };
  }

  let lugar = null;
  if (/^\d{5}$/.test(t)) {
    lugar = centroDesdeCp(estaciones, t);
    if (!lugar) {
      lugar = await geocodificarCp(t).catch((err) => {
        console.warn('[geo] Nominatim falló:', err.message);
        throw new ErrorUsuario(503, 'El buscador de direcciones no responde. Inténtalo de nuevo en unos minutos.');
      });
    }
  } else {
    lugar = await geocodificarTexto(t).catch((err) => {
      console.warn('[geo] Nominatim falló:', err.message);
      throw new ErrorUsuario(503, 'El buscador de direcciones no responde. Prueba con un código postal.');
    });
  }
  if (!lugar) throw new ErrorUsuario(404, `No se ha encontrado el ${papel} «${t}».`);
  return { lat: lugar.lat, lon: lugar.lon, nombre: lugar.nombre };
}

const rutaCache = new Map();
const rutasEnCurso = new Map();

/** Una sola llamada a OSRM por trayecto aunque lleguen varias peticiones iguales a la vez. */
function calcularRuta(origen, destino) {
  const clave = [origen.lat, origen.lon, destino.lat, destino.lon].map((n) => n.toFixed(4)).join(',');
  if (rutaCache.has(clave)) return Promise.resolve(rutaCache.get(clave));
  if (!rutasEnCurso.has(clave)) {
    rutasEnCurso.set(clave, pedirRutaOsrm(origen, destino, clave).finally(() => rutasEnCurso.delete(clave)));
  }
  return rutasEnCurso.get(clave);
}

async function pedirRutaOsrm(origen, destino, clave) {
  const puntos = `${origen.lon},${origen.lat};${destino.lon},${destino.lat}`;
  let r;
  try {
    r = await fetch(`${OSRM}/route/v1/driving/${puntos}?overview=full&geometries=geojson`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_RUTA_MS),
    });
  } catch {
    throw new ErrorUsuario(503, 'El servicio de rutas no responde. Inténtalo de nuevo en unos minutos.');
  }
  const j = await r.json().catch(() => null);
  if (!j) throw new ErrorUsuario(503, 'El servicio de rutas ha devuelto una respuesta no válida.');
  if (j.code === 'NoRoute' || (j.routes && !j.routes.length)) {
    throw new ErrorUsuario(404, 'No hay una ruta por carretera entre esos dos puntos.');
  }
  if (!r.ok || j.code !== 'Ok') throw new ErrorUsuario(503, 'El servicio de rutas no ha podido calcular el trayecto.');

  const ruta = {
    coords: j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distanciaKm: Math.round(j.routes[0].distance / 100) / 10,
    duracionMin: Math.round(j.routes[0].duration / 60),
  };
  if (rutaCache.size >= RUTA_CACHE_MAX) rutaCache.delete(rutaCache.keys().next().value);
  rutaCache.set(clave, ruta);
  return ruta;
}

/* ------------------------------------------------------------------ *
 * Búsquedas
 * ------------------------------------------------------------------ */
function buscarPorProximidad(estaciones, lat, lon, radioKm) {
  const encontradas = [];
  for (const e of estaciones) {
    const d = haversine(lat, lon, e.lat, e.lon);
    if (d <= radioKm) {
      encontradas.push({ ...e, distancia: Math.round(d * 100) / 100 });
    }
  }
  encontradas.sort((a, b) => a.distancia - b.distancia);
  return encontradas.slice(0, MAX_RESULTADOS);
}

/** Centro aproximado a partir de las propias estaciones de ese código postal. */
function centroDesdeCp(estaciones, cp) {
  const coincidentes = estaciones.filter((e) => e.cp === cp);
  if (!coincidentes.length) return null;
  const lat = coincidentes.reduce((s, e) => s + e.lat, 0) / coincidentes.length;
  const lon = coincidentes.reduce((s, e) => s + e.lon, 0) / coincidentes.length;
  return {
    lat,
    lon,
    nombre: coincidentes[0].municipio || coincidentes[0].localidad || cp,
    fuente: `datos oficiales (${coincidentes.length} estaciones en el CP)`,
  };
}

/** Último recurso: centro aproximado de la provincia a la que pertenece el CP. */
function centroDesdeProvincia(estaciones, cp) {
  const prefijo = cp.slice(0, 2);
  const deProvincia = estaciones.filter((e) => e.idProvincia === prefijo);
  const base = deProvincia.length ? deProvincia : estaciones.filter((e) => e.cp.startsWith(prefijo));
  if (!base.length) return null;
  const lat = base.reduce((s, e) => s + e.lat, 0) / base.length;
  const lon = base.reduce((s, e) => s + e.lon, 0) / base.length;
  return { lat, lon, nombre: `Provincia del CP ${cp}`, fuente: 'aproximación por provincia' };
}

/* ------------------------------------------------------------------ *
 * Respuestas HTTP
 * ------------------------------------------------------------------ */
const CABECERAS_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
};

// Leaflet y MapLibre necesitan estilos en línea, imágenes de teselas externas
// y un worker creado desde un blob.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com https://*.basemaps.cartocdn.com",
  "connect-src 'self' https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com",
  "worker-src 'self' blob:",
  "child-src blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

const MIN_BYTES_GZIP = 1024;

function aceptaGzip(req) {
  return /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
}

function enviar(req, res, codigo, cuerpo, cabeceras) {
  const buf = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
  const comprimir = buf.length >= MIN_BYTES_GZIP && aceptaGzip(req);
  const final = comprimir ? zlib.gzipSync(buf) : buf;
  res.writeHead(codigo, {
    ...CABECERAS_SEGURIDAD,
    ...cabeceras,
    ...(comprimir ? { 'Content-Encoding': 'gzip' } : {}),
    Vary: 'Accept-Encoding',
    'Content-Length': final.length,
  });
  res.end(req.method === 'HEAD' ? undefined : final);
}

function responder(req, res, codigo, cuerpo) {
  enviar(req, res, codigo, JSON.stringify(cuerpo), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
function leerRadio(url) {
  const pedido = Number.parseFloat(url.searchParams.get('radio'));
  return Math.min(RADIO_MAX_KM, Math.max(1, Number.isFinite(pedido) ? pedido : 10));
}

function metadatos(data) {
  return {
    fecha: data.fecha,
    actualizado: new Date(data.cargadoAt).toISOString(),
    // El cliente avisa si los precios vienen de una caché que no se pudo refrescar.
    desactualizado: Boolean(cache.error),
  };
}

async function apiEstaciones(req, res, url) {
  const lat = Number.parseFloat(url.searchParams.get('lat'));
  const lon = Number.parseFloat(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return responder(req, res, 400, { ok: false, error: 'Parámetros lat/lon no válidos' });
  }
  const radio = leerRadio(url);
  const data = await cargarDataset();
  const estaciones = buscarPorProximidad(data.estaciones, lat, lon, radio);
  responder(req, res, 200, {
    ok: true,
    ...metadatos(data),
    total: estaciones.length,
    centro: { lat, lon },
    radio,
    estaciones,
  });
}

async function apiPostal(req, res, url, cp) {
  const radio = leerRadio(url);
  const data = await cargarDataset();

  let centro = centroDesdeCp(data.estaciones, cp);
  if (!centro) {
    try {
      const geo = await geocodificarCp(cp);
      if (geo) centro = { lat: geo.lat, lon: geo.lon, nombre: geo.nombre, fuente: 'geocodificación' };
    } catch (err) {
      console.warn('[geo] Nominatim falló:', err.message);
    }
  }
  if (!centro) centro = centroDesdeProvincia(data.estaciones, cp);
  if (!centro) {
    return responder(req, res, 404, { ok: false, error: `No se ha podido localizar el código postal ${cp}` });
  }

  const estaciones = buscarPorProximidad(data.estaciones, centro.lat, centro.lon, radio);
  responder(req, res, 200, {
    ok: true,
    ...metadatos(data),
    total: estaciones.length,
    centro: { lat: centro.lat, lon: centro.lon },
    nombre: centro.nombre,
    fuente: centro.fuente,
    cp,
    radio,
    estaciones,
  });
}

async function apiRuta(req, res, url) {
  const pedido = Number(url.searchParams.get('desvio'));
  const desvio = DESVIOS_KM.includes(pedido) ? pedido : DESVIO_DEFECTO_KM;
  const data = await cargarDataset();

  const origen = await resolverLugar(url.searchParams.get('origen'), data.estaciones, 'origen');
  const destino = await resolverLugar(url.searchParams.get('destino'), data.estaciones, 'destino');
  if (haversine(origen.lat, origen.lon, destino.lat, destino.lon) < 0.2) {
    throw new ErrorUsuario(400, 'El origen y el destino son el mismo lugar.');
  }

  const ruta = await calcularRuta(origen, destino);
  const enRuta = estacionesEnRuta(data.estaciones, ruta.coords, desvio, ruta.distanciaKm);
  // El tope sólo se alcanza en rutas muy largas con mucho desvío; si se recorta, se avisa.
  const truncado = enRuta.length > MAX_RESULTADOS_RUTA;
  const estaciones = enRuta
    .slice(0, MAX_RESULTADOS_RUTA)
    // `distancia` es lo que el cliente usa para ordenar "por cercanía": aquí, el desvío.
    .map((e) => ({ ...e, distancia: e.desvio }));

  responder(req, res, 200, {
    ok: true,
    ...metadatos(data),
    origen,
    destino,
    ruta: {
      distanciaKm: ruta.distanciaKm,
      duracionMin: ruta.duracionMin,
      coords: simplificar(ruta.coords).map(([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)]),
    },
    desvio,
    total: estaciones.length,
    truncado,
    estaciones,
  });
}

/* Límite de peticiones por IP para /api/ruta: cada una puede gastar una
   llamada a OSRM y dos a Nominatim, servicios públicos de uso moderado. */
const contadoresRuta = new Map();

function ipCliente(req) {
  // Detrás de un proxy (Render) la IP real llega en X-Forwarded-For.
  const reenviada = TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || req.socket.remoteAddress || 'desconocida';
}

function superaLimiteRuta(req) {
  const ahora = Date.now();
  if (contadoresRuta.size > 5000) {
    for (const [ip, c] of contadoresRuta) if (ahora - c.inicio > 60 * 1000) contadoresRuta.delete(ip);
  }
  const ip = ipCliente(req);
  const c = contadoresRuta.get(ip);
  if (!c || ahora - c.inicio > 60 * 1000) {
    contadoresRuta.set(ip, { inicio: ahora, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > RUTAS_POR_MINUTO;
}

function apiEstado(req, res) {
  const data = cache.estaciones ? cache : null;
  responder(req, res, 200, {
    ok: true,
    fecha: data ? data.fecha : null,
    actualizado: data ? new Date(data.cargadoAt).toISOString() : null,
    estaciones: data ? data.estaciones.length : 0,
    cargando: Boolean(cache.cargando),
    error: cache.error,
    carto: { clave: CARTO_KEY || null },
  });
}

let ultimoRefresco = 0;

async function apiRefrescar(req, res) {
  const espera = REFRESCO_MIN_MS - (Date.now() - ultimoRefresco);
  if (espera > 0) {
    res.setHeader('Retry-After', Math.ceil(espera / 1000));
    return responder(req, res, 429, { ok: false, error: 'Se acaba de refrescar; espera un par de minutos.' });
  }
  ultimoRefresco = Date.now();
  const data = await cargarDataset(true);
  responder(req, res, 200, { ok: true, fecha: data.fecha, estaciones: data.estaciones.length, error: cache.error });
}

/* ------------------------------------------------------------------ *
 * Servidor de ficheros estáticos
 * ------------------------------------------------------------------ */
const PUBLICO = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const COMPRIMIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest']);

// Los ficheros (ya comprimidos) se guardan en memoria mientras no cambien en disco.
const cacheEstaticos = new Map();

function leerEstatico(destino) {
  const st = fs.statSync(destino);
  if (!st.isFile()) return null;
  const previo = cacheEstaticos.get(destino);
  if (previo && previo.mtimeMs === st.mtimeMs && previo.size === st.size) return previo;
  const buf = fs.readFileSync(destino);
  const ext = path.extname(destino).toLowerCase();
  const entrada = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    buf,
    gz: COMPRIMIBLE.has(ext) && buf.length >= MIN_BYTES_GZIP ? zlib.gzipSync(buf, { level: 9 }) : null,
    etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
    tipo: MIME[ext] || 'application/octet-stream',
  };
  cacheEstaticos.set(destino, entrada);
  return entrada;
}

function servirEstatico(req, res, pathname) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400, CABECERAS_SEGURIDAD).end('Petición no válida');
    return;
  }
  const destino = path.resolve(PUBLICO, rel);
  if (destino !== PUBLICO && !destino.startsWith(PUBLICO + path.sep)) {
    res.writeHead(403, CABECERAS_SEGURIDAD).end('Prohibido');
    return;
  }

  let fichero = null;
  try {
    fichero = leerEstatico(destino);
  } catch {
    fichero = null;
  }
  if (!fichero) {
    res.writeHead(404, { ...CABECERAS_SEGURIDAD, 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    return;
  }

  const cabeceras = {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': fichero.tipo,
    ETag: fichero.etag,
    // Las librerías vendorizadas no cambian; el código propio se revalida siempre.
    'Cache-Control': rel.startsWith('vendor/') ? 'public, max-age=604800' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  if (fichero.tipo.startsWith('text/html')) cabeceras['Content-Security-Policy'] = CSP;

  if (req.headers['if-none-match'] === fichero.etag) {
    res.writeHead(304, cabeceras).end();
    return;
  }
  const usarGz = fichero.gz && aceptaGzip(req);
  const cuerpo = usarGz ? fichero.gz : fichero.buf;
  if (usarGz) cabeceras['Content-Encoding'] = 'gzip';
  cabeceras['Content-Length'] = cuerpo.length;
  res.writeHead(200, cabeceras);
  res.end(req.method === 'HEAD' ? undefined : cuerpo);
}

/* ------------------------------------------------------------------ *
 * Enrutador
 * ------------------------------------------------------------------ */
async function enrutar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return responder(req, res, 405, { ok: false, error: 'Método no permitido' });
  }

  if (p === '/api/estaciones') return apiEstaciones(req, res, url);

  if (p.startsWith('/api/postal/')) {
    let cp = '';
    try {
      cp = limpiarCp(decodeURIComponent(p.slice('/api/postal/'.length)));
    } catch {
      cp = '';
    }
    if (!/^\d{5}$/.test(cp)) {
      return responder(req, res, 400, { ok: false, error: 'El código postal debe tener 5 dígitos' });
    }
    return apiPostal(req, res, url, cp);
  }

  if (p === '/api/ruta') {
    if (superaLimiteRuta(req)) {
      res.setHeader('Retry-After', '60');
      return responder(req, res, 429, { ok: false, error: 'Demasiadas búsquedas de ruta seguidas. Espera un minuto.' });
    }
    return apiRuta(req, res, url);
  }
  if (p === '/api/productos') return responder(req, res, 200, { ok: true, productos: PRODUCTOS });
  if (p === '/api/estado') return apiEstado(req, res);
  if (p === '/api/refrescar') return apiRefrescar(req, res);
  if (p.startsWith('/api/')) return responder(req, res, 404, { ok: false, error: 'Endpoint no encontrado' });

  return servirEstatico(req, res, p);
}

/** El Ministerio caído o lento se distingue de un fallo propio. */
function esFalloDelMinisterio(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.name === 'SyntaxError') return true;
  return /Ministerio|fetch failed/i.test(String(err.message));
}

function crearServidor() {
  return http.createServer(async (req, res) => {
    try {
      await enrutar(req, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof ErrorUsuario) return responder(req, res, err.estado, { ok: false, error: err.message });
      console.error('[error]', err);
      // No se filtran detalles internos: sólo un mensaje comprensible.
      const caido = esFalloDelMinisterio(err);
      responder(req, res, caido ? 503 : 500, {
        ok: false,
        error: caido
          ? 'No se pueden obtener los precios del Ministerio en este momento. Inténtalo de nuevo en unos minutos.'
          : 'Error interno del servidor',
      });
    }
  });
}

if (require.main === module) {
  crearServidor().listen(PORT, HOST, () => {
    console.log(`\n  ⛽  iGasofa escuchando en http://${HOST}:${PORT}`);
    console.log(`      Descargando precios oficiales del Ministerio…`);
    console.log(
      `      Capas Carto: ${CARTO_KEY ? `clave propia (${CARTO_KEY.slice(0, 6)}…)` : 'modalidad pública (sin clave)'}\n`
    );
    cargarDataset().catch((err) => console.error('[dataset] error inicial:', err.message));
  });
}

module.exports = {
  PRODUCTOS,
  OSRM,
  aNumero,
  haversine,
  limpiarCp,
  normalizar,
  buscarPorProximidad,
  centroDesdeCp,
  centroDesdeProvincia,
  cache,
  cargarDataset,
  crearServidor,
};
