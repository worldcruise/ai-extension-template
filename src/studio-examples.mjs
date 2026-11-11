// Explicit example data for the UI milestone. No real generation or persistence.
export const profiles = {
  morgan: {
    name: 'Morgan Taylor', initials: 'MT', filename: 'Morgan_Profile.json', role: 'Software Engineer',
    summary: 'Software engineer developing web applications and backend services with TypeScript, React, Python, and SQL.',
    skills: ['TypeScript', 'React', 'Python', 'SQL', 'API development'],
    experience: [{ title: 'Software Engineer', company: 'Example Technologies', sentences: ['Built and maintained web applications and backend services.', 'Collaborated with product and engineering teams to deliver reliable customer experiences.'] }],
    education: [{ degree: 'B.S. Computer Science · Example University' }]
  },
  jordan: {
    name: 'Jordan Lee', initials: 'JL', filename: 'Jordan_Profile.json', role: 'Data Engineer',
    summary: 'Data engineer building Python and SQL pipelines, maintaining data models, and improving data quality.',
    skills: ['Python', 'SQL', 'Data pipelines', 'Data modeling', 'Data quality'],
    experience: [{ title: 'Data Engineer', company: 'Example Analytics', sentences: ['Developed data pipelines for analytics and reporting.', 'Worked with engineering teams to improve data models and data quality.'] }],
    education: []
  }
};

export const jobs = [
  { company: 'Northstar', role: 'Software Engineer', description: 'Build reliable web applications with TypeScript, React, APIs, and SQL. Work closely with product and engineering teams to deliver reliable customer experiences.' },
  { company: 'Aster Labs', role: 'Data Engineer', description: 'Develop Python and SQL pipelines. Maintain data models and improve data quality with analytics and engineering teams.' },
  { company: 'Harbor', role: 'Backend Engineer', description: 'Develop backend services and APIs using Python and SQL. Collaborate with product teams to build reliable systems.' }
];

export const prompts = {
  base: { name: 'Base resume', text: 'Use only facts from the candidate profile. Prepare a general resume without tailoring to a job. Preserve employment facts and return only the required resume JSON.' },
  focused: { name: 'Job focused', text: 'Use only facts from the candidate profile. Prioritize experience relevant to the job. Preserve employment facts and return only the required resume JSON.' },
  concise: { name: 'Concise', text: 'Use short, direct sentences supported by the candidate profile. Remove repetition. Return only the required resume JSON.' },
  technical: { name: 'Technical', text: 'Prioritize supported technical skills and engineering experience relevant to this job. Never invent tools or metrics. Return only the required resume JSON.' }
};

export function createExamples() {
  return jobs.map((job, index) => ({
    id: index + 1, state: 'ready',
    input: structuredClone({ candidateId: 'morgan', profile: profiles.morgan, job, tailor: true,
      resumeTemplate: index === 1 ? 'harvard' : 'kakuna', promptTemplate: 'focused', prompt: prompts.focused.text }),
    resume: structuredClone({ company: job.company, title: profiles.morgan.role, summary: profiles.morgan.summary,
      skills: [{ 'Technical skills': profiles.morgan.skills }], experience: profiles.morgan.experience, education: profiles.morgan.education })
  }));
}
