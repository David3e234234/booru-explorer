// Live probe: how do Kemono and Pawchive accept username/password, and where
// does the session token come back? Run manually, never from the test suite.
const FORM = { username: '__probe_invalid__', password: '__probe_invalid__' };

async function probe(label, url, init) {
  try {
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const text = await res.text();
    const cookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    const err = (text.match(/form__error[^<]*<?[^<]{0,80}/i) || [])[0] || '';
    console.log(`\n=== ${label}`);
    console.log('url     :', url);
    console.log('status  :', res.status);
    console.log('location:', res.headers.get('location'));
    console.log('cookies :', cookies.length ? cookies.map(c => c.split(';')[0]).join(' | ') : '(none)');
    console.log('body    :', text.slice(0, 160).replace(/\s+/g, ' '));
    if (err) console.log('error   :', err.replace(/\s+/g, ' '));
  } catch (err) {
    console.log(`\n=== ${label}\nurl     : ${url}\nERROR   : ${err.message}`);
  }
}

const json = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(FORM) };
const form = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...FORM, location: '/artists' }) };

await probe('kemono json api', 'https://kemono.cr/api/v1/authentication/login', { ...json, headers: { ...json.headers, Accept: 'text/css' } });
await probe('kemono html form', 'https://kemono.cr/account/login', form);
await probe('pawchive json api', 'https://pawchive.pw/api/v1/authentication/login', json);
await probe('pawchive html form', 'https://pawchive.pw/account/login', form);
await probe('pawchive json on /account/login', 'https://pawchive.pw/account/login', json);
