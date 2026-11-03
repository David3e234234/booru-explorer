// Pawchive and Kemono platform dropdowns: service options are loaded once from
// the server and injected into the static dropdown markup.
import { state } from '../state.js';
import { fetchPawchiveServices, fetchKemonoServices } from '../api.js';
import {
  updatePawchiveServiceUI,
  getPawchiveServiceLabel,
  updateKemonoServiceUI,
  getKemonoServiceLabel
} from './filtersUI.js';

let pawchiveServicesLoaded = false;
let pawchiveServicesLoading = null;

export async function ensurePawchiveServiceOptions() {
  if (pawchiveServicesLoaded) return;
  if (pawchiveServicesLoading) return pawchiveServicesLoading;

  pawchiveServicesLoading = (async () => {
    try {
      const data = await fetchPawchiveServices();
      const services = Array.isArray(data?.services) ? data.services.filter(s => s && s !== 'all') : [];
      const menu = document.getElementById('pawchiveServiceMenu');
      if (!menu) return;

      menu.querySelectorAll('.dropdown-item[data-dynamic="1"]').forEach(el => el.remove());
      for (const svc of services) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.dataset.service = svc;
        btn.dataset.dynamic = '1';
        btn.setAttribute('role', 'option');
        btn.textContent = getPawchiveServiceLabel(svc);
        menu.appendChild(btn);
      }
      if (services.length > 0) pawchiveServicesLoaded = true;
      updatePawchiveServiceUI();
    } catch (e) {
      console.warn('Не удалось загрузить список платформ Pawchive:', e);
    } finally {
      pawchiveServicesLoading = null;
    }
  })();

  return pawchiveServicesLoading;
}

let kemonoServicesLoaded = false;
let kemonoServicesLoading = null;

export async function ensureKemonoServiceOptions() {
  if (kemonoServicesLoaded) return;
  if (kemonoServicesLoading) return kemonoServicesLoading;

  kemonoServicesLoading = (async () => {
    try {
      const data = await fetchKemonoServices();
      const services = Array.isArray(data?.services) ? data.services.filter(s => s && s !== 'all') : [];
      const menu = document.getElementById('kemonoServiceMenu');
      if (!menu) return;

      menu.querySelectorAll('.dropdown-item[data-dynamic="1"]').forEach(el => el.remove());
      for (const svc of services) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.dataset.service = svc;
        btn.dataset.dynamic = '1';
        btn.setAttribute('role', 'option');
        btn.textContent = getKemonoServiceLabel(svc);
        menu.appendChild(btn);
      }
      if (services.length > 0) kemonoServicesLoaded = true;
      updateKemonoServiceUI();
    } catch (e) {
      console.warn('Не удалось загрузить список платформ Kemono:', e);
    } finally {
      kemonoServicesLoading = null;
    }
  })();

  return kemonoServicesLoading;
}
