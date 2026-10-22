'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretar, estadoEn, es24h } = require('../public/horario.js');

// 2026-10-21 es miércoles; getDay() = 3.
const miercoles = (hh, mm = 0) => new Date(2026, 9, 21, hh, mm);
const sabado = (hh, mm = 0) => new Date(2026, 9, 24, hh, mm);
const domingo = (hh, mm = 0) => new Date(2026, 9, 25, hh, mm);

test('reconoce el horario 24 horas toda la semana', () => {
  assert.equal(es24h('L-D: 24H'), true);
  assert.equal(es24h('L-D: 00:00-23:59'), true);
  assert.deepEqual(estadoEn('L-D: 24H', miercoles(3)), { abierta: true, h24: true });
});

test('no considera 24 h un horario que sólo cubre algunos días', () => {
  assert.equal(es24h('L-V: 24H'), false);
  assert.equal(es24h('L: 24H'), false);
});

test('abierta dentro del tramo e informa de la hora de cierre', () => {
  assert.deepEqual(estadoEn('L-D: 06:00-22:00', miercoles(10)), { abierta: true, h24: false, hasta: '22:00' });
});

test('cerrada antes de abrir e informa de la hora de apertura', () => {
  assert.deepEqual(estadoEn('L-D: 06:00-22:00', miercoles(5, 30)), { abierta: false, h24: false, abre: '06:00' });
});

test('cerrada tras el cierre sin más tramos ese día', () => {
  assert.deepEqual(estadoEn('L-D: 06:00-22:00', miercoles(22, 0)), { abierta: false, h24: false });
});

test('aplica el bloque del fin de semana', () => {
  const h = 'L-V: 06:00-22:00; S-D: 08:00-14:00';
  assert.equal(estadoEn(h, sabado(7)).abierta, false);
  assert.equal(estadoEn(h, sabado(9)).abierta, true);
  assert.equal(estadoEn(h, domingo(15)).abierta, false);
});

test('admite varios tramos en el mismo día', () => {
  const h = 'L-S: 07:00-14:00 y 16:00-21:00';
  assert.equal(estadoEn(h, miercoles(15)).abierta, false);
  assert.equal(estadoEn(h, miercoles(15)).abre, '16:00');
  assert.equal(estadoEn(h, miercoles(17)).abierta, true);
});

test('un día no declarado se considera cerrado', () => {
  assert.equal(estadoEn('L-S: 07:00-22:00', domingo(12)).abierta, false);
});

test('tramo que cruza la medianoche', () => {
  const h = 'L-D: 22:00-06:00';
  assert.equal(estadoEn(h, miercoles(23)).abierta, true);
  assert.equal(estadoEn(h, miercoles(3)).abierta, true);
  assert.equal(estadoEn(h, miercoles(12)).abierta, false);
});

test('cierre a medianoche escrito como 00:00', () => {
  assert.deepEqual(estadoEn('L-D: 06:00-00:00', miercoles(23, 30)), { abierta: true, h24: false, hasta: '24:00' });
});

test('tolera horas de un dígito y espacios sobrantes', () => {
  assert.equal(estadoEn('L-S: 8:00 -22:00', miercoles(9)).abierta, true);
});

test('horario sólo del lunes: resto de días desconocido', () => {
  assert.equal(estadoEn('L: 07:00-22:00', miercoles(10)).abierta, null);
});

test('devuelve desconocido con textos no reconocibles', () => {
  assert.equal(interpretar(''), null);
  assert.equal(interpretar('Consultar'), null);
  assert.equal(estadoEn(undefined, miercoles(10)).abierta, null);
});
