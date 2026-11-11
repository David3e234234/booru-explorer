// Applies `state.currentSite` to every surface that visualizes it: the source
// panel highlight, the header label, capability-gated filter controls and the
// Pawchive/Kemono platform dropdowns.
//
// A site switch that updates only part of this list is the bug this module
// exists to prevent. The author jump used to set the state and the capabilities
// but skip the panel, so the sidebar kept the previous source highlighted while
// the gallery showed another one; the active source then looked selected but
// clicking it was a no-op, because the state already matched it.
import { state } from '../state.js';
import { updateSiteCapabilitiesUI } from './filtersUI.js';
import { syncSourceSelectionUI } from './navigationUI.js';
import { ensurePawchiveServiceOptions, ensureKemonoServiceOptions } from './serviceOptions.js';

export function applyCurrentSiteUi() {
  updateSiteCapabilitiesUI(state.currentSite);
  syncSourceSelectionUI();
  if (state.currentSite === 'pawchive') ensurePawchiveServiceOptions();
  if (state.currentSite === 'kemono') ensureKemonoServiceOptions();
}
