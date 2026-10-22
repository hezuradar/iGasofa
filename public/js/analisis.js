/* ==========================================================================
   iGasofa — análisis de precios, horarios y filtros (sin DOM)
   ========================================================================== */
import { estado } from './comun.js';

const MIN_PRECIOS_TRAMOS = 4; // con menos precios no tiene sentido hablar de caro/barato
const BARRAS_HISTOGRAMA = 14;

export const valorDe = (est) => est.precios[estado.producto];
export const tienePrecio = (est) => typeof valorDe(est) === 'number';

/** Las de venta restringida ("R") sólo despachan a socios: no cuentan como mejor precio. */
export const esPublica = (est) => est.tipoVenta !== 'R';

export function horarioDe(est) {
  return estado.horarios.get(est.id) || { abierta: null, h24: false };
}

export function calcularHorarios() {
  const ahora = new Date();
  estado.horarios = new Map(
    estado.estaciones.map((e) => [e.id, window.iGasofaHorario.estadoEn(e.horario, ahora)])
  );
}

function cuantil(ordenados, q) {
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  const siguiente = ordenados[base + 1] === undefined ? ordenados[base] : ordenados[base + 1];
  return ordenados[base] + resto * (siguiente - ordenados[base]);
}

function histograma(valores, min, max) {
  const barras = Math.min(BARRAS_HISTOGRAMA, valores.length);
  const ancho = (max - min) / barras || 1;
  const cuentas = new Array(barras).fill(0);
  for (const v of valores) cuentas[Math.min(barras - 1, Math.floor((v - min) / ancho))]++;
  return cuentas.map((n, i) => ({ n, centro: min + ancho * (i + 0.5) }));
}

/** Mejor precio, media y tramos sobre las gasolineras públicas (y abiertas, si se filtra). */
export function calcularEstadisticas() {
  const candidatas = estado.estaciones.filter((e) =>
    tienePrecio(e) && esPublica(e) && !(estado.soloAbiertas && horarioDe(e).abierta === false));
  if (!candidatas.length) return null;

  let mejor = candidatas[0];
  for (const e of candidatas) {
    if (valorDe(e) < valorDe(mejor) || (valorDe(e) === valorDe(mejor) && e.distancia < mejor.distancia)) mejor = e;
  }
  const valores = candidatas.map(valorDe).sort((a, b) => a - b);
  const min = valores[0];
  const max = valores[valores.length - 1];
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const conTramos = valores.length >= MIN_PRECIOS_TRAMOS && max - min > 0.0005;
  return {
    mejor: { id: mejor.id, est: mejor, precio: valorDe(mejor) },
    n: valores.length,
    min,
    max,
    media,
    p33: conTramos ? cuantil(valores, 1 / 3) : null,
    p66: conTramos ? cuantil(valores, 2 / 3) : null,
    histograma: histograma(valores, min, max),
  };
}

export function tramo(valor) {
  const s = estado.stats;
  if (!s || s.p33 === null || typeof valor !== 'number') return '';
  if (valor <= s.p33) return 'barato';
  if (valor <= s.p66) return 'medio';
  return 'caro';
}

export const TEXTO_TRAMO = { barato: 'precio bajo', medio: 'precio medio', caro: 'precio alto' };

export function textoHorario(h, est) {
  if (h.h24) return { clase: 'abierta', texto: '24 h' };
  if (h.abierta === true) return { clase: 'abierta', texto: `Abierta · cierra ${h.hasta}` };
  if (h.abierta === false) return { clase: 'cerrada', texto: h.abre ? `Cerrada · abre ${h.abre}` : 'Cerrada' };
  return est.horario ? { clase: '', texto: est.horario } : null;
}

/** Minúsculas y sin tildes, para que "oñati" encuentre "OÑATI" y "camion" a "Camión". */
export const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function coincideTexto(est, filtro) {
  if (!filtro) return true;
  return normalizar(`${est.rotulo} ${est.direccion} ${est.municipio} ${est.localidad}`).includes(filtro);
}

function porPrecio(dir) {
  return (a, b) => {
    const pa = valorDe(a);
    const pb = valorDe(b);
    if (typeof pa !== 'number' && typeof pb !== 'number') return a.distancia - b.distancia;
    if (typeof pa !== 'number') return 1;
    if (typeof pb !== 'number') return -1;
    if (pa !== pb) return (pa - pb) * dir;
    return a.distancia - b.distancia;
  };
}

const ORDENES = {
  distancia: (a, b) => a.distancia - b.distancia,
  // Sin ruta (resultados de una búsqueda "cerca") se mantiene el orden por distancia.
  ruta: (a, b) => (a.kmRuta ?? 0) - (b.kmRuta ?? 0) || a.distancia - b.distancia,
  precio: porPrecio(1),
  'precio-desc': porPrecio(-1),
};

/** Gasolineras que pasan los filtros, en el orden elegido (lista y mapa). */
export function estacionesVisibles({ conTexto = true } = {}) {
  const filtro = conTexto ? normalizar(estado.filtroTexto.trim()) : '';
  const lista = estado.estaciones.filter((e) =>
    (!estado.soloConProducto || tienePrecio(e)) &&
    (!estado.soloAbiertas || horarioDe(e).abierta !== false) &&
    coincideTexto(e, filtro));
  return lista.sort(ORDENES[estado.orden] || ORDENES.distancia);
}
