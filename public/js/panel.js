/* ==========================================================================
   iGasofa — panel lateral: resumen, ruta, lista de gasolineras
   ========================================================================== */
import {
  estado, ELEMENTOS, POR_PAGINA, el, boton, nodoPrecio, precio, euros, distancia, duracion,
  nombreProducto, nombreCorto, colorMarca, iniciales, enlaceGoogle, aviso, pintarEstado,
  reducirMovimiento, pantallaEstrecha,
} from './comun.js';
import {
  valorDe, esPublica, horarioDe, tramo, textoHorario, estacionesVisibles,
  calcularHorarios, calcularEstadisticas,
} from './analisis.js';
import { enfocar, pintarMarcadores, cambiarVista } from './mapa.js';

const enRuta = () => estado.modo === 'ruta' && estado.ruta;

/* ------------------------------------------------------------------ *
 * Estados del panel
 * ------------------------------------------------------------------ */
export function mostrarVacio() {
  ELEMENTOS.vacio.hidden = false;
  ELEMENTOS.panelBody.hidden = true;
}

export function mostrarCargando() {
  ELEMENTOS.vacio.hidden = true;
  ELEMENTOS.panelBody.hidden = false;
  ELEMENTOS.panelBody.setAttribute('aria-busy', 'true');
  pintarEstado('cargando', 'Buscando…');
  ELEMENTOS.rutaInfo.hidden = true;
  ELEMENTOS.resumen.textContent = '';
  ELEMENTOS.resumen.appendChild(el('div', 'resumen-card esqueleto'));
  ELEMENTOS.lista.textContent = '';
  for (let i = 0; i < 5; i++) ELEMENTOS.lista.appendChild(el('li', 'tarjeta esqueleto'));
  ELEMENTOS.btnMas.hidden = true;
  ELEMENTOS.contador.textContent = 'Buscando gasolineras…';
  ELEMENTOS.notaOrden.textContent = '';
}

export function render() {
  ELEMENTOS.vacio.hidden = true;
  ELEMENTOS.panelBody.hidden = false;
  ELEMENTOS.panelBody.removeAttribute('aria-busy');
  calcularHorarios();
  estado.stats = calcularEstadisticas();
  renderProducto();
  renderRutaInfo();
  renderResumen();
  renderLista();
  pintarMarcadores();
}

/* ------------------------------------------------------------------ *
 * Selector de producto
 * ------------------------------------------------------------------ */

/* Un desplegable compacto con el número de gasolineras de la zona que
   publican ese precio. */
export function renderProducto() {
  const sel = ELEMENTOS.selectProducto;
  const firma = estado.productos.map((p) => p.key).join('|');
  if (sel.dataset.catalogo !== firma) {
    sel.textContent = '';
    const grupos = [['Principales', estado.productos.filter((p) => p.principal)],
      ['Otros carburantes', estado.productos.filter((p) => !p.principal)]];
    for (const [titulo, productos] of grupos) {
      const og = el('optgroup');
      og.label = titulo;
      for (const p of productos) {
        const op = el('option', null, p.nombre);
        op.value = p.key;
        og.appendChild(op);
      }
      sel.appendChild(og);
    }
    sel.dataset.catalogo = firma;
  }

  const conResultados = estado.estaciones.length > 0;
  for (const op of Array.from(sel.options)) {
    const nombre = nombreProducto(op.value);
    const n = estado.estaciones.filter((e) => typeof e.precios[op.value] === 'number').length;
    op.textContent = conResultados ? `${nombre} (${n})` : nombre;
  }
  sel.value = estado.producto;
}

/* ------------------------------------------------------------------ *
 * Ruta y resumen
 * ------------------------------------------------------------------ */
