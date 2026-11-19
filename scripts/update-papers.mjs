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

  if (changed) {
    papers.sort((a, b) => (b.year || 0) - (a.year || 0)); // stable: keeps hand order within a year
    await writeFile(DATA, `${JSON.stringify(papers, null, 2)}\n`);
  } else {
    console.log('No new papers.');
  }
  await renderSite(papers);
}

// ---------- Static output for search engines ----------
//
// The cards are also written straight into index.html (between the
// papers:start/end markers), with schema.org data for each paper and a
// sitemap listing the page and the PDFs, so crawlers that don't run
// JavaScript still see the papers. js/papers.js reuses these cards.

const SITE = 'https://charlyreux.github.io/';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cardHtml = (p) => `        <li class="paper" data-pdf="${esc(p.pdf)}" data-page="${p.previewPage || 1}">
          <div class="paper__preview" aria-hidden="true"></div>
          <div class="paper__body">
            <h4>${esc(p.title)}</h4>
            <p class="paper__meta">${esc(p.authors)} · ${esc(p.venue)} ${esc(p.year)}</p>
            <p class="paper__summary">${esc(p.summary)}</p>
            <button class="paper__more" type="button">Show more</button>
            <div class="paper__actions">
              <a class="paper__link" href="${esc(p.pdf)}" download>Download PDF</a>${p.halId ? `
              <a class="paper__alt" href="https://hal.science/${esc(p.halId)}" target="_blank" rel="noopener">View on HAL<span class="sr-only"> (opens in a new tab)</span></a>` : ''}
            </div>
          </div>
        </li>`;

const paperLd = (p) => ({
  '@type': 'ScholarlyArticle',
  headline: p.title,
  author: p.authors.split(',').map((name) => ({ '@type': 'Person', name: name.trim() })),
  datePublished: String(p.year),
  ...(p.venue !== 'Preprint' && { isPartOf: { '@type': 'PublicationEvent', name: p.venue } }),
  abstract: p.summary,
  url: p.halId ? `https://hal.science/${p.halId}` : SITE + p.pdf,
  encoding: { '@type': 'MediaObject', contentUrl: SITE + p.pdf, encodingFormat: 'application/pdf' },
});

const between = (text, start, end, inner) => {
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`Markers not found: ${start}`);
  return text.slice(0, a + start.length) + inner + text.slice(b);
};

async function renderSite(papers) {
  let html = await readFile('index.html', 'utf8');
  html = between(html, '<!-- papers:start (generated by scripts/update-papers.mjs) -->', '      <!-- papers:end -->',
    `\n${papers.map(cardHtml).join('\n')}\n`);
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': papers.map(paperLd) }, null, 2).replace(/^/gm, '  ');
  html = between(html, '<!-- papers-ld:start (generated by scripts/update-papers.mjs) -->', '  <!-- papers-ld:end -->',
    `\n  <script type="application/ld+json">\n${ld}\n  </script>\n`);
  await writeFile('index.html', html);

  // No <lastmod>: it's optional, and a date would make every weekly run commit.
  const urls = [SITE, ...papers.map((p) => SITE + p.pdf)];
  await writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`);
  console.log(`Rendered ${papers.length} papers into index.html and sitemap.xml.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
