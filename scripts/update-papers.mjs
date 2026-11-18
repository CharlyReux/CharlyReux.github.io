// Updates data/papers.json (and assets/papers/*.pdf) from HAL.
//
//   node scripts/update-papers.mjs
//
// Run weekly by .github/workflows/update-papers.yml. It only ever adds:
//   - new HAL papers with a PDF get downloaded and appended, with their HAL
//     abstract as the summary (the site shows the first lines + "Show more");
//   - a paper still listed as "Preprint" picks up its venue once HAL has one.
// Anything you edited by hand (titles, summaries, order) is left alone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const AUTHOR = 'Charly Reux';
const DATA = 'data/papers.json';
const PDF_DIR = 'assets/papers';
const HAL_API = 'https://api.archives-ouvertes.fr/search/';
const FIELDS = 'halId_s,title_s,authFullName_s,producedDateY_i,journalTitle_s,conferenceTitle_s,fileMain_s,abstract_s';

const initials = (name) => {
  const parts = name.trim().split(/\s+/);
  const last = parts.pop();
  return [...parts.map((p) => p.split('-').map((s) => `${s[0]}.`).join('-')), last].join(' ');
};

const venueOf = (doc) => {
  const raw = doc.conferenceTitle_s || doc.journalTitle_s;
  if (!raw) return 'Preprint';
  return raw.split(' - ')[0].replace(/['’]?\s*\d{2,4}$/, '').trim() || raw;
};

/** The paper's own HAL abstract, as plain text. */
const summaryOf = (doc) =>
  (doc.abstract_s?.[0] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:?!])/g, '$1')
    .trim();

const slugOf = (title) =>
  title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-[^-]*$/, '');

async function main() {
  const papers = JSON.parse(await readFile(DATA, 'utf8'));
  const url = `${HAL_API}?q=authFullName_s:%22${encodeURIComponent(AUTHOR)}%22&fl=${FIELDS}&rows=200&wt=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'personal-site-papers-updater' } });
  if (!res.ok) throw new Error(`HAL search failed: ${res.status}`);
  const docs = (await res.json()).response.docs;

  let changed = false;
  for (const doc of docs) {
    if (!doc.fileMain_s) continue; // no PDF deposited
    const existing = papers.find((p) => p.halId === doc.halId_s);
    const venue = venueOf(doc);

    if (existing) {
      if (existing.venue === 'Preprint' && venue !== 'Preprint') {
        existing.venue = venue;
        existing.year = doc.producedDateY_i || existing.year;
        console.log(`Published: ${existing.title} -> ${venue}`);
        changed = true;
      }
      continue;
    }

    const title = doc.title_s?.[0] || doc.halId_s;
    const pdf = `${PDF_DIR}/${slugOf(title) || doc.halId_s}.pdf`;
    const file = await fetch(doc.fileMain_s);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!file.ok || bytes.subarray(0, 5).toString() !== '%PDF-') {
      console.warn(`Skipping ${doc.halId_s}: could not download a PDF`);
      continue;
    }
    await mkdir(PDF_DIR, { recursive: true });
    await writeFile(pdf, bytes);

    papers.push({
      halId: doc.halId_s,
      title,
      authors: (doc.authFullName_s || []).map(initials).join(', '),
      venue,
      year: doc.producedDateY_i,
      pdf,
      previewPage: 2, // HAL PDFs start with a cover sheet
      summary: summaryOf(doc),
    });
    console.log(`Added: ${title}`);
    changed = true;
  }

  if (!changed) {
    console.log('No changes.');
    return;
  }
  papers.sort((a, b) => (b.year || 0) - (a.year || 0)); // stable: keeps hand order within a year
  await writeFile(DATA, `${JSON.stringify(papers, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