function renderRutaInfo() {
  const cont = ELEMENTOS.rutaInfo;
  cont.textContent = '';
  cont.hidden = !enRuta();
  if (!enRuta()) return;
  const r = estado.ruta;
  const tramos = el('p', 'ruta-tramo');
  tramos.append(
    el('span', 'ruta-punto a', 'A'), el('span', 'ruta-nombre', nombreCorto(r.origen.nombre) || r.origen.nombre),
    el('span', 'ruta-flecha', '→'),
    el('span', 'ruta-punto b', 'B'), el('span', 'ruta-nombre', nombreCorto(r.destino.nombre) || r.destino.nombre)
  );
  const datos = el('p', 'ruta-datos', `${distancia(r.distanciaKm)} · ${duracion(r.duracionMin)} en coche · gasolineras a menos de ${estado.desvio} km de la ruta`);
  // Salida clara de la ruta: sin esto, escribir el CP en el origen recalcula la ruta.
  const salir = boton('btn btn-soft btn-salir-ruta', 'Buscar cerca de un código postal',
    () => document.dispatchEvent(new CustomEvent('igasofa:buscar-cp')));
  cont.append(tramos, datos, salir);
}

function renderHistograma(s) {
  const cont = el('div', 'histo');
  const titulo = el('div', 'histo-titulo');
  titulo.append(el('span', null, `Precios ${enRuta() ? 'en la ruta' : 'en la zona'} · ${s.n} gasolineras`),
    el('span', null, `media ${precio(s.media)} €`));
  cont.appendChild(titulo);

  const barras = el('div', 'histo-barras');
  barras.setAttribute('aria-hidden', 'true');
  const maxN = Math.max(...s.histograma.map((b) => b.n));
  for (const b of s.histograma) {
    const barra = el('span', `histo-barra ${tramo(b.centro) ? 't-' + tramo(b.centro) : ''}`);
    barra.style.setProperty('--h', `${b.n ? Math.max(12, (b.n / maxN) * 100) : 4}%`);
    barras.appendChild(barra);
  }
  const marca = el('span', 'histo-media');
  marca.style.setProperty('--x', `${((s.media - s.min) / (s.max - s.min || 1)) * 100}%`);
  barras.appendChild(marca);
  cont.appendChild(barras);

  const ejes = el('div', 'histo-ejes');
  ejes.append(el('span', null, `${precio(s.min)} €`), el('span', null, `${precio(s.max)} €`));
  cont.appendChild(ejes);
  cont.appendChild(el('span', 'sr-only',
    `Precios entre ${precio(s.min)} y ${precio(s.max)} euros por litro; media ${precio(s.media)}.`));
  return cont;
}

function renderAhorro(s) {
  const litros = estado.deposito;
  const ah = el('div', 'resumen-ahorro');
  const fila = el('div', 'ahorro-fila');
  fila.append(el('span', null, `Llenar ${litros} L aquí`), el('strong', null, euros(s.mejor.precio * litros)));
  ah.appendChild(fila);
  const vsMedia = (s.media - s.mejor.precio) * litros;
  const vsMax = (s.max - s.mejor.precio) * litros;
  if (vsMax >= 0.01) {
    const detalle = el('div', 'ahorro-detalle');
    detalle.textContent = vsMedia >= 0.01
      ? `Ahorras ${euros(vsMedia)} frente a la media y ${euros(vsMax)} frente a la más cara.`
      : `Ahorras ${euros(vsMax)} frente a la más cara.`;
    ah.appendChild(detalle);
  }
  return ah;
}

/** Texto de posición: distancia al centro o kilómetro y desvío en la ruta. */
function posicion(est) {
  return enRuta()
    ? `km ${Math.round(est.kmRuta)} · a ${distancia(est.desvio)} de la ruta`
    : distancia(est.distancia);
}

async function compartir() {
  const s = estado.stats;
  const donde = enRuta() ? `de camino a ${nombreCorto(estado.ruta.destino.nombre)}` : '';
  const texto = s
    ? `${nombreProducto()} a ${precio(s.mejor.precio)} €/L en ${s.mejor.est.rotulo} (${s.mejor.est.municipio || s.mejor.est.localidad}) ${donde}`.trim()
    : 'Gasolineras en iGasofa';
  // La URL sólo lleva búsquedas por texto o CP; si no, se comparte la gasolinera.
  const compartible = new URLSearchParams(location.search).has('cp') || new URLSearchParams(location.search).has('origen');
  const url = compartible || !s ? location.href : enlaceGoogle(s.mejor.est);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'iGasofa', text: texto, url });
      return;
    }
    await navigator.clipboard.writeText(`${texto} · ${url}`);
    aviso('Enlace copiado al portapapeles.', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // el usuario cerró el diálogo
    aviso('No se pudo compartir el enlace.', 'error');
  }
}

