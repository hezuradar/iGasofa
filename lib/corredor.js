'use strict';

/**
 * iGasofa — gasolineras a lo largo de una ruta.
 *
 * Funciones puras (sin red) que usa server.js para /api/ruta:
 *   - estacionesEnRuta: qué gasolineras quedan a menos de `desvioKm` del
 *     trazado y en qué kilómetro de la ruta están.
 *   - simplificar: reduce los puntos del trazado que se envían al navegador.
 *
 * Las distancias se calculan en una proyección equirectangular local (km),
 * suficiente para distancias de pocos kilómetros a la ruta. Para no comparar
 * cada gasolinera con cada tramo, los tramos se indexan en una rejilla.
 */

const KM_POR_GRADO_LAT = 110.574;
const KM_POR_GRADO_LON_ECUADOR = 111.32;

function proyector(coords) {
  const latMedia = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const kx = KM_POR_GRADO_LON_ECUADOR * Math.cos((latMedia * Math.PI) / 180);
  return ([lat, lon]) => [lon * kx, lat * KM_POR_GRADO_LAT];
}

/** Tramos proyectados con su kilómetro de inicio en la ruta. */
function construirTramos(puntos) {
  const tramos = [];
  let km = 0;
  for (let i = 0; i < puntos.length - 1; i++) {
    const [ax, ay] = puntos[i];
    const [bx, by] = puntos[i + 1];
    const largo = Math.hypot(bx - ax, by - ay);
    if (largo > 0) tramos.push({ ax, ay, bx, by, largo, kmInicio: km });
    km += largo;
  }
  return { tramos, totalKm: km };
}

function indexar(tramos, celda) {
  const rejilla = new Map();
  tramos.forEach((t, i) => {
    const x0 = Math.floor(Math.min(t.ax, t.bx) / celda);
    const x1 = Math.floor(Math.max(t.ax, t.bx) / celda);
    const y0 = Math.floor(Math.min(t.ay, t.by) / celda);
    const y1 = Math.floor(Math.max(t.ay, t.by) / celda);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        if (!rejilla.has(k)) rejilla.set(k, []);
        rejilla.get(k).push(i);
      }
    }
  });
  return rejilla;
}

/** Distancia del punto al tramo y posición (0..1) de su proyección sobre él. */
function distanciaATramo(px, py, t) {
  const dx = t.bx - t.ax;
  const dy = t.by - t.ay;
  const u = Math.max(0, Math.min(1, ((px - t.ax) * dx + (py - t.ay) * dy) / (t.largo * t.largo)));
  return { d: Math.hypot(px - (t.ax + u * dx), py - (t.ay + u * dy)), u };
}

/**
 * @param {Array<{lat:number, lon:number}>} estaciones
 * @param {Array<[number, number]>} coords trazado como [lat, lon]
 * @param {number} desvioKm distancia máxima a la ruta
 * @param {number} [longitudRealKm] longitud de la ruta según el servicio de rutas; si se da, los
 *   kilómetros se reescalan a ella (la proyección se desvía algo en rutas largas este-oeste)
 * @returns {Array<object>} copias de las estaciones con `desvio` y `kmRuta`, ordenadas por kmRuta
 */
function estacionesEnRuta(estaciones, coords, desvioKm, longitudRealKm) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const proyectar = proyector(coords);
  const { tramos, totalKm } = construirTramos(coords.map(proyectar));
  if (!tramos.length) return [];
  const escala = longitudRealKm > 0 ? longitudRealKm / totalKm : 1;

  // Con celdas del tamaño del desvío basta con mirar la celda y sus vecinas.
  const celda = Math.max(desvioKm, 1);
  const rejilla = indexar(tramos, celda);
  const encontradas = [];

  for (const e of estaciones) {
    const [px, py] = proyectar([e.lat, e.lon]);
    const cx = Math.floor(px / celda);
    const cy = Math.floor(py / celda);
    let mejor = null;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const i of rejilla.get(`${x}:${y}`) || []) {
          const t = tramos[i];
          const { d, u } = distanciaATramo(px, py, t);
          if (d <= desvioKm && (!mejor || d < mejor.d)) mejor = { d, km: t.kmInicio + u * t.largo };
        }
      }
    }
    if (mejor) {
      encontradas.push({
        ...e,
        desvio: Math.round(mejor.d * 100) / 100,
        kmRuta: Math.round(Math.min(mejor.km, totalKm) * escala * 10) / 10,
      });
    }
  }
  encontradas.sort((a, b) => a.kmRuta - b.kmRuta);
  return encontradas;
}

/** Ramer–Douglas–Peucker iterativo sobre [lat, lon]; `tolerancia` en grados. */
function simplificar(coords, tolerancia = 0.0002) {
  if (coords.length <= 2) return coords.slice();
  const conservar = new Uint8Array(coords.length);
  conservar[0] = 1;
  conservar[coords.length - 1] = 1;
  const pila = [[0, coords.length - 1]];
  while (pila.length) {
    const [ini, fin] = pila.pop();
    const [ay, ax] = coords[ini];
    const [by, bx] = coords[fin];
    const dx = bx - ax;
    const dy = by - ay;
    const largo2 = dx * dx + dy * dy;
    let maxD = 0;
    let indice = -1;
    for (let i = ini + 1; i < fin; i++) {
      const [py, px] = coords[i];
      const u = largo2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo2)) : 0;
      const d = Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
      if (d > maxD) { maxD = d; indice = i; }
    }
    if (maxD > tolerancia && indice > 0) {
      conservar[indice] = 1;
      pila.push([ini, indice], [indice, fin]);
    }
  }
  return coords.filter((_, i) => conservar[i]);
}

module.exports = { estacionesEnRuta, simplificar };
