'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const srv = require('../server.js');

/* Registros con la forma del dataset oficial (valores sintéticos). */
const BRUTOS = [
  { IDEESS: '1', 'Rótulo': 'ALFA', 'Latitud': '43,0700', 'Longitud (WGS84)': '-2,4900', 'C.P.': '20560', 'Municipio': 'Oñati', 'IDProvincia': '20', 'Precio Gasoleo A': '1,559', 'Precio Gasolina 95 E5': '1,629', 'Horario': 'L-D: 24H' },
  { IDEESS: '2', 'Rótulo': 'BETA', 'Latitud': '43,0750', 'Longitud (WGS84)': '-2,4950', 'C.P.': '20560', 'Municipio': 'Oñati', 'IDProvincia': '20', 'Precio Gasoleo A': '1,499', 'Horario': 'L-V: 07:00-22:00' },
  { IDEESS: '3', 'Rótulo': 'GAMMA', 'Latitud': '43,3200', 'Longitud (WGS84)': '-1,9800', 'C.P.': '20001', 'Municipio': 'Donostia', 'IDProvincia': '20', 'Precio Gasoleo A': '1,609' },
  { IDEESS: '4', 'Rótulo': 'SIN COORDENADAS', 'Latitud': '', 'Longitud (WGS84)': '', 'C.P.': '20560' },
];

function prepararCache() {
  const estaciones = BRUTOS.map(srv.normalizar).filter(Boolean);
  Object.assign(srv.cache, { fecha: '22/10/2026 08:00:00', estaciones, cargadoAt: Date.now(), cargando: null, error: null });
}

/** GET de bajo nivel: fetch descomprime solo y no deja ver el gzip. */
function pedirCrudo(url, cabeceras = {}) {
  return new Promise((ok, ko) => {
    http.get(url, { headers: cabeceras }, (res) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => ok({ res, cuerpo: Buffer.concat(trozos) }));
    }).on('error', ko);
  });
}

let base = '';
let servidor = null;

test.before(async () => {
  prepararCache();
  servidor = srv.crearServidor();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => new Promise((r) => servidor.close(r)));

/* --- Utilidades puras ------------------------------------------------ */

test('aNumero convierte la coma decimal y descarta vacíos', () => {
  assert.equal(srv.aNumero('1,559'), 1.559);
  assert.equal(srv.aNumero(''), null);
  assert.equal(srv.aNumero(null), null);
  assert.equal(srv.aNumero('abc'), null);
});

test('haversine da 0 en el mismo punto y ~504 km entre Madrid y Barcelona', () => {
  assert.equal(srv.haversine(40, -3, 40, -3), 0);
  const d = srv.haversine(40.4168, -3.7038, 41.3874, 2.1686);
  assert.ok(d > 495 && d < 510, `distancia ${d}`);
});

test('normalizar descarta registros sin coordenadas y sólo guarda precios publicados', () => {
  assert.equal(srv.normalizar(BRUTOS[3], 3), null);
  const e = srv.normalizar(BRUTOS[1], 1);
  assert.deepEqual(e.precios, { GOA: 1.499 });
  assert.equal(e.horario, 'L-V: 07:00-22:00');
});

test('buscarPorProximidad filtra por radio y ordena por distancia', () => {
  const r = srv.buscarPorProximidad(srv.cache.estaciones, 43.07, -2.49, 5);
  assert.deepEqual(r.map((e) => e.id), ['1', '2']);
  assert.ok(r[0].distancia <= r[1].distancia);
});

test('centroDesdeCp promedia las estaciones de ese código postal', () => {
  const c = srv.centroDesdeCp(srv.cache.estaciones, '20560');
  assert.ok(Math.abs(c.lat - 43.0725) < 1e-9);
  assert.equal(srv.centroDesdeCp(srv.cache.estaciones, '99999'), null);
});

/* --- Caché del dataset ------------------------------------------------ */

test('si el Ministerio falla se mantiene la caché anterior y se puede reintentar', async () => {
  const fetchReal = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error('fetch failed'); };
  try {
    const previas = srv.cache.estaciones;
    const r = await srv.cargarDataset(true);
    assert.equal(r.estaciones, previas);
    assert.equal(srv.cache.error, 'fetch failed');
    assert.equal(srv.cache.cargando, null, 'la promesa en curso debe limpiarse');
    await srv.cargarDataset(true);
    assert.equal(llamadas, 2, 'el segundo intento debe volver a descargar');
  } finally {
    globalThis.fetch = fetchReal;
    srv.cache.error = null;
  }
});

