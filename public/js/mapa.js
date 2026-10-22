/* ==========================================================================
   iGasofa — mapa: capas, marcadores, popups, ruta y vistas móviles
   ========================================================================== */
import {
  estado, ELEMENTOS, el, precio, distancia, nombreProducto, enlaceGoogle,
  aviso, reducirMovimiento, pantallaEstrecha,
} from './comun.js';
import {
  valorDe, esPublica, horarioDe, tramo, TEXTO_TRAMO, textoHorario, estacionesVisibles,
} from './analisis.js';
import { resaltarTarjeta, irATarjeta } from './panel.js';

const CELDA_AGRUPACION_PX = 74;

let mapa = null;
let capaMarcadores = null;
let capaRuta = null;
let capaVector = null;
let capaCallejero = null;
let ultimaCapaRaster = null;
let marcadorUsuario = null;
const marcadores = new Map();

export const tieneMarcador = (id) => marcadores.has(id);

/* ------------------------------------------------------------------ *
 * Creación y capas
 * ------------------------------------------------------------------ */
export function redimensionarMapa() {
  if (!mapa) return;
  mapa.invalidateSize();
  if (capaVector) capaVector.redimensionar();
}

/** Si la capa vectorial falla, se vuelve a la última capa raster usada. */
function volverACapaRaster(mensaje) {
  aviso(mensaje, 'error');
  const anterior = ultimaCapaRaster || capaCallejero;
  if (mapa.hasLayer(capaVector)) mapa.removeLayer(capaVector);
  if (anterior && !mapa.hasLayer(anterior)) mapa.addLayer(anterior);
}

export function recargarEstiloVector() {
  if (capaVector) capaVector.recargarEstilo();
}

/* El autoPan de un popup emite `moveend` mientras el popup aún se está
   abriendo: repintar en ese momento lo destruiría a medias. Se aplaza y se
   agrupan los movimientos seguidos en un solo repintado. */
let repintadoPendiente = false;
function programarRepintado() {
  if (repintadoPendiente) return;
  repintadoPendiente = true;
  setTimeout(() => {
    repintadoPendiente = false;
    pintarMarcadores();
  }, 0);
}

export function crearMapa() {
  mapa = L.map(ELEMENTOS.mapa, { center: [40.4637, -3.7492], zoom: 6, zoomControl: true, attributionControl: true });

  capaVector = window.iGasofaVector.crear({
    contenedor: ELEMENTOS.mapaFondo,
    envoltorio: ELEMENTOS.mapaWrap,
    indicador: ELEMENTOS.mapaCargando,
    obtenerClave: () => estado.carto.clave,
    alFallar: volverACapaRaster,
  });

  const capas = {
    'Estilo Google · Vector': capaVector,
    'Callejero': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }),
    'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
    }),
  };

  // Capa de reserva: si la vectorial no puede cargarse se cae a esta.
  capaCallejero = capas['Callejero'];
  capaVector.addTo(mapa);

  L.control.layers(capas, null, { position: 'topright', collapsed: true }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);

  capaRuta = L.layerGroup().addTo(mapa);
  capaMarcadores = L.layerGroup().addTo(mapa);
  mapa.on('layeradd', (e) => {
    if (e.layer instanceof L.TileLayer) ultimaCapaRaster = e.layer;
  });
  // Al acercar se muestran más precios y al alejar menos, para que no se
  // solapen. `moveend` también se emite al terminar un zoom.
  mapa.on('moveend', programarRepintado);
}

export function marcarUsuario(lat, lon) {
  if (marcadorUsuario) {
    marcadorUsuario.setLatLng([lat, lon]);
    return;
  }
  marcadorUsuario = L.marker([lat, lon], {
    icon: L.divIcon({ className: 'pin', html: '<div class="pin-yo"></div>', iconSize: [16, 16], iconAnchor: [0, 0] }),
    zIndexOffset: 1000,
    interactive: false,
    keyboard: false,
    title: 'Tu ubicación',
  }).addTo(mapa);
  const nodo = marcadorUsuario.getElement();
  if (nodo) {
    nodo.setAttribute('role', 'img');
    nodo.setAttribute('aria-label', 'Tu ubicación');
  }
}

