require('dotenv').config();
require('isomorphic-fetch');

/* todo require og stilla dót */
const cheerio = require('cheerio');
const redis = require('redis');
const util = require('util');

const cacheTtl = 7200000;

const redisOptions = {
  url: 'redis://127.0.0.1:6379/0',
};

const client = redis.createClient(redisOptions);

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);

/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */
const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
    id: '1',
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
    id: '2',
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
    id: '3',
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
    id: '4',
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
    id: '5',
  },
];

/**
 * Athugar hvort gögn séu til, ef ekki þá geyma í cache
 * @param {*} url - slóðin að gögnunum
 * @param {*} cacheKey - lykill á cache
 */
async function get(url, cacheKey) {
  const cached = await asyncGet(cacheKey);
  if (cached) {
    return cached;
  }
  const response = await fetch(url);
  const text = await response.text();

  await asyncSet(cacheKey, text, 'EX', cacheTtl);

  return text;
}

/**
 * finnur id útfrá slug
 * @param {*} slug
 */
function findSlugId(slug) {
  for (let i = 0; i < departments.length; i += 1) {
    if (departments[i].slug === slug) {
      return departments[i].id;
    }
  }
  return 0;
}

/**
 * finnur slug útfrá id
 * @param {*} id
 */
function findSlug(id) {
  for (let i = 0; i < departments.length; i += 1) {
    if (departments[i].id === id) {
      return departments[i].slug;
    }
  }
  return 0;
}

/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */
async function getTests(slug) {
  // finna id fyrir slug
  const id = findSlugId(slug);
  const url = `https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${id}&notaVinnuToflu=0`;
  const text = await get(url, slug);
  const data = JSON.parse(text);
  const $ = cheerio.load(data.html.toString());
  const titleElement = $('div h3');
  const tests = [];
  const tests2 = [];
  titleElement.each((i, el) => {
    const tableElement = $(`div > table:nth-child(${i + 1}) tbody tr`);
    const title = $(el);
    const heading = title.text();
    tableElement.each((i2, el2) => {
      const course = $(el2).find('td:nth-child(1)').text();
      const name = $(el2).find('td:nth-child(2)').text();
      const type = $(el2).find('td:nth-child(3)').text();
      const students = $(el2).find('td:nth-child(4)').text();
      const date = $(el2).find('td:nth-child(5)').text();

      tests2.push({
        course,
        name,
        type,
        students,
        date,
      });
    });

    tests.push({
      heading,
      tests2,
    });
  });
  return tests;
}
/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  return client.flushdb();
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  // fylki sem geymir öll próf
  const tests = [];
  // sækja öll próf
  for (let id = 1; id <= 2; id += 1) {
    const url = `https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${id}&notaVinnuToflu=0`;
    // athuga hvaða slug við erum að nota
    const slug = findSlug(id);
    const text = await get(url, slug);
    const data = JSON.parse(text);
    const $ = cheerio.load(data.html);
    const tableElement = $('div table tbody tr');
    tableElement.each((i, el) => {
      const course = $(el).find('td:nth-child(1)').text();
      const name = $(el).find('td:nth-child(2)').text();
      const type = $(el).find('td:nth-child(3)').text();
      const students = $(el).find('td:nth-child(4)').text();
      const date = $(el).find('td:nth-child(5)').text();

      tests.push({
        course,
        name,
        type,
        students,
        date,
      });
    });
  }

  const stats = [];
  const numTests = tests.length;
  let numStudents = 0;
  for (let i = 0; i < tests.length; i += 1) {
    const students = Number(tests[i].students);
    numStudents += students;
  }
  const averageStudents = (numStudents / numTests).toFixed(2);
  let min = 100000;
  for (let i = 0; i < tests.length; i += 1) {
    const students = Number(tests[i].students);
    if (students <= min) {
      min = students;
    }
  }
  let max = 0;
  for (let i = 0; i < tests.length; i += 1) {
    const students = Number(tests[i].students);
    if (students >= max) {
      max = students;
    }
  }
  stats.push({
    numTests,
    numStudents,
    averageStudents,
    min,
    max,
  });

  return stats;
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};