test('tras una carga correcta la caché caducada vuelve a descargarse', async () => {
  const fetchReal = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    return { ok: true, json: async () => ({ Fecha: `f${llamadas}`, ListaEESSPrecio: BRUTOS }) };
  };
  try {
    await srv.cargarDataset(true);
    srv.cache.cargadoAt = 0; // caducada
    const r = await srv.cargarDataset();
    assert.equal(r.fecha, 'f1', 'con datos caducados se responde al momento');
    await srv.cache.cargando; // refresco en segundo plano
    assert.equal(llamadas, 2);
    assert.equal(srv.cache.fecha, 'f2');
  } finally {
    globalThis.fetch = fetchReal;
    prepararCache();
  }
});

test('con el Ministerio colgado las peticiones simultáneas reciben la caché sin esperar', async () => {
  const fetchReal = globalThis.fetch;
  let soltar;
  let llamadas = 0;
  globalThis.fetch = () => { llamadas++; return new Promise((_, ko) => { soltar = () => ko(new Error('fetch failed')); }); };
  try {
    srv.cache.cargadoAt = 0;
    const [a, b] = await Promise.all([srv.cargarDataset(), srv.cargarDataset()]);
    assert.equal(a.estaciones.length, 3);
    assert.equal(b.estaciones.length, 3);
    assert.equal(llamadas, 1, 'una sola descarga compartida');
    soltar();
    await srv.cache.cargando;
    await srv.cargarDataset();
    assert.equal(llamadas, 1, 'tras un fallo no se reintenta enseguida');
  } finally {
    globalThis.fetch = fetchReal;
    prepararCache();
  }
});

/* --- API -------------------------------------------------------------- */

test('GET /api/estaciones devuelve las cercanas con metadatos', async () => {
  const r = await fetch(`${base}/api/estaciones?lat=43.07&lon=-2.49&radio=5`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.total, 2);
  assert.equal(j.fecha, '22/10/2026 08:00:00');
  assert.equal(j.desactualizado, false);
});

test('GET /api/estaciones rechaza coordenadas fuera de rango', async () => {
  const r = await fetch(`${base}/api/estaciones?lat=200&lon=0`);
  assert.equal(r.status, 400);
});

test('el radio se limita a 50 km', async () => {
  const j = await (await fetch(`${base}/api/estaciones?lat=43.07&lon=-2.49&radio=900`)).json();
  assert.equal(j.radio, 50);
});

test('GET /api/postal/:cp resuelve el CP con las estaciones oficiales', async () => {
  const j = await (await fetch(`${base}/api/postal/20560?radio=5`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.cp, '20560');
  assert.equal(j.nombre, 'Oñati');
  assert.equal(j.total, 2);
});

test('GET /api/postal rechaza códigos postales mal formados', async () => {
  assert.equal((await fetch(`${base}/api/postal/12ab`)).status, 400);
  assert.equal((await fetch(`${base}/api/postal/%E0%A4%A`)).status, 400);
});

/** Sustituye sólo las llamadas a OSRM; el resto (las del propio test) siguen siendo reales. */
async function conOsrmSimulado(respuesta, prueba) {
  const fetchReal = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, op) => {
    if (!String(url).startsWith(srv.OSRM)) return fetchReal(url, op);
    llamadas.push(String(url));
    return { ok: true, json: async () => respuesta };
  };
  try {
    await prueba(llamadas);
  } finally {
    globalThis.fetch = fetchReal;
  }
}

