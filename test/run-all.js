process.env.NODE_ENV = 'test';

// Central test runner importing all unit, parser, and integration suites
import './unit/tagHelpers.test.js';
import './unit/parsers/allgirl.test.js';
import './unit/parsers/danbooru.test.js';
import './unit/parsers/dapi.test.js';
import './unit/parsers/gelbooru.test.js';
import './unit/parsers/kemono.test.js';
import './unit/parsers/moebooru.test.js';
import './unit/parsers/pawchive.test.js';
import './unit/parsers/rule34.test.js';
import './unit/parsers/rule34video.test.js';
import './unit/parsers/safebooru.test.js';
import './unit/parsers/aggregator.test.js';
import './integration/routes.test.js';
