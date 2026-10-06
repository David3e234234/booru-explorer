import { state, saveLocalSettings } from '../state.js';
import { saveSettings } from '../api.js';

export function persistSettings(partial) {
  state.settings = { ...state.settings, ...partial };
  saveLocalSettings(state.settings);
  saveSettings(state.settings).catch(() => {});
}
