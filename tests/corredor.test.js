'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estacionesEnRuta, simplificar } = require('../lib/corredor');

// Ruta recta hacia el este a lo largo del paralelo 43 (≈ 81 km por grado de longitud).
const RUTA = [[43, -3], [43, -2.5], [43, -2]];
const est = (id, lat, lon) => ({ id, lat, lon, precios: {} });

test('incluye las gasolineras dentro del desvío y descarta las lejanas', () => {
  const r = estacionesEnRuta([
    est('cerca', 43.005, -2.7), // ~0,55 km al norte
    est('lejos', 43.1, -2.7), // ~11 km
  ], RUTA, 2);
  assert.deepEqual(r.map((e) => e.id), ['cerca']);
  assert.ok(r[0].desvio > 0.4 && r[0].desvio < 0.7, `desvío ${r[0].desvio}`);
});

test('ordena por el kilómetro de la ruta en que aparecen', () => {
  const r = estacionesEnRuta([est('b', 43, -2.2), est('a', 43, -2.9)], RUTA, 1);
  assert.deepEqual(r.map((e) => e.id), ['a', 'b']);
  assert.ok(Math.abs(r[0].kmRuta - 8.1) < 0.3, `km ${r[0].kmRuta}`);
  assert.ok(Math.abs(r[1].kmRuta - 65.1) < 0.5, `km ${r[1].kmRuta}`);
});

test('no se sale del final del trazado', () => {
  const r = estacionesEnRuta([est('fin', 43, -1.99)], RUTA, 2);
  assert.equal(r.length, 1);
  assert.ok(r[0].kmRuta <= 81.5);
});

test('reescala los kilómetros a la longitud real de la ruta', () => {
  const [e] = estacionesEnRuta([est('mitad', 43, -2.5)], RUTA, 1, 100);
  assert.ok(Math.abs(e.kmRuta - 50) < 0.5, `km ${e.kmRuta}`);
});

test('no muta las estaciones originales', () => {
  const original = est('x', 43, -2.5);
  estacionesEnRuta([original], RUTA, 1);
  assert.equal(original.desvio, undefined);
});

test('trazado vacío o de un punto no devuelve nada', () => {
  assert.deepEqual(estacionesEnRuta([est('x', 43, -2.5)], [], 2), []);
  assert.deepEqual(estacionesEnRuta([est('x', 43, -2.5)], [[43, -2.5]], 2), []);
});

test('simplificar elimina puntos alineados y conserva extremos y quiebros', () => {
  const linea = [[0, 0], [0, 1], [0, 2], [1, 2]];
  assert.deepEqual(simplificar(linea), [[0, 0], [0, 2], [1, 2]]);
});
