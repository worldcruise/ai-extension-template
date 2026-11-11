const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const fail = message => { throw new Error(message); };
function object(value, name, keys) {
  if (!plain(value)) fail(`${name} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name}: unsupported field "${key}".`);
  return value;
}
function text(value, name, maximum = 12000, optional = false) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximum || (!optional && !value.trim())) fail(`${name} must be text${optional ? '' : ' and cannot be empty'} (up to ${maximum} characters).`);
  return value.trim();
}
function list(value, name, maximum, convert) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${name} must be an array with up to ${maximum} entries.`);
  return value.map((item, index) => convert(item, `${name}[${index}]`));
}
const dates = ['startDate', 'endDate', 'location'];
function experience(value, name) {
  object(value, name, ['title', 'company', 'sentences', ...dates]);
  const result = { title: text(value.title, `${name}.title`, 300), company: text(value.company, `${name}.company`, 300),
    sentences: list(value.sentences, `${name}.sentences`, 100, (item, path) => text(item, path, 3000)) };
  for (const key of dates) if (value[key] !== undefined) result[key] = text(value[key], `${name}.${key}`, 300, true);
  return result;
}
function education(value, name) {
  object(value, name, ['degree', 'institution', ...dates]);
  const result = { degree: text(value.degree, `${name}.degree`, 500) };
  for (const key of ['institution', ...dates]) if (value[key] !== undefined) result[key] = text(value[key], `${name}.${key}`, 500, true);
  return result;
}
function contact(value) {
  object(value, 'contact', ['email', 'phone', 'location', 'website', 'linkedin']);
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, text(value, `contact.${key}`, 500, true)]));
}
export function normalizeProfile(value) {
  object(value, 'Profile', ['schemaVersion', 'name', 'role', 'summary', 'skills', 'experience', 'education', 'contact', 'initials', 'filename', 'id', 'isExample']);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) fail('Unsupported profile schemaVersion. Use version 1.');
  const profile = { name: text(value.name, 'name', 200), role: text(value.role, 'role', 300), summary: text(value.summary, 'summary'),
    skills: list(value.skills, 'skills', 200, (item, path) => text(item, path, 200)),
    experience: list(value.experience, 'experience', 100, experience), education: list(value.education, 'education', 100, education) };
  if (value.contact !== undefined) profile.contact = contact(value.contact);
  if (JSON.stringify(profile).length > 200000) fail('The profile is too large. Use a file under 200 KB.');
  return profile;
}
export function parseProfile(source) {
  if (typeof source !== 'string' || source.length > 250000) fail('Import a profile JSON file under 250 KB.');
  let value;
  try { value = JSON.parse(source); } catch { fail('The profile file is not valid JSON. Download the example format.'); }
  return normalizeProfile(value);
}
export const exampleProfile = { schemaVersion: 1, name: 'Example Candidate', role: 'Software Engineer',
  summary: 'Software engineer developing reliable services.', skills: ['TypeScript', 'SQL'],
  experience: [{ title: 'Software Engineer', company: 'Example Company', startDate: '2022-01', endDate: 'Present', sentences: ['Built and maintained web services.'] }],
  education: [{ degree: 'B.S. Computer Science', institution: 'Example University' }] };

function validateResume(source, request) {
  if (typeof source !== 'string' || source.length > 500000) fail('The response is empty or exceeds 500 KB.');
  let raw = source.trim();
  const fenced = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) raw = fenced[1].trim();
  let value;
  try { value = JSON.parse(raw); } catch { fail('The response is not one complete JSON object.'); }
  object(value, 'Response', ['schemaVersion', 'requestId', 'resume']);
  if (value.schemaVersion !== 1 || value.requestId !== request.id) fail('The response belongs to another request or schema version.');
  const resume = object(value.resume, 'resume', ['company', 'title', 'summary', 'skills', 'experience', 'education', 'contact']);
  if (typeof resume.company !== 'string') fail('resume.company must be text, including an empty string when the company is unknown.');
  const result = { company: text(resume.company, 'resume.company', 300, request.input.job.company === ''), title: text(resume.title, 'resume.title', 300), summary: text(resume.summary, 'resume.summary'),
    skills: list(resume.skills, 'resume.skills', 30, (group, name) => {
      if (!plain(group) || Object.keys(group).length !== 1) fail(`${name} must contain one named skill group.`);
      const [key] = Object.keys(group); text(key, name, 200);
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid skill group name.');
      return { [key]: list(group[key], name, 200, (item, path) => text(item, path, 200)) };
    }), experience: list(resume.experience, 'resume.experience', 100, experience), education: list(resume.education, 'resume.education', 100, education) };
  if (result.company !== request.input.job.company) fail('The response company does not match this job.');
  const profile = normalizeProfile(request.input.profile);
  for (const [key, fixed] of [['experience', ['title', 'company', ...dates]], ['education', ['degree', 'institution', ...dates]]]) {
    if (result[key].length !== profile[key].length) fail(`Keep every ${key} record in its original order.`);
    profile[key].forEach((item, index) => {
      for (const field of fixed) if (result[key][index][field] !== item[field]) fail(`${key}[${index}].${field} changed a profile fact.`);
    });
  }
  const supported = new Set(profile.skills.map(skill => skill.toLocaleLowerCase()));
  for (const group of result.skills) for (const skill of Object.values(group)[0]) if (!supported.has(skill.toLocaleLowerCase())) fail(`Unsupported skill: ${skill}. Use profile skills only.`);
  if (profile.contact) {
    result.contact = contact(resume.contact);
    for (const key of new Set([...Object.keys(profile.contact), ...Object.keys(result.contact)])) {
      if (profile.contact[key] !== result.contact[key]) fail('Contact details must match the profile.');
    }
  } else if (resume.contact !== undefined) fail('The response invented contact details.');
  return result;
}
export function parseResume(source, request) {
  try { return validateResume(source, request); }
  catch (error) { error.code = 'invalid-resume'; throw error; }
}
