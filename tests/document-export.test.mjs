import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { exportDocuments, documentFilename } from '../src/document-export.mjs';
import { PDFDocument } from '../vendor/document-libraries.mjs';

const fixture = (settings = {}) => ({ id: 'run-1', jobId: 'job-1', phase: 'complete', documentSettings: settings,
  job: { id: 'job-1', input: { profile: { name: 'José Taylor' }, job: { company: 'A&B <Labs>', role: 'Senior Engineer' } } },
  result: { resume: { company: 'A&B <Labs>', title: 'Software Engineer', summary: 'Builds accessible, reliable applications with TypeScript.',
    contact: { email: 'jose@example.test', website: 'https://example.test/jose' },
    skills: [{ 'Technical skills': ['TypeScript', 'SQL'] }],
    experience: [{ title: 'Engineer', company: 'Example Corp', startDate: '2020', endDate: 'Present', location: 'New York', sentences: ['Built tools & improved accessibility.', 'Collaborated with designers <and> engineers.'] }],
    education: [{ degree: 'B.S. Computer Science', institution: 'Example University', startDate: '2016', endDate: '2020', location: 'Boston' }] },
    coverLetter: 'Dear hiring team,\n\nI would bring my engineering experience to A&B <Labs>.\n\nSincerely,\nJosé Taylor' }
});
const options = { loadAsset: url => readFile(url) };

test('per-document exports contain only the selected saved document', async () => {
  for (const kind of ['resume','cover-letter']) {
    const run = fixture({ formats: ['json'], includeCoverLetter: true });
    const result = await exportDocuments(run, { ...options, kinds: [kind] });
    assert.equal(result.files.length, 1); assert.equal(result.files[0].kind, kind);
    const contents = JSON.parse(new TextDecoder().decode(result.files[0].bytes));
    assert.equal(Object.hasOwn(contents, kind === 'resume' ? 'coverLetter' : 'resume'), false);
  }
  await assert.rejects(exportDocuments(fixture({includeCoverLetter:false}),{...options,kinds:['cover-letter']}), /unavailable/);
});
function unzip(bytes) {
  const data = Buffer.from(bytes), entries = new Map();
  let at = 0;
  while (at + 46 <= data.length) {
    if (data.readUInt32LE(at) !== 0x02014b50) { at++; continue; }
    const method = data.readUInt16LE(at + 10), compressedSize = data.readUInt32LE(at + 20), nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30), commentLength = data.readUInt16LE(at + 32), local = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(data.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const compressed = data.subarray(start, start + compressedSize);
    entries.set(name, (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('default export creates separate resume and cover-letter PDFs with embedded fonts', async () => {
  const { files, errors } = await exportDocuments(fixture(), options);
  assert.deepEqual(errors, []);
  assert.deepEqual(files.map(file => [file.kind, file.format]), [['resume', 'pdf'], ['cover-letter', 'pdf']]);
  for (const file of files) {
    assert.equal(file.mime, 'application/pdf');
    assert.equal(new TextDecoder().decode(file.bytes.slice(0, 5)), '%PDF-');
    const document = await PDFDocument.load(file.bytes);
    assert.equal(document.getPageCount(), 1); assert.equal(document.getAuthor(), 'José Taylor');
    assert.match(document.getTitle(), /José Taylor/);
    assert.ok(file.bytes.length > 2000, 'font subsets and document text are embedded');
    assert.ok(document.context.enumerateIndirectObjects().some(([, object]) => object.toString().includes('/ToUnicode')), 'PDF text has Unicode extraction mappings');
  }
});

test('PDF wraps long content across pages and keeps dates, contacts and sections', async () => {
  const run = fixture({ includeCoverLetter: false, formats: ['pdf'] });
  run.result.resume.summary = 'Reliable application development and accessible user experiences. '.repeat(150);
  const { files: [file], errors } = await exportDocuments(run, options), document = await PDFDocument.load(file.bytes);
  assert.deepEqual(errors, []);
  assert.ok(document.getPageCount() >= 2);
  assert.ok(document.getPages().every(page => page.getWidth() === 612 && page.getHeight() === 792));
  assert.equal(file.kind, 'resume');
});

test('multi-select exports valid Word archives and exact JSON documents with escaped Unicode text', async () => {
  const run = fixture({ formats: ['docx', 'json'] }); run.job.input.profile.name = '李 José Taylor';
  const { files, errors } = await exportDocuments(run, options);
  assert.deepEqual(errors, []);
  assert.equal(files.length, 4);
  for (const file of files.filter(file => file.format === 'docx')) {
    const entries = unzip(file.bytes);
    assert.ok(entries.has('[Content_Types].xml')); assert.ok(entries.has('word/document.xml'));
    const xml = entries.get('word/document.xml');
    assert.match(xml, /李 José Taylor/); assert.doesNotMatch(xml, /<Labs>|<and>/);
    if (file.kind === 'resume') {
      assert.match(xml, /2020 – Present/); assert.match(xml, /2016 – 2020/); assert.match(xml, /Boston/);
      assert.match(xml, /jose@example.test/); assert.match(xml, /Education/);
      assert.match(xml, /designers &lt;and&gt; engineers/);
    } else assert.match(xml, /A&amp;B &lt;Labs&gt;/);
    assert.match(file.previewText, /李 José Taylor/);
  }
  for (const file of files.filter(file => file.format === 'json')) {
    const value = JSON.parse(new TextDecoder().decode(file.bytes));
    assert.equal(value.requestId, run.jobId); assert.equal(value.runId, run.id);
    if (file.kind === 'resume') assert.deepEqual(value.resume, run.result.resume);
    else assert.equal(value.coverLetter, run.result.coverLetter);
  }
});

test('disabled cover letters are never exported even if older results contain one', async () => {
  const { files, errors } = await exportDocuments(fixture({ includeCoverLetter: false, formats: ['json', 'docx'] }), options);
  assert.deepEqual(errors, []);
  assert.equal(files.length, 2); assert.ok(files.every(file => file.kind === 'resume'));
});

test('filenames cannot contain path separators, control characters or reserved Windows basenames', () => {
  const filename = documentFilename('../CON\\name\u0000', 'a:b?c*<>|"', 'resume', 'pdf');
  assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f]/); assert.match(filename, /\.pdf$/);
  assert.ok(documentFilename('a'.repeat(500), 'b'.repeat(500), 'cover-letter', 'docx').length < 150);
  assert.ok(new TextEncoder().encode(documentFilename('李'.repeat(500), '', 'cover-letter', 'docx')).length < 220);
  assert.match(documentFilename('CON', '', 'resume', 'pdf'), /^_CON/);
});

test('unvalidated results cannot be exported and unsupported PDF glyphs leave other formats usable', async () => {
  await assert.rejects(exportDocuments({ ...fixture(), phase: 'invalid' }, options), /Only validated/);
  const run = fixture({ formats: ['pdf', 'docx', 'json'] }); run.job.input.profile.name = '李 Taylor';
  const { files, errors } = await exportDocuments(run, options);
  assert.equal(files.length, 4); assert.ok(files.every(file => file.format !== 'pdf'));
  assert.equal(errors.length, 2); assert.ok(errors.every(error => error.format === 'pdf' && /U\+674E/.test(error.message)));
});
