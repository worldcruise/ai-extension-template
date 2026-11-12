import { PDFDocument, rgb, fontkit, Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from '../vendor/document-libraries.mjs';
import { normalizeDocumentSettings } from './document-settings.mjs';

const formats = {
  pdf: { mime: 'application/pdf', extension: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' },
  json: { mime: 'application/json', extension: 'json' }
};
const fontUrls = [new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url), new URL('../assets/fonts/NotoSans-Bold.ttf', import.meta.url)];
const text = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const joined = values => values.filter(Boolean).map(text).join(' · ');
const dates = value => [value.startDate, value.endDate].filter(Boolean).map(text).join(' – ');
const recordDetails = value => joined([dates(value), value.location]);
const encoder = new TextEncoder();

export function documentFilename(name, company, kind, format) {
  const source = joined([name, company]).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  let shortened = '';
  for (const character of source) {
    if (shortened.length + character.length > 110 || encoder.encode(shortened + character).length > 170) break;
    shortened += character;
  }
  const stem = shortened.replace(/[. ]+$/g, '') || 'Application';
  const safe = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? '_' + stem : stem;
  return `${safe} - ${kind === 'cover-letter' ? 'Cover letter' : 'Resume'}.${formats[format].extension}`;
}

function blocksFor(run, kind) {
  const profile = run.job.input.profile, job = run.job.input.job, resume = run.result.resume;
  const blocks = [{ type: 'name', value: text(profile.name) }];
  if (kind === 'resume') blocks.push({ type: 'subtitle', value: text(resume.title) });
  const contact = joined(Object.values(resume.contact || profile.contact || {}));
  if (contact) blocks.push({ type: 'contact', value: contact });
  if (kind === 'cover-letter') {
    blocks.push({ type: 'section', value: 'Cover letter' });
    const context = joined([job.company, job.role]);
    if (context) blocks.push({ type: 'record', value: context });
    for (const paragraph of text(run.result.coverLetter).split(/\n\s*\n/).filter(Boolean)) blocks.push({ type: 'paragraph', value: paragraph });
    return blocks;
  }
  blocks.push({ type: 'section', value: 'Summary' }, { type: 'paragraph', value: text(resume.summary) });
  if (resume.skills?.length) {
    blocks.push({ type: 'section', value: 'Skills' });
    for (const group of resume.skills) for (const [name, values] of Object.entries(group)) {
      blocks.push({ type: 'paragraph', value: `${text(name)}: ${values.map(text).join(', ')}` });
    }
  }
  if (resume.experience?.length) {
    blocks.push({ type: 'section', value: 'Experience' });
    for (const item of resume.experience) {
      blocks.push({ type: 'record', value: joined([item.title, item.company]) });
      const details = recordDetails(item);
      if (details) blocks.push({ type: 'contact', value: details });
      for (const sentence of item.sentences || []) blocks.push({ type: 'bullet', value: text(sentence) });
    }
  }
  if (resume.education?.length) {
    blocks.push({ type: 'section', value: 'Education' });
    for (const item of resume.education) {
      blocks.push({ type: 'record', value: joined([item.degree, item.institution]) });
      const details = recordDetails(item);
      if (details) blocks.push({ type: 'contact', value: details });
    }
  }
  return blocks;
}

const loadAsset = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The PDF fonts could not be loaded. Reload the extension and try again.');
  return new Uint8Array(await response.arrayBuffer());
};

function wrap(value, font, size, maximum) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(combined, size) <= maximum) { line = combined; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && font.widthOfTextAtSize(line + character, size) > maximum) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function pdfBytes(run, kind, blocks, readAsset) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all(fontUrls.map(readAsset));
  const [regular, bold] = await Promise.all([pdf.embedFont(regularBytes, { subset: true }), pdf.embedFont(boldBytes, { subset: true })]);
  const supported = new Set(regular.getCharacterSet());
  for (const block of blocks) for (const character of Array.from(block.value)) {
    if (!/\s/.test(character) && !supported.has(character.codePointAt(0))) {
      throw new Error(`The PDF font does not support U+${character.codePointAt(0).toString(16).toUpperCase()}. Select Word or JSON to preserve this document's text.`);
    }
  }
  const title = `${kind === 'resume' ? 'Resume' : 'Cover letter'} · ${run.job.input.profile.name}`;
  pdf.setTitle(title); pdf.setAuthor(text(run.job.input.profile.name)); pdf.setCreator('AI Agent Template');
  pdf.setSubject(joined([run.job.input.job.company, run.job.input.job.role]));
  const width = 612, height = 792, margin = 48, bottom = 48;
  const ink = rgb(0.12, 0.16, 0.2), muted = rgb(0.35, 0.4, 0.45), accent = rgb(0.1, 0.28, 0.35);
  let page, y;
  const newPage = () => { page = pdf.addPage([width, height]); y = height - margin; };
  newPage();
  const styles = {
    name: { size: 22, font: bold, before: 0, after: 5 },
    subtitle: { size: 12, font: regular, before: 0, after: 6 },
    contact: { size: 9, font: regular, before: 0, after: 5, color: muted },
    section: { size: 11, font: bold, before: 13, after: 7, color: accent, keep: 32 },
    record: { size: 10.5, font: bold, before: 7, after: 4, keep: 18 },
    paragraph: { size: 10.5, font: regular, before: 0, after: 7 },
    bullet: { size: 10.5, font: regular, before: 0, after: 4, indent: 12 }
  };
  for (const block of blocks) {
    const style = styles[block.type], leading = style.size * 1.4;
    const lines = wrap(block.value, style.font, style.size, width - margin * 2 - (style.indent || 0));
    if (y - style.before - leading - (style.keep || 0) < bottom) newPage();
    y -= style.before;
    for (let index = 0; index < lines.length; index++) {
      if (y - leading < bottom) newPage();
      y -= leading;
      if (block.type === 'bullet' && index === 0) page.drawText('•', { x: margin, y, size: style.size, font: regular, color: ink });
      if (lines[index]) page.drawText(lines[index], { x: margin + (style.indent || 0), y, size: style.size, font: style.font, color: style.color || ink });
    }
    if (block.type === 'section') page.drawLine({ start: { x: margin, y: y - 3 }, end: { x: width - margin, y: y - 3 }, thickness: 0.4, color: rgb(0.78, 0.82, 0.84) });
    y -= style.after;
  }
  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((item, index) => item.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 30, y: 24, font: regular, size: 8, color: muted }));
  return pdf.save();
}

