const names = {
  company: ['company','companyname','employer'], role: ['role','title','jobtitle','position'],
  description: ['description','jd','jobdescription'], url: ['url','joburl','applyurl','link','applicationurl'], salary: ['salary','pay','compensation']
};
export function parseJobCsv(source) {
  if (typeof source !== 'string' || source.length > 2000000) throw new Error('Choose a CSV file under 2 MB.');
  source = source.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  const cell = () => { row.push(field); field = ''; closed = false; };
  const record = () => { cell(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 1001) throw new Error('Import at most 1,000 jobs per CSV file.'); };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') { if (source[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === ',') cell();
    else if (char === '\r' || char === '\n') { if (char === '\r' && source[i+1] === '\n') i++; record(); }
    else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('Malformed CSV quoting. Export the file as comma-separated CSV and try again.');
    else field += char;
  }
  if (quoted) throw new Error('A quoted CSV field is not closed.');
  record();
  const header = rows.shift();
  if (!header || !rows.length) throw new Error('The CSV needs a header and at least one job row.');
  const columns = {};
  header.forEach((name, index) => {
    const key = Object.keys(names).find(key => names[key].includes(name.trim().toLowerCase().replace(/[\s_-]+/g,'')));
    if (key) { if (key in columns) throw new Error(`More than one ${key} column was found.`); columns[key] = index; }
  });
  for (const key of ['company','role','description']) if (!(key in columns)) throw new Error(`Missing ${key} column. Use company, title, description, url and optional salary headers.`);
  const jobs = [], errors = [];
  rows.forEach((values, index) => {
    try {
      if (values.length !== header.length) throw new Error('column count does not match the header');
      const job = Object.fromEntries(Object.entries(columns).map(([key,column]) => [key,values[column].trim()]));
      for (const [key,max] of [['company',180],['role',220],['description',100000]]) if (!job[key] || job[key].length > max) throw new Error(`${key} is required and must be under ${max.toLocaleString()} characters`);
      job.url ||= '';
      if (job.url) { const url = new URL(job.url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(hiring\.cafe|hiringcafe\.com)$/i.test(url.hostname)) throw new Error('use an employer or ATS http/https Apply URL'); job.url = url.href; }
      if (job.salary?.length > 250) throw new Error('salary is too long');
      job.provenance = { company:{kind:'user',source:'CSV import'},role:{kind:'user',source:'CSV import'} };
      jobs.push({row:index+2,job});
    } catch (error) { errors.push(`Row ${index+2}: ${error.message}.`); }
  });
  return {jobs,errors};
}

export async function importJobCsv(source, input, queue, options = {}) {
  const parsed = parseJobCsv(source), result = { added:0, duplicates:0, invalid:parsed.errors.length, errors:[...parsed.errors] };
  for (const item of parsed.jobs) {
    try { await queue.add({...input,tailor:true,job:item.job},{checkExisting:options.checkExisting !== false,checkExistingUrl:true}); result.added++; }
    catch (error) {
      if (error.code === 'already-applied') result.duplicates++;
      else { result.invalid++; result.errors.push(`Row ${item.row}: ${error.message || 'Could not save this job.'}`); }
    }
  }
  return result;
}
