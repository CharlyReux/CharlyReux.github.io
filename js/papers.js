/*
 * Paper previews for the research screen: renders a page of each card's PDF
 * (data-pdf; data-page picks the page, default 1 — HAL PDFs start with a cover
 * sheet, so those use 2) into its .paper__preview box with PDF.js. Cards whose
 * PDF isn't there yet keep the placeholder and get their link disabled.
 */

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168';
let pdfjs = null;

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function renderPreview(card) {
  const url = card.dataset.pdf;
  const box = card.querySelector('.paper__preview');
  const link = card.querySelector('.paper__link');

  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (!head || !head.ok) {
    card.classList.add('is-missing');
    link?.setAttribute('aria-disabled', 'true');
    link?.removeAttribute('href');
    return;
  }

  const lib = await loadPdfjs();
  const doc = await lib.getDocument(url).promise;
  const page = await doc.getPage(Math.min(Number(card.dataset.page) || 1, doc.numPages));
  const width = box.clientWidth || 160;
  const base = page.getViewport({ scale: 1 });
  const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2) * 1.5;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  box.replaceChildren(canvas);
  card.classList.add('has-preview');
}

/** One card from a data/papers.json entry. */
function paperCard(p) {
  const li = document.createElement('li');
  li.className = 'paper';
  li.dataset.pdf = p.pdf;
  li.dataset.page = p.previewPage || 1;

  const preview = document.createElement('div');
  preview.className = 'paper__preview';
  preview.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'paper__body';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    body.appendChild(e);
    return e;
  };
  el('h4', '', p.title);
  el('p', 'paper__meta', `${p.authors} · ${p.venue} ${p.year}`);
  el('p', 'paper__summary', p.summary); // the HAL abstract, clamped to a few lines
  const more = el('button', 'paper__more', 'Show more');
  more.type = 'button';
  more.addEventListener('click', () => {
    const open = li.classList.toggle('is-open');
    more.textContent = open ? 'Show less' : 'Show more';
  });
  const actions = document.createElement('div');
  actions.className = 'paper__actions';
  body.appendChild(actions);
  const dl = el('a', 'paper__link', 'Download PDF');
  actions.appendChild(dl);
  dl.href = p.pdf;
  dl.setAttribute('download', '');
  if (p.halId) {
    const hal = el('a', 'paper__alt', 'View on HAL');
    actions.appendChild(hal);
    hal.href = `https://hal.science/${p.halId}`;
    hal.target = '_blank';
    hal.rel = 'noopener';
  }

  li.append(preview, body);
  return li;
}

export async function initPapers() {
  const list = document.getElementById('papers');
  if (!list) return;
  const papers = await fetch('data/papers.json').then((r) => r.json()).catch(() => []);
  list.replaceChildren(...papers.map(paperCard));
  for (const card of list.querySelectorAll('.paper[data-pdf]')) {
    renderPreview(card).catch((err) => console.warn('Paper preview failed:', card.dataset.pdf, err));
  }
}