function wordParagraph(block) {
  const style = {
    name: { size: 44, bold: true, after: 90 },
    subtitle: { size: 24, after: 100 },
    contact: { size: 18, color: '596673', after: 90 },
    section: { size: 22, bold: true, color: '194859', before: 240, after: 110 },
    record: { size: 21, bold: true, before: 120, after: 70 },
    paragraph: { size: 21, after: 110 },
    bullet: { size: 21, after: 70 }
  }[block.type];
  const lines = block.value.split('\n');
  const children = lines.map((value, index) => new TextRun({ text: value, font: 'Calibri', size: style.size, bold: style.bold, color: style.color || '1F2933', ...(index ? { break: 1 } : {}) }));
  return new Paragraph({ children, alignment: AlignmentType.LEFT,
    ...(block.type === 'section' ? { heading: HeadingLevel.HEADING_1 } : {}),
    ...(block.type === 'bullet' ? { bullet: { level: 0 } } : {}),
    keepNext: ['name', 'subtitle', 'section', 'record'].includes(block.type),
    spacing: { before: style.before || 0, after: style.after, line: 280 },
    widowControl: true
  });
}

async function wordBytes(run, kind, blocks) {
  const doc = new Document({ creator: 'AI Agent Template', title: `${run.job.input.profile.name} · ${kind === 'resume' ? 'Resume' : 'Cover letter'}`,
    description: joined([run.job.input.job.company, run.job.input.job.role]),
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 960, bottom: 960, left: 960, right: 960 } } }, children: blocks.map(wordParagraph) }]
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportDocuments(run, { loadAsset: readAsset = loadAsset, kinds: selectedKinds } = {}) {
  if (run?.phase !== 'complete' || !run.result?.resume || !run.job?.input?.profile) throw new Error('Only validated, completed documents can be downloaded.');
  const settings = normalizeDocumentSettings(run.documentSettings), files = [], errors = [];
  let kinds = ['resume'];
  if (settings.includeCoverLetter && run.result.coverLetter?.trim()) kinds.push('cover-letter');
  if (selectedKinds) kinds = kinds.filter(kind => selectedKinds.includes(kind));
  if (!kinds.length) throw new Error('The selected saved document is unavailable.');
  let fontBytes;
  const cachedAsset = url => {
    fontBytes ||= new Map();
    if (!fontBytes.has(url.href)) fontBytes.set(url.href, Promise.resolve().then(() => readAsset(url)));
    return fontBytes.get(url.href);
  };
  for (const format of settings.formats) for (const kind of kinds) {
    try {
      const blocks = format === 'json' ? null : blocksFor(run, kind);
      const envelope = { schemaVersion: 1, requestId: run.jobId || run.job.id, runId: run.id,
        ...(kind === 'resume' ? { resume: run.result.resume } : { coverLetter: run.result.coverLetter }) };
      const previewText = format === 'json' ? JSON.stringify(envelope, null, 2) + '\n' : blocks.map(block => (block.type === 'bullet' ? '• ' : '') + block.value).join('\n\n');
      const bytes = format === 'pdf' ? await pdfBytes(run, kind, blocks, cachedAsset) : format === 'docx' ? await wordBytes(run, kind, blocks) : encoder.encode(previewText);
      files.push({ kind, format, filename: documentFilename(run.job.input.profile.name, run.job.input.job.company, kind, format), mime: formats[format].mime, bytes, previewText });
    } catch (error) {
      errors.push({ kind, format, message: error.message || `The ${format.toUpperCase()} document could not be created.` });
    }
  }
  return { files, errors };
}
