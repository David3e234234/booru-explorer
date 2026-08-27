import { resolvePawchiveAuthor } from '../src/parsers/pawchive.js';

for (const svc of ['fanbox', 'patreon', null]) {
  const r = await resolvePawchiveAuthor('hideakiaki', svc);
  console.log('preferred:', svc || '(none)', '=>', r ? `${r.service}:${r.user} "${r.name}"` : 'null');
}