function renderResumen() {
  const cont = ELEMENTOS.resumen;
  cont.textContent = '';
  const s = estado.stats;

  if (!s) {
    const card = el('div', 'resumen-card sin-datos');
    card.appendChild(el('div', 'resumen-etiqueta', 'Sin datos'));
    const donde = enRuta() ? 'en la ruta' : `en ${estado.radio} km`;
    card.appendChild(el('p', 'resumen-texto',
      `Ninguna gasolinera ${estado.soloAbiertas ? 'abierta ' : ''}${donde} publica precio de ${nombreProducto()}.`));
    cont.appendChild(card);
    return;
  }

  const est = s.mejor.est;
  const card = el('div', 'resumen-card');
  card.appendChild(el('div', 'resumen-etiqueta',
    `★ ${enRuta() ? 'Más barata en tu ruta' : 'Mejor precio'} · ${nombreProducto()}`));

  const fila = el('div', 'resumen-fila');
  const datos = el('div', 'resumen-datos');
  datos.append(el('strong', null, est.rotulo), el('span', null,
    `${posicion(est)} · ${est.municipio || est.localidad || ''}`));
  const h = textoHorario(horarioDe(est), est);
  if (h) datos.appendChild(el('span', `resumen-horario ${h.clase}`, h.texto));
  fila.append(nodoPrecio('resumen-precio', s.mejor.precio), datos);
  card.appendChild(fila);

  card.appendChild(renderAhorro(s));
  if (s.n > 1) card.appendChild(renderHistograma(s));

  const acciones = el('div', 'resumen-accion');
  acciones.append(
    boton('btn', 'Ver en el mapa', () => enfocar(est)),
    boton('btn', 'Ver en la lista', () => irATarjeta(est.id)),
    boton('btn', 'Cómo llegar', () => window.open(enlaceGoogle(est, 'ruta'), '_blank', 'noopener')),
    boton('btn', 'Compartir', compartir)
  );
  card.appendChild(acciones);
  cont.appendChild(card);
}

/* ------------------------------------------------------------------ *
 * Lista
 * ------------------------------------------------------------------ */
function textoContador(mostradas, total) {
  const n = `${mostradas} gasolinera${mostradas === 1 ? '' : 's'}`;
  const filtradas = estado.filtroTexto.trim() ? ` de ${total} que coinciden con «${estado.filtroTexto.trim()}»` : '';
  if (enRuta()) return `${n}${filtradas} en la ruta`;
  return `${n}${filtradas} a ${estado.radio} km de ${estado.centroNombre}`;
}

const NOTAS_ORDEN = { ruta: 'en orden de trayecto', distancia: 'por cercanía', precio: 'de más barata a más cara', 'precio-desc': 'de más cara a más barata' };

export function renderLista() {
  const cont = ELEMENTOS.lista;
  cont.textContent = '';

  const lista = estacionesVisibles();
  const total = estacionesVisibles({ conTexto: false }).length;
  ELEMENTOS.contador.textContent = lista.length
    ? (estado.filtroTexto.trim() ? `${lista.length} de ${total} gasolineras coinciden` : textoContador(lista.length, total))
    : 'Ninguna gasolinera coincide';
  ELEMENTOS.notaOrden.textContent = enRuta() && estado.orden === 'distancia' ? 'por menor desvío' : NOTAS_ORDEN[estado.orden] || '';

  if (!lista.length) {
    const filtros = [estado.soloConProducto && 'con precio', estado.soloAbiertas && 'abiertas'].filter(Boolean);
    const sugerencia = estado.filtroTexto.trim()
      ? `Ninguna coincide con «${estado.filtroTexto.trim()}». Revisa el texto del filtro.`
      : filtros.length
        ? `No hay gasolineras ${filtros.join(' y ')}. Prueba a quitar filtros o a ampliar ${enRuta() ? 'el desvío' : 'el radio'}.`
        : `No hay gasolineras. Prueba a ampliar ${enRuta() ? 'el desvío' : 'el radio'}.`;
    cont.appendChild(el('li', 'vacio-lista', sugerencia));
    ELEMENTOS.btnMas.hidden = true;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const est of lista.slice(0, estado.limite)) frag.appendChild(tarjeta(est));
  cont.appendChild(frag);

  const quedan = lista.length - estado.limite;
  ELEMENTOS.btnMas.hidden = quedan <= 0;
  if (quedan > 0) ELEMENTOS.btnMas.textContent = `Mostrar ${Math.min(POR_PAGINA, quedan)} más (quedan ${quedan})`;
}

