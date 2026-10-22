/* ==========================================================================
   iGasofa — interpretación de los horarios declarados por las gasolineras
   Lo usan el navegador (window.iGasofaHorario) y los tests de Node.

   Formatos reales del dataset del Ministerio:
     "L-D: 24H"
     "L-V: 06:00-22:00; S-D: 07:00-22:00"
     "L-S: 07:00-14:00 y 16:00-21:00; D: 8:30-14:00"
     "L-D: 22:00-06:00"            (cruza la medianoche)
   ========================================================================== */
(function (raiz, fabrica) {
  'use strict';
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.iGasofaHorario = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Índices como Date#getDay(): domingo = 0.
  const DIAS = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 };
  const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // de lunes a domingo
  const MINUTOS_DIA = 24 * 60;

  function aMinutos(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
    return h * 60 + min;
  }

  /** "L-V" → [1,2,3,4,5]; "V-L" da la vuelta a la semana. */
  function expandirDias(texto) {
    const partes = texto.trim().toUpperCase().split('-').map((s) => s.trim());
    if (partes.length === 1) return DIAS[partes[0]] === undefined ? null : [DIAS[partes[0]]];
    if (partes.length !== 2) return null;
    const ini = DIAS[partes[0]];
    const fin = DIAS[partes[1]];
    if (ini === undefined || fin === undefined) return null;
    const dias = [];
    let i = ORDEN_SEMANA.indexOf(ini);
    for (let guarda = 0; guarda < 7; guarda++) {
      dias.push(ORDEN_SEMANA[i]);
      if (ORDEN_SEMANA[i] === fin) return dias;
      i = (i + 1) % 7;
    }
    return null;
  }

  /** "06:00-22:00 y 16:00-21:00" → [{ini, fin}], o "24H". */
  function leerTramos(texto) {
    const t = texto.trim().toUpperCase();
    if (t === '24H' || t === '24 H') return [{ ini: 0, fin: MINUTOS_DIA }];
    const tramos = [];
    for (const trozo of t.split(/\s+Y\s+|,/)) {
      const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(trozo.trim());
      if (!m) return null;
      const ini = aMinutos(m[1]);
      let fin = aMinutos(m[2]);
      if (ini === null || fin === null) return null;
      if (fin === 0) fin = MINUTOS_DIA; // "06:00-00:00" cierra a medianoche
      if (fin === MINUTOS_DIA - 1) fin = MINUTOS_DIA; // "00:00-23:59" es todo el día
      tramos.push({ ini, fin });
    }
    return tramos.length ? tramos : null;
  }

  /**
   * Convierte el texto del horario en una tabla por día de la semana.
   * Devuelve null si el formato no se reconoce.
   */
  function interpretar(horario) {
    if (!horario || typeof horario !== 'string') return null;
    const bloques = horario.split(';').map((b) => b.trim()).filter(Boolean);
    if (!bloques.length) return null;

    const semana = new Map();
    for (const bloque of bloques) {
      const sep = bloque.indexOf(':');
      if (sep < 0) return null;
      const dias = expandirDias(bloque.slice(0, sep));
      const tramos = leerTramos(bloque.slice(sep + 1));
      if (!dias || !tramos) return null;
      for (const d of dias) semana.set(d, (semana.get(d) || []).concat(tramos));
    }

    // Muchas gasolineras sólo rellenan el lunes ("L: 24H"): no se puede
    // deducir qué hacen el resto de la semana.
    const parcial = semana.size === 1 && semana.has(1);
    return { semana, parcial };
  }

  function cubreDiaEntero(tramos) {
    return tramos.some((t) => t.ini === 0 && t.fin >= MINUTOS_DIA);
  }

  function es24h(horario) {
    const h = interpretar(horario);
    if (!h || h.parcial || h.semana.size !== 7) return false;
    for (const tramos of h.semana.values()) {
      if (!cubreDiaEntero(tramos)) return false;
    }
    return true;
  }

  function fmtHora(min) {
    if (min >= MINUTOS_DIA) return '24:00';
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }

  /**
   * ¿Está abierta en `fecha`?
   * → { abierta: true|false|null, h24: boolean, hasta?: 'HH:MM', abre?: 'HH:MM' }
   * `abierta` es null cuando el horario no permite saberlo.
   */
  function estadoEn(horario, fecha = new Date()) {
    const h = interpretar(horario);
    if (!h) return { abierta: null, h24: false };
    if (es24h(horario)) return { abierta: true, h24: true };

    const dia = fecha.getDay();
    if (h.parcial && dia !== 1) return { abierta: null, h24: false };

    const ayer = (dia + 6) % 7;
    const ahora = fecha.getHours() * 60 + fecha.getMinutes();
    const hoy = h.semana.get(dia) || [];

    for (const t of hoy) {
      const cruzaMedianoche = t.fin <= t.ini; // "22:00-06:00"
      const dentro = cruzaMedianoche ? ahora >= t.ini : ahora >= t.ini && ahora < t.fin;
      if (dentro) return { abierta: true, h24: false, hasta: fmtHora(t.fin) };
    }
    for (const t of h.semana.get(ayer) || []) {
      if (t.fin <= t.ini && ahora < t.fin) return { abierta: true, h24: false, hasta: fmtHora(t.fin) };
    }

    const proximo = hoy.filter((t) => t.ini > ahora).sort((a, b) => a.ini - b.ini)[0];
    return proximo
      ? { abierta: false, h24: false, abre: fmtHora(proximo.ini) }
      : { abierta: false, h24: false };
  }

  return { interpretar, estadoEn, es24h };
});
