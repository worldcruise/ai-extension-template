export const resumeTemplates = [
  { id: 'kakuna', name: 'Kakuna', thumbnail: 'assets/resume-templates/01-kakuna-thumbnail.png' },
  { id: 'azurill', name: 'Azurill', thumbnail: 'assets/resume-templates/02-azurill-thumbnail.png' },
  { id: 'ditto', name: 'Ditto', thumbnail: 'assets/resume-templates/03-ditto-thumbnail.png' },
  { id: 'glalie', name: 'Glalie', thumbnail: 'assets/resume-templates/04-glalie-thumbnail.png' },
  { id: 'rendercv-classic', name: 'RenderCV Classic', thumbnail: 'assets/resume-templates/05-rendercv-classic-thumbnail.png' },
  { id: 'moderncv', name: 'ModernCV', thumbnail: 'assets/resume-templates/06-moderncv-thumbnail.png' },
  { id: 'harvard', name: 'Harvard', thumbnail: 'assets/resume-templates/07-harvard-thumbnail.png' },
  { id: 'ember', name: 'Ember', thumbnail: 'assets/resume-templates/08-ember-thumbnail.png' }
];

export const resumeTemplate = id => resumeTemplates.find(template => template.id === id) || resumeTemplates[0];