export function mostrarMas() {
  const primeraNueva = estado.limite;
  estado.limite += POR_PAGINA;
  renderLista();
  // El foco pasa a la primera gasolinera nueva para seguir leyendo desde ahí.
  const nueva = ELEMENTOS.lista.children[primeraNueva];
  if (nueva) nueva.focus();
}

function precioTarjeta(est, esMejor) {
  const cont = el('div', 'tarjeta-precios');
  const valor = valorDe(est);
  if (typeof valor !== 'number') {
    cont.append(el('div', 'precio-actual', '—'), el('div', 'precio-sub', 'sin precio'));
    return cont;
  }
  cont.appendChild(nodoPrecio(`precio-actual ${tramo(valor) ? 't-' + tramo(valor) : ''}`, valor));

  if (esMejor) {
    cont.appendChild(el('div', 'precio-sub', 'la más barata'));
  } else if (estado.stats) {
    const dif = valor - estado.stats.mejor.precio;
    if (dif > 0.0005) {
      const sub = el('div', 'precio-sub sube', `+${precio(dif)} €`);
      sub.title = `${euros(dif * estado.deposito)} más en un depósito de ${estado.deposito} L`;
      sub.setAttribute('aria-label', `${precio(dif)} euros más por litro que la más barata`);
      cont.appendChild(sub);
    } else if (esPublica(est)) {
      cont.appendChild(el('div', 'precio-sub', 'mismo precio'));
    }
  }
  return cont;
}

function metaTarjeta(est, h) {
  const meta = el('div', 'tarjeta-meta');
  if (enRuta()) {
    meta.appendChild(el('span', 'tag km', `km ${Math.round(est.kmRuta)}`));
    meta.appendChild(el('span', 'tag', `a ${distancia(est.desvio)} de la ruta`));
  } else {
    meta.appendChild(el('span', 'tag', distancia(est.distancia)));
  }
  const th = textoHorario(h, est);
  if (th) {
    const tag = el('span', `tag ${th.clase}`, th.texto);
    if (est.horario) tag.title = est.horario;
    meta.appendChild(tag);
  }
  if (!esPublica(est)) {
    const tag = el('span', 'tag aviso', 'Venta restringida');
    tag.title = 'Sólo para socios o clientes autorizados';
    meta.appendChild(tag);
  }
  return meta;
}

function otrosPrecios(est) {
  const otros = estado.productos.filter((p) => p.key !== estado.producto && typeof est.precios[p.key] === 'number');
  if (!otros.length) return null;
  const det = el('details', 'tarjeta-otros');
  det.appendChild(el('summary', null, `Otros carburantes (${otros.length})`));
  const ul = el('ul', 'otros-lista');
  for (const p of otros) {
    const li = el('li', 'otros-item');
    li.append(el('span', null, p.nombre), el('b', null, `${precio(est.precios[p.key])} €`));
    ul.appendChild(li);
  }
  det.appendChild(ul);
  // No abre el mapa al desplegarlo.
  det.addEventListener('click', (ev) => ev.stopPropagation());
  return det;
}

