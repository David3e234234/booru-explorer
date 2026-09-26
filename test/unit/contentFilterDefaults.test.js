import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../../src/config/constants.js';
import { DEFAULT_CLIENT_SETTINGS, state } from '../../public/js/state.js';

const readRepoFile = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

// All three content-hiding switches are on out of the box. The same default is
// duplicated in five places, and a copy left behind means a fresh visitor sees
// a toggled slider that does nothing until they reload the settings.
const FILTERS = ['hideFurry', 'hidePregnant', 'hideLgbt'];

describe('Content filter defaults', () => {
  it('enables all three filters on the server', () => {
    for (const field of FILTERS) {
      assert.strictEqual(DEFAULT_SETTINGS[field], true, `${field} must default to true`);
    }
  });

  it('enables all three filters for the client', () => {
    for (const field of FILTERS) {
      assert.strictEqual(DEFAULT_CLIENT_SETTINGS[field], true, `${field} must default to true`);
      assert.strictEqual(state[field], true, `state.${field} must start as true`);
    }
  });

  it('renders all three switches as checked in the sidebar markup', () => {
    const html = readRepoFile('../../public/index.html');
    for (const id of ['checkHideFurry', 'checkHidePregnant', 'checkHideLgbt']) {
      const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert.ok(input, `${id} must exist in index.html`);
      assert.ok(/\schecked(\s|>|=)/.test(input[0]), `${id} must carry the checked attribute`);
    }
  });

  it('defaults the fetchPosts query parameters to enabled', () => {
    const api = readRepoFile('../../public/js/api.js');
    for (const field of FILTERS) {
      assert.ok(
        api.includes(`${field} = true,`),
        `api.js must default ${field} to true`
      );
    }
  });

  // The reset button is a user-facing promise about the default, so leaving it
  // on the old values would silently switch LGBT filtering back off.
  it('resets the switches back to enabled', () => {
    const app = readRepoFile('../../public/js/app.js');
    assert.ok(app.includes('state.hideLgbt = true;'), 'reset must enable state.hideLgbt');
    assert.ok(app.includes('checkHideLgbt.checked = true'), 'reset must check the LGBT switch');
    assert.ok(!app.includes('state.hideLgbt = false;'), 'reset must not disable hideLgbt again');
  });

  // The amber dot marks "the user changed something". It compares against the
  // defaults, so the comparison has to be negated for every enabled-by-default
  // switch or the dot shows on a pristine feed.
  it('treats a disabled switch as a custom filter state', () => {
    const filters = readRepoFile('../../public/js/modules/filtersUI.js');
    const line = filters.split('\n').find((l) => l.includes('supportsContentHiding &&'));
    assert.ok(line, 'the content-hiding condition must exist');
    for (const field of FILTERS) {
      assert.ok(line.includes(`!state.${field}`), `the dot condition must negate ${field}`);
    }
  });
});
