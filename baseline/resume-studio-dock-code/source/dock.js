
(()=>{
const root=document.getElementById('resume-template-dock-design');
const q=s=>root.querySelector(s);
const profiles={alex:{name:'Alex Morgan',initials:'AM',file:'Alex_Morgan_Profile.json',role:'Software Engineer',email:'alex@example.com',summary:'Software engineer experienced in developing web applications and backend services with TypeScript, React, Python, and SQL.',experience:'Software Engineer · Example Technologies · 2022–present',bullets:['Built and maintained features across frontend applications and backend services.','Collaborated with product and engineering teams to deliver reliable user experiences.'],skills:['TypeScript','React','Python','SQL','API development']},jordan:{name:'Jordan Lee',initials:'JL',file:'Jordan_Lee_Profile.json',role:'Data Engineer',email:'jordan@example.com',summary:'Data engineer experienced in building Python and SQL data pipelines, maintaining data models, and improving data quality.',experience:'Data Engineer · Example Analytics · 2022–present',bullets:['Developed Python and SQL pipelines for analytics and reporting.','Worked with engineering teams to improve data models and data quality.'],skills:['Python','SQL','Data pipelines','Data modeling','Data quality']}};
const jobs=[{company:'Northstar',role:'Software Engineer',description:'Build web applications using TypeScript, React, APIs, and SQL. Collaborate with product and engineering teams to deliver reliable customer experiences.'},{company:'Aster Labs',role:'Data Engineer',description:'Develop Python and SQL data pipelines. Maintain data models, improve data quality, and collaborate with analytics and engineering teams.'}];
const promptTemplates={focused:{label:'Job focused',text:'Use only facts from the candidate profile. Prioritize experience relevant to the job description. Keep the language concise and preserve employment dates.'},concise:{label:'Concise',text:'Create a concise resume using only the candidate profile. Use short, direct bullets. Remove repetition and preserve all employment dates.'},technical:{label:'Technical',text:'Emphasize relevant technical skills, projects, and engineering experience supported by the candidate profile. Preserve dates and never invent tools, results, or metrics.'}};
function templatePreview(kind){
 const resume=kind==='resume',select=q('#rg-template'),prompt=promptTemplates[q('#rg-prompt-template').value];
 q('#rg-resume-template-preview').hidden=!resume;q('#rg-prompt-template-preview').hidden=resume;
 q('#rg-resume-template-preview').dataset.template=select.value;
 q('#rg-mini-name').textContent=currentProfile().name;q('#rg-mini-role').textContent=currentProfile().role;
 q('#rg-template-preview-label').textContent=resume?'Resume preview · '+select.options[select.selectedIndex].text:'Prompt preview';
 q('#rg-prompt-preview-title').textContent=prompt.label;q('#rg-prompt-preview-text').textContent=prompt.text;
}
const sentJobs=[];
const stateNames={queued:'Queued',generating:'Generating',ready:'Ready',cancelled:'Cancelled'};
let jobIndex=0,nextRequestId=1,selectedId=null,activeId=null,timer=null,reviewing=true,editing=false,uploadedName='';
const status=message=>q('#rg-status-text').textContent=message;
const candidateKey=()=>q('#rg-candidate').value;
const currentProfile=()=>profiles[candidateKey()];
const selectedRequest=()=>sentJobs.find(r=>r.id===selectedId&&r.input.candidateKey===candidateKey());
function icons(){if(typeof lucide!=='undefined')lucide.createIcons({attrs:{width:16,height:16}})}
function commitEdits(){const req=sentJobs.find(r=>r.id===selectedId);if(editing&&req&&req.draft){req.draft.text=q('#rg-editor').value;req.draft.edited=true}editing=false}
function syncCancel(){const req=selectedRequest();q('#rg-cancel').disabled=!(reviewing&&req&&(req.status==='queued'||req.status==='generating'))}
function renderQueue(){
 const own=sentJobs.filter(r=>r.input.candidateKey===candidateKey());
 if(!own.some(r=>r.id===selectedId))selectedId=own.length?own[0].id:null;
 q('#rg-sent-count').textContent=own.length;q('#rg-review-count').textContent=own.length;q('#rg-queue-candidate').textContent=currentProfile().name;
 const rows=own.map(req=>{
  const li=document.createElement('li'),button=document.createElement('button');
  button.type='button';button.className='rg-sent-button cursor-interaction';button.dataset.request=String(req.id);button.setAttribute('aria-pressed',String(req.id===selectedId));
  const company=req.input.tailoring?req.input.job.company:'Base resume';
  button.setAttribute('aria-label',company+', '+req.input.job.role+', '+stateNames[req.status]+', version '+req.version);
  const mark=document.createElement('span');mark.className='rg-sent-company-icon';mark.textContent=company[0];
  const label=document.createElement('span');label.className='rg-sent-label';
  const strong=document.createElement('strong');strong.textContent=company;
  const role=document.createElement('span');role.textContent=req.input.job.role+(req.version>1?' · v'+req.version:'');label.append(strong,role);
  const state=document.createElement('span');state.className='rg-sent-state';state.dataset.state=req.status;state.textContent=stateNames[req.status];
  button.append(mark,label,state);li.append(button);return li;
 });
 q('#rg-sent-list').replaceChildren(...rows);syncCancel();
}
function displayRequest(expand=false){
 const req=selectedRequest(),ready=Boolean(req&&req.status==='ready'&&req.draft);
 editing=false;q('#rg-result').hidden=!ready;q('#rg-empty').hidden=ready;q('#rg-retry').hidden=!req||req.status!=='cancelled';
 if(!ready){q('#rg-empty-message').textContent=!req?'No sent jobs yet.':req.status==='generating'?'Generating this resume…':req.status==='queued'?'Queued · Waiting for resume generation.':'Generation cancelled · Job kept in the queue.';syncCancel();return}
 const d=req.draft,p=req.input.profile;
 q('#rg-result-name').textContent=p.name;q('#rg-result-role').textContent=p.role;q('#rg-result-contact').textContent=p.email+' · United States';
 q('#rg-result-summary').textContent=d.summary;q('#rg-result-experience').textContent=p.experience;
 q('#rg-result-bullets').replaceChildren(...p.bullets.map(text=>{const li=document.createElement('li');li.textContent=text;return li}));
 q('#rg-result-skills').textContent=d.skills.join(' · ');q('#rg-result-mode').textContent=req.input.tailoring?'Tailored · '+req.input.job.company:'Base resume';q('#rg-result-filename').textContent=d.filename;
 q('#rg-paper').style.letterSpacing=req.input.template==='compact'?'-0.2px':'normal';q('#rg-paper').hidden=Boolean(d.edited);q('#rg-editor').hidden=!d.edited;q('#rg-editor').value=d.text;q('#rg-editor').readOnly=true;
 q('#rg-resume-preview').open=expand;q('#rg-export-menu').hidden=true;q('#rg-edit-hint').textContent=d.edited?'Edits saved for this job.':'Review before exporting.';
 q('#rg-edit').innerHTML='<i data-lucide="pencil" aria-hidden="true"></i> Edit text';syncCancel();icons();
}
function tab(review){
 commitEdits();reviewing=review;q('#rg-prepare').hidden=review;q('#rg-review').hidden=!review;q('#rg-prepare-tab').setAttribute('aria-selected',String(!review));q('#rg-review-tab').setAttribute('aria-selected',String(review));
 q('#rg-generate').innerHTML=review?'<i data-lucide="plus" aria-hidden="true"></i> Review another job':'<i data-lucide="sparkles" aria-hidden="true"></i> Generate resume';
 if(review){renderQueue();displayRequest(false)}syncCancel();icons();
}
function profile(){
 commitEdits();const p=currentProfile();uploadedName='';q('#rg-avatar').textContent=p.initials;q('#rg-profile-file').textContent=p.file;q('#rg-profile-source').textContent='Saved profile';q('#rg-profile-upload').value='';q('#rg-profile-upload').hidden=true;
 selectedId=null;renderQueue();displayRequest(false);tab(false);templatePreview('resume');status('Ready · '+p.name+' selected');
}
function setJob(delta){jobIndex=(jobIndex+delta+jobs.length)%jobs.length;const j=jobs[jobIndex];q('#rg-job-role').textContent=j.role;q('#rg-job-company').textContent=j.company+' · Current tab';q('#rg-job-description').value=j.description;q('#rg-tab-count').textContent=(jobIndex+1)+' / '+jobs.length;status('Review Job · '+j.company)}
function snapshot(jobOverride=null){
 const j=jobOverride||jobs[jobIndex];
 return JSON.parse(JSON.stringify({candidateKey:candidateKey(),profile:currentProfile(),job:{...j,description:jobOverride?j.description:q('#rg-job-description').value},tailoring:q('#rg-tailor').checked,template:q('#rg-template').value,promptTemplate:q('#rg-prompt-template').value,instructions:promptTemplates[q('#rg-prompt-template').value].text,model:q('#rg-model').value,effort:q('#rg-effort').value,profileFile:uploadedName||currentProfile().file}));
}
function buildDraft(input,version){
 const p=input.profile,jd=input.job.description.toLowerCase(),relevant=p.skills.filter(s=>jd.includes(s.toLowerCase())||(s==='API development'&&jd.includes('api')));
 const skills=input.tailoring?[...relevant,...p.skills.filter(s=>!relevant.includes(s))]:[...p.skills];
 const summary=input.tailoring&&relevant.length?p.summary+' Relevant strengths include '+relevant.join(', ')+'.':p.summary;
 const filename=p.name.replace(/ /g,'_')+'_'+(input.tailoring?input.job.company.replace(/ /g,'_')+'_':'')+'Resume_v'+version;
 const text=p.name+'\n'+p.role+'\n'+p.email+' · United States\n\nSUMMARY\n'+summary+'\n\nEXPERIENCE\n'+p.experience+'\n'+p.bullets.map(b=>'• '+b).join('\n')+'\n\nSKILLS\n'+skills.join(' · ')+'\n\nEDUCATION\nB.S. Computer Science';
 return {summary,skills,filename,text,edited:false};
}
function makeRequest(input,ready=false){
 const captured=JSON.parse(JSON.stringify(input));
 const version=sentJobs.filter(r=>r.input.candidateKey===captured.candidateKey&&r.input.job.company===captured.job.company&&r.input.job.role===captured.job.role&&r.input.tailoring===captured.tailoring).length+1;
 const req={id:nextRequestId++,input:captured,version,status:ready?'ready':'queued',draft:ready?buildDraft(captured,version):null};sentJobs.push(req);return req;
}
function processNext(){
 if(activeId!==null)return;const req=sentJobs.find(r=>r.status==='queued');if(!req)return;
 activeId=req.id;req.status='generating';renderQueue();if(selectedId===req.id&&reviewing)displayRequest(false);
 if(candidateKey()===req.input.candidateKey)status('Generating sample resume · '+req.input.job.company);
 timer=setTimeout(()=>{req.draft=buildDraft(req.input,req.version);req.status='ready';activeId=null;timer=null;renderQueue();if(selectedId===req.id&&reviewing)displayRequest(false);if(candidateKey()===req.input.candidateKey)status('Resume ready · '+req.input.job.company+' kept in sent jobs');processNext()},1600);
}
function send(input){commitEdits();const req=makeRequest(input);selectedId=req.id;tab(true);status('Job sent · '+req.input.job.company);processNext()}
q('#rg-prepare-tab').addEventListener('click',()=>tab(false));q('#rg-review-tab').addEventListener('click',()=>tab(true));
q('#rg-sent-list').addEventListener('click',event=>{const button=event.target.closest('[data-request]');if(!button)return;commitEdits();selectedId=Number(button.dataset.request);renderQueue();displayRequest(true);const req=selectedRequest();status(req.status==='ready'?'Reviewing '+req.input.job.company+' · v'+req.version:stateNames[req.status]+' · '+req.input.job.company)});
q('#rg-collapse').addEventListener('click',()=>{q('#rg-expanded').hidden=true;q('#rg-collapsed').hidden=false;q('#rg-expand').focus()});q('#rg-expand').addEventListener('click',()=>{q('#rg-expanded').hidden=false;q('#rg-collapsed').hidden=true;q('#rg-collapse').focus()});
q('#rg-signin').addEventListener('click',()=>{q('#rg-signin').innerHTML='<i data-lucide="circle-user-round" aria-hidden="true"></i> Preview account';q('#rg-account-state').textContent='Demo';status('Sign-in preview · No account connected');icons()});
q('#rg-candidate').addEventListener('change',profile);
q('#rg-upload-button').addEventListener('click',()=>{q('#rg-profile-upload').hidden=!q('#rg-profile-upload').hidden});
q('#rg-profile-upload').addEventListener('change',event=>{const file=event.target.files[0];if(file){uploadedName=file.name;q('#rg-profile-file').textContent=file.name;q('#rg-profile-source').textContent='Uploaded';status('Profile file selected · Sample output in this preview')}});
q('#rg-tailor').addEventListener('change',event=>{const on=event.target.checked;q('#rg-job-context').hidden=!on;q('#rg-mode-description').textContent=on?'Use the job description to focus this resume.':'Generate a base resume from the saved profile.';status(on?'Ready · Profile and job description selected':'Ready · Use saved profile for a base resume')});
q('#rg-previous').addEventListener('click',()=>setJob(-1));q('#rg-next').addEventListener('click',()=>setJob(1));q('#rg-read-tab').addEventListener('click',()=>{q('#rg-job-description').value=jobs[jobIndex].description;status('Sample job description loaded from the tab preview')});
q('#rg-generate').addEventListener('click',()=>{if(reviewing){tab(false);return}if(q('#rg-tailor').checked&&!q('#rg-job-description').value.trim()){q('#rg-job-description').focus();status('Add a job description to tailor this resume');return}send(snapshot())});
q('#rg-regenerate').addEventListener('click',()=>{const req=selectedRequest();if(req&&req.draft)send(req.input)});
q('#rg-cancel').addEventListener('click',()=>{const req=selectedRequest();if(!req||!['queued','generating'].includes(req.status))return;if(activeId===req.id){clearTimeout(timer);timer=null;activeId=null}req.status='cancelled';renderQueue();displayRequest(false);status('Generation cancelled · Job kept in sent jobs');processNext()});
q('#rg-retry').addEventListener('click',()=>{const req=selectedRequest();if(req&&req.status==='cancelled'){req.status='queued';renderQueue();displayRequest(false);processNext()}});
q('#rg-edit').addEventListener('click',()=>{const req=selectedRequest();if(!req||!req.draft)return;if(editing){commitEdits();displayRequest(true);status('Resume edits saved for '+req.input.job.company)}else{editing=true;q('#rg-resume-preview').open=true;q('#rg-paper').hidden=true;q('#rg-editor').hidden=false;q('#rg-editor').readOnly=false;q('#rg-editor').value=req.draft.text;q('#rg-editor').focus();q('#rg-edit').innerHTML='<i data-lucide="check" aria-hidden="true"></i> Save edits';q('#rg-edit-hint').textContent='Editing this job’s resume.';icons()}});
q('#rg-copy').addEventListener('click',()=>{const req=selectedRequest();if(!req||!req.draft)return;const text=editing?q('#rg-editor').value:req.draft.text;if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(()=>status('Resume text copied')).catch(()=>status('Use Edit text to select and copy the resume'));else status('Use Edit text to select and copy the resume')});
q('#rg-export').addEventListener('click',()=>{const wasEditing=editing;commitEdits();if(wasEditing)displayRequest(true);q('#rg-export-menu').hidden=!q('#rg-export-menu').hidden});root.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',()=>status(button.dataset.export+' export selected · Design preview')));
q('#rg-model').addEventListener('change',()=>{q('#rg-effort').disabled=q('#rg-model').value==='fast';status(q('#rg-model').value==='fast'?'Fast model selected · No thinking effort setting':'Reasoning model selected')});
q('#rg-template').addEventListener('change',()=>templatePreview('resume'));q('#rg-template').addEventListener('focus',()=>templatePreview('resume'));
q('#rg-prompt-template').addEventListener('change',()=>templatePreview('prompt'));q('#rg-prompt-template').addEventListener('focus',()=>templatePreview('prompt'));
const first=makeRequest(snapshot(jobs[0]),true);makeRequest(snapshot(jobs[1]),true);selectedId=first.id;tab(false);templatePreview('resume');status('Ready · Saved profile and job description selected');icons();
})();