function tarjeta(est) {
  const esMejor = Boolean(estado.stats && estado.stats.mejor.id === est.id);
  const h = horarioDe(est);
  const idTitulo = `t-${est.id}`;
  const li = el('li', 'tarjeta');
  li.dataset.id = est.id;
  li.tabIndex = -1; // destino del foco al llegar desde el mapa o desde "mostrar más"
  li.setAttribute('aria-labelledby', idTitulo);
  if (esMejor) li.classList.add('mejor');
  if (h.abierta === false) li.classList.add('cerrada');
  if (estado.seleccionada === est.id) {
    li.classList.add('seleccionada');
    li.setAttribute('aria-current', 'true');
  }

  const avatar = el('div', 'tarjeta-avatar', iniciales(est.rotulo));
  avatar.setAttribute('aria-hidden', 'true');
  if (!esMejor) avatar.style.background = colorMarca(est.rotulo);

  const cuerpo = el('div', 'tarjeta-cuerpo');
  const titulo = el('h3', 'tarjeta-titulo');
  const nombre = el('span', null, est.rotulo);
  nombre.id = idTitulo;
  titulo.appendChild(nombre);
  if (esMejor) titulo.appendChild(el('span', 'tag mejora', enRuta() ? '★ Más barata de la ruta' : '★ Mejor precio'));
  cuerpo.appendChild(titulo);
  cuerpo.appendChild(el('div', 'tarjeta-direccion', [est.direccion, est.municipio || est.localidad].filter(Boolean).join(' · ')));
  cuerpo.appendChild(metaTarjeta(est, h));

  li.append(avatar, cuerpo, precioTarjeta(est, esMejor));
  const otros = otrosPrecios(est);
  if (otros) li.appendChild(otros);

  const enlaces = el('div', 'tarjeta-enlaces');
  const ver = boton('mini-enlace', 'Ver en el mapa', (ev) => { ev.stopPropagation(); enfocar(est); });
  ver.setAttribute('aria-label', `Ver ${est.rotulo} en el mapa`);
  const ruta = el('a', 'mini-enlace', 'Cómo llegar');
  ruta.href = enlaceGoogle(est, 'ruta');
  ruta.target = '_blank';
  ruta.rel = 'noopener';
  ruta.setAttribute('aria-label', `Cómo llegar a ${est.rotulo} (se abre en Google Maps)`);
  ruta.addEventListener('click', (ev) => ev.stopPropagation());
  enlaces.append(ver, ruta);
  li.appendChild(enlaces);

  // En escritorio toda la ficha lleva al mapa; en móvil sólo el botón, para
  // que tocar la ficha al desplazarse no cambie de pantalla.
  li.addEventListener('click', () => { if (!pantallaEstrecha()) enfocar(est); });
  return li;
}

/** Marca en la lista la gasolinera cuyo popup está abierto. */
export function resaltarTarjeta(id, desplazar) {
  estado.seleccionada = id;
  let destino = null;
  for (const t of ELEMENTOS.lista.querySelectorAll('.tarjeta')) {
    const es = t.dataset.id === id;
    t.classList.toggle('seleccionada', es);
    if (es) t.setAttribute('aria-current', 'true');
    else t.removeAttribute('aria-current');
    if (es) destino = t;
  }
  if (desplazar && destino && !pantallaEstrecha()) {
    destino.scrollIntoView({ block: 'nearest', behavior: reducirMovimiento() ? 'auto' : 'smooth' });
  }
}

/** Lleva a la ficha de la lista (mostrando más páginas si hace falta) y le da el foco. */
export function irATarjeta(id) {
  const indice = estacionesVisibles().findIndex((e) => e.id === id);
  if (indice < 0) return;
  if (indice >= estado.limite) {
    estado.limite = Math.ceil((indice + 1) / POR_PAGINA) * POR_PAGINA;
    renderLista();
  }
  if (pantallaEstrecha()) cambiarVista('lista');
  resaltarTarjeta(id, false);
  const t = ELEMENTOS.lista.querySelector(`.tarjeta[data-id="${CSS.escape(id)}"]`);
  if (!t) return;
  t.scrollIntoView({ block: 'center', behavior: reducirMovimiento() ? 'auto' : 'smooth' });
  t.focus({ preventScroll: true });
}