export function quitarUsuario() {
  if (!marcadorUsuario) return;
  marcadorUsuario.remove();
  marcadorUsuario = null;
}

/* ------------------------------------------------------------------ *
 * Ruta
 * ------------------------------------------------------------------ */
function marcadorExtremo(punto, letra, titulo) {
  const m = L.marker([punto.lat, punto.lon], {
    icon: L.divIcon({ className: 'pin', html: `<div class="pin-extremo">${letra}</div>`, iconSize: [28, 28], iconAnchor: [0, 0] }),
    zIndexOffset: 1300,
    keyboard: false,
    interactive: false,
  });
  m.addTo(capaRuta);
  const nodo = m.getElement();
  if (nodo) {
    nodo.setAttribute('role', 'img');
    nodo.setAttribute('aria-label', titulo);
  }
}

export function pintarRuta(ruta) {
  capaRuta.clearLayers();
  if (!ruta) return;
  // Un borde blanco bajo la línea la separa del fondo del mapa.
  L.polyline(ruta.coords, { color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(capaRuta);
  L.polyline(ruta.coords, { color: '#1a73e8', weight: 5, opacity: 0.9, interactive: false }).addTo(capaRuta);
  marcadorExtremo(ruta.origen, 'A', `Origen: ${ruta.origen.nombre}`);
  marcadorExtremo(ruta.destino, 'B', `Destino: ${ruta.destino.nombre}`);
}

export function encuadrarRuta(ruta) {
  mapa.fitBounds(L.latLngBounds(ruta.coords), { padding: [40, 40], animate: !reducirMovimiento() });
}

/** Encuadra el mapa para que quepa todo el radio de búsqueda. */
export function encuadrar(centro, radioKm) {
  const limites = L.latLng(centro.lat, centro.lon).toBounds(radioKm * 1000);
  mapa.fitBounds(limites, { padding: [36, 36], animate: !reducirMovimiento(), duration: 0.8 });
}

/* ------------------------------------------------------------------ *
 * Marcadores
 * ------------------------------------------------------------------ */

/** Nombre accesible y título para los marcadores (Leaflet no los genera). */
function etiquetarMarcador(marcador, texto) {
  const nodo = marcador.getElement();
  if (!nodo) return;
  nodo.setAttribute('aria-label', texto);
  nodo.setAttribute('title', texto);
}

function posicion(est) {
  return estado.modo === 'ruta'
    ? `km ${Math.round(est.kmRuta)} de la ruta, a ${distancia(est.desvio)}`
    : distancia(est.distancia);
}

function descripcionMarcador(est, valor, esMejor) {
  const conPrecio = typeof valor === 'number';
  const visible = conPrecio ? `${esMejor ? '★' : ''}${precio(valor)}` : '';
  const detalle = [
    est.rotulo,
    est.municipio || est.localidad,
    posicion(est),
    conPrecio ? nombreProducto() : 'sin precio publicado',
    esMejor ? 'mejor precio' : TEXTO_TRAMO[tramo(valor)],
    horarioDe(est).abierta === false ? 'cerrada ahora' : '',
  ].filter(Boolean);
  return visible ? `${visible} — ${detalle.join(', ')}` : detalle.join(', ');
}

function iconoPrecio(est, valor, esMejor) {
  const clases = ['pin-precio'];
  if (esMejor) clases.push('mejor');
  else if (tramo(valor)) clases.push(`t-${tramo(valor)}`);
  if (horarioDe(est).abierta === false) clases.push('cerrada');
  const estrella = esMejor ? '<span class="pin-estrella" aria-hidden="true">★</span>' : '';
  return L.divIcon({
    className: 'pin',
    html: `<div class="${clases.join(' ')}">${estrella}${precio(valor)}</div>`,
    iconSize: null,
    iconAnchor: [0, 0],
  });
}

function iconoSinPrecio() {
  return L.divIcon({ className: 'pin', html: '<div class="pin-sin-precio"></div>', iconSize: [24, 24], iconAnchor: [0, 0] });
}

function iconoCluster(cantidad, minPrecio) {
  const tam = cantidad > 99 ? 42 : cantidad > 9 ? 36 : 30;
  // El precio mínimo se pinta con un pseudo-elemento: así el texto visible
  // del marcador es sólo el número y el nombre accesible lo describe entero.
  const dato = typeof minPrecio === 'number' ? ` data-precio="${precio(minPrecio)} €"` : '';
  const clase = tramo(minPrecio) ? ` t-${tramo(minPrecio)}` : '';
  return L.divIcon({
    className: 'pin',
    html: `<div class="pin-cluster${clase}" style="--tam:${tam}px"${dato}><span class="cluster-n">${cantidad}</span></div>`,
    iconSize: [tam, tam],
    iconAnchor: [0, 0],
  });
}

function contenidoPopup(est) {
  const cont = el('div', 'popup');
  cont.appendChild(el('div', 'popup-titulo', est.rotulo));
  cont.appendChild(el('div', 'popup-sub',
    `${est.direccion}${est.municipio ? ' · ' + est.municipio : ''} — ${posicion(est)}`));

  const h = textoHorario(horarioDe(est), est);
  if (h) cont.appendChild(el('div', `popup-horario ${h.clase}`, h.texto));
  if (!esPublica(est)) cont.appendChild(el('div', 'popup-aviso', 'Venta restringida a socios o clientes autorizados'));

  const productos = estado.productos.filter((p) => typeof est.precios[p.key] === 'number');
  if (productos.length) {
    const tabla = el('table', 'popup-tabla');
    for (const p of productos) {
      const fila = el('tr', p.key === estado.producto ? 'popup-actual' : null);
      fila.append(el('td', null, p.nombre), el('td', null, `${precio(est.precios[p.key])} €/L`));
      tabla.appendChild(fila);
    }
    cont.appendChild(tabla);
  }

  const acciones = el('div', 'popup-acciones');
  const enlace = el('a', 'popup-enlace', 'Cómo llegar →');
  enlace.href = enlaceGoogle(est, 'ruta');
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  const ficha = el('button', 'popup-enlace popup-ficha', 'Ver en la lista');
  ficha.type = 'button';
  ficha.addEventListener('click', () => irATarjeta(est.id));
  acciones.append(enlace, ficha);
  cont.appendChild(acciones);
  return cont;
}

/**
 * Agrupa las estaciones en celdas de pantalla para evitar marcadores
 * superpuestos. Devuelve grupos con su centro geográfico.
 */
function agruparPorPantalla(estaciones) {
  const celdas = new Map();
  for (const est of estaciones) {
    const p = mapa.latLngToContainerPoint([est.lat, est.lon]);
    const key = `${Math.floor(p.x / CELDA_AGRUPACION_PX)}:${Math.floor(p.y / CELDA_AGRUPACION_PX)}`;
    if (!celdas.has(key)) celdas.set(key, []);
    celdas.get(key).push(est);
  }
  return [...celdas.values()].map((grupo) => ({
    grupo,
    lat: grupo.reduce((s, e) => s + e.lat, 0) / grupo.length,
    lon: grupo.reduce((s, e) => s + e.lon, 0) / grupo.length,
  }));
}

function marcadorEstacion(est, esMejor) {
  const valor = valorDe(est);
  const conPrecio = typeof valor === 'number';
  const m = L.marker([est.lat, est.lon], {
    icon: conPrecio ? iconoPrecio(est, valor, esMejor) : iconoSinPrecio(),
    zIndexOffset: esMejor ? 1200 : conPrecio ? 0 : -100,
    riseOnHover: true,
  });
  m.bindPopup(() => contenidoPopup(est), { closeButton: false, offset: [0, conPrecio ? -4 : 0] });
  m.on('popupopen', () => {
    estado.popupId = est.id;
    // Al reabrirlo tras un repintado no se mueve la lista: el usuario puede estar usándola.
    resaltarTarjeta(est.id, !estado.repintando);
  });
  m.on('popupclose', () => {
    if (!estado.repintando && estado.popupId === est.id) estado.popupId = null;
  });
  m.addTo(capaMarcadores);
  etiquetarMarcador(m, descripcionMarcador(est, valor, esMejor));
  marcadores.set(est.id, m);
}

function marcadorGrupo(resto, lat, lon) {
  const conPrecio = resto.map(valorDe).filter((v) => typeof v === 'number');
  const minimo = conPrecio.length ? Math.min(...conPrecio) : null;
  const c = L.marker([lat, lon], { icon: iconoCluster(resto.length, minimo), zIndexOffset: 100 });
  c.on('click', () => {
    mapa.setView([lat, lon], Math.min(18, mapa.getZoom() + 2), { animate: !reducirMovimiento() });
  });
  c.addTo(capaMarcadores);
  etiquetarMarcador(c, `Grupo de ${resto.length} gasolineras` +
    (minimo !== null ? `, precio mínimo ${precio(minimo)} euros por litro` : '') + '. Pulsa para ampliar.');
}

export function pintarMarcadores() {
  if (!capaMarcadores) return;
  // Al repintar se destruyen los marcadores: el popup abierto se recuerda
  // para volver a abrirlo en el marcador nuevo.
  estado.repintando = true;
  capaMarcadores.clearLayers();
  marcadores.clear();

  const visibles = estacionesVisibles();
  const mejor = estado.stats && visibles.includes(estado.stats.mejor.est) ? estado.stats.mejor.est : null;
  for (const { grupo, lat, lon } of agruparPorPantalla(visibles)) {
    // La mejor gasolinera siempre se muestra aparte (se dibuja al final).
    const resto = mejor ? grupo.filter((e) => e !== mejor) : grupo;
    if (resto.length === 1) marcadorEstacion(resto[0], false);
    else if (resto.length > 1) marcadorGrupo(resto, lat, lon);
  }
  if (mejor) marcadorEstacion(mejor, true);

  const abierto = estado.popupId && marcadores.get(estado.popupId);
  if (abierto) abierto.openPopup();
  estado.repintando = false;
}

/* ------------------------------------------------------------------ *
 * Navegación
 * ------------------------------------------------------------------ */

/** En móvil se alterna entre la lista y el mapa con las pestañas inferiores. */
export function cambiarVista(vista) {
  estado.vista = vista;
  document.body.dataset.vista = vista;
  for (const t of ELEMENTOS.tabs) t.setAttribute('aria-pressed', String(t.dataset.vista === vista));
  if (vista === 'mapa') setTimeout(redimensionarMapa, 0);
}

export function enfocar(est) {
  estado.popupId = est.id;
  estado.seleccionada = est.id;
  if (pantallaEstrecha()) cambiarVista('mapa');
  const zoom = marcadores.has(est.id) ? Math.max(14, mapa.getZoom()) : 16;
  if (reducirMovimiento()) mapa.setView([est.lat, est.lon], zoom);
  else mapa.flyTo([est.lat, est.lon], zoom, { duration: 0.7 });
  // `moveend` repinta y abre el popup; si el mapa no tuvo que moverse, se abre aquí.
  setTimeout(() => {
    const m = marcadores.get(est.id);
    if (m && !m.isPopupOpen()) m.openPopup();
  }, 900);
}

export function cerrarPopup() {
  if (mapa) mapa.closePopup();
}

export function alternarPantallaCompleta(activar) {
  const full = typeof activar === 'boolean' ? activar : !ELEMENTOS.mapaWrap.classList.contains('full');
  document.body.classList.toggle('mapa-full', full);
  ELEMENTOS.mapaWrap.classList.toggle('full', full);
  ELEMENTOS.btnMapa.setAttribute('aria-pressed', String(full));
  ELEMENTOS.btnMapa.setAttribute('aria-label', full ? 'Salir de pantalla completa' : 'Ampliar mapa');
  ELEMENTOS.btnMapa.title = full ? 'Salir de pantalla completa (Esc)' : 'Ver el mapa a pantalla completa';
  setTimeout(redimensionarMapa, 260);
}