const RUTA_OSRM = {
  code: 'Ok',
  routes: [{ distance: 45200, duration: 2700, geometry: { coordinates: [[-2.49, 43.07], [-2.2, 43.2], [-1.98, 43.32]] } }],
};

test('GET /api/ruta devuelve las gasolineras del trayecto ordenadas por kilómetro', async () => {
  await conOsrmSimulado(RUTA_OSRM, async (llamadas) => {
    const j = await (await fetch(`${base}/api/ruta?origen=43.07,-2.49&destino=20001&desvio=2`)).json();
    assert.equal(j.ok, true);
    assert.equal(j.origen.nombre, 'Tu ubicación');
    assert.equal(j.destino.nombre, 'Donostia');
    assert.equal(j.ruta.distanciaKm, 45.2);
    assert.equal(j.ruta.duracionMin, 45);
    assert.deepEqual(j.estaciones.map((e) => e.id), ['1', '2', '3']);
    assert.ok(j.estaciones.every((e, i, a) => i === 0 || a[i - 1].kmRuta <= e.kmRuta));
    assert.equal(j.estaciones[0].distancia, j.estaciones[0].desvio);
    assert.equal(llamadas.length, 1);
  });
});

test('GET /api/ruta valida el desvío y rechaza origen igual a destino', async () => {
  await conOsrmSimulado(RUTA_OSRM, async () => {
    const j = await (await fetch(`${base}/api/ruta?origen=43.07,-2.49&destino=20001&desvio=99`)).json();
    assert.equal(j.desvio, 2);
    const r = await fetch(`${base}/api/ruta?origen=20560&destino=20560`);
    assert.equal(r.status, 400);
  });
});

test('GET /api/ruta informa de que no hay ruta por carretera', async () => {
  await conOsrmSimulado({ code: 'NoRoute', routes: [] }, async () => {
    const r = await fetch(`${base}/api/ruta?origen=43.0,-2.0&destino=20001`);
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /No hay una ruta/);
  });
});

test('GET /api/ruta exige origen y destino', async () => {
  const r = await fetch(`${base}/api/ruta?origen=x`);
  assert.equal(r.status, 400);
});

test('los métodos distintos de GET/HEAD se rechazan', async () => {
  const r = await fetch(`${base}/api/estado`, { method: 'POST' });
  assert.equal(r.status, 405);
});

test('/api/estado informa de la caché sin quedarse "cargando"', async () => {
  const j = await (await fetch(`${base}/api/estado`)).json();
  assert.equal(j.estaciones, 3);
  assert.equal(j.cargando, false);
});

test('endpoint inexistente devuelve 404 JSON', async () => {
  const r = await fetch(`${base}/api/nada`);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).ok, false);
});

/* --- Estáticos -------------------------------------------------------- */

test('sirve index.html con CSP y cabeceras de seguridad', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('comprime con gzip y responde 304 si el ETag coincide', async () => {
  const { res, cuerpo } = await pedirCrudo(`${base}/js/app.js`, { 'Accept-Encoding': 'gzip' });
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(cuerpo).toString('utf8'), /iGasofa/);

  const segunda = await pedirCrudo(`${base}/js/app.js`, { 'If-None-Match': res.headers.etag });
  assert.equal(segunda.res.statusCode, 304);
});

test('bloquea el acceso fuera de public/', async () => {
  const r = await fetch(`${base}/..%2fserver.js`);
  assert.ok(r.status === 403 || r.status === 404, `estado ${r.status}`);
  assert.doesNotMatch(await r.text(), /createServer/);
});

// Va al final: agota el cupo de rutas por minuto de la IP local.
test('GET /api/ruta limita las búsquedas seguidas por IP', async () => {
  const estados = [];
  for (let i = 0; i < 25; i++) estados.push((await fetch(`${base}/api/ruta?origen=x`)).status);
  assert.ok(estados.includes(429), `estados: ${[...new Set(estados)]}`);
});
