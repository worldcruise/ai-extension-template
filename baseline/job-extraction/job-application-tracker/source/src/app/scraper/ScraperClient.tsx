'use client';

import { useState, useEffect } from 'react';
import { startScraper, startSequentialScraper, startDeepSequentialScraper, cancelScraper, deleteScrapedJob, hideScrapedJob, unhideScrapedJob, hardDeleteScrapedJob, moveToMainBoard, saveFocusToSettings, getScraperStatus, getScrapedJobs, getScraperLogs, updateSetting, aiCleanupJob } from '@/app/actions';
import { Search, Globe, Filter, Play, CheckCircle2, Trash2, EyeOff, Eye, ArrowRight, Wand2, Loader2, RefreshCw, Cpu } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ScraperClient({ initialJobs, initialLogs, settings }: { initialJobs: any[], initialLogs: any[], settings: any }) {
  const router = useRouter();
  
  // Extract saved focuses
  let savedFocuses: string[] = [];
  try {
    if (settings['saved_focuses']) {
      savedFocuses = JSON.parse(settings['saved_focuses']);
    }
  } catch (e) {}

  const [url, setUrl] = useState('');
  const [website, setWebsite] = useState('Generic');
  const initialFocus = settings['scraper_last_focus'] !== undefined ? settings['scraper_last_focus'] : (savedFocuses.length > 0 ? savedFocuses[savedFocuses.length - 1] : '');
  const [focus, setFocus] = useState(initialFocus);
  const [focusMode, setFocusMode] = useState(initialFocus === '' ? 'none' : (savedFocuses.includes(initialFocus) ? initialFocus : 'custom'));
  const [savedFocusesState, setSavedFocusesState] = useState<string[]>(savedFocuses);
  const [minMatch, setMinMatch] = useState(settings['scraper_min_match'] ? parseInt(settings['scraper_min_match']) : 80);
  const [minGoalMatch, setMinGoalMatch] = useState(settings['scraper_min_goal_match'] ? parseInt(settings['scraper_min_goal_match']) : 0);
  const [isRunning, setIsRunning] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Idle');
  const [progress, setProgress] = useState(0);
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [showHiddenJobs, setShowHiddenJobs] = useState(false);
  const [cleaningJobs, setCleaningJobs] = useState<Record<number, boolean>>({});
  const [globalCleaningJobs, setGlobalCleaningJobs] = useState<Record<number, boolean>>({});
  const [showingOriginals, setShowingOriginals] = useState<Record<number, boolean>>({});

  let DEFAULT_SITES = [
    { name: 'YCombinator', url: 'https://news.ycombinator.com/jobs' },
    { name: 'BuiltIn', url: 'https://builtin.com/jobs' },
    { name: 'RemoteOK', url: 'https://remoteok.com/' },
    { name: 'Simplify', url: 'https://simplify.jobs/jobs' },
  ];
  try {
    if (settings['scraper_default_sites']) {
      DEFAULT_SITES = JSON.parse(settings['scraper_default_sites']);
    }
  } catch (e) {}

  const [jobs, setJobs] = useState(initialJobs);
  const [logs, setLogs] = useState(initialLogs);

  useEffect(() => {
    setJobs(initialJobs);
    setLogs(initialLogs);
  }, [initialJobs, initialLogs]);

  // Keyword matching function for "focus"
  const matchesFocus = (job: any, searchStr: string) => {
    if (!searchStr || searchStr === 'none' || searchStr === 'custom' || searchStr.trim() === '') return true;
    
    // Normalize "- word" to "-word"
    const normalizedSearch = searchStr.replace(/-\s+/g, '-');
    
    const regex = /(-?)(?:"([^"]+)"|(\S+))/g;
    let match;
    const fullText = (job.title + " " + job.description).toLowerCase();
    
    while ((match = regex.exec(normalizedSearch)) !== null) {
      const isNegated = match[1] === '-';
      let term = (match[2] || match[3]);
      if (!term) continue;
      term = term.toLowerCase();
      
      const isAlphaNum = /^[a-z0-9\s]+$/i.test(term);
      let termFound = false;
      
      if (isAlphaNum) {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        termFound = new RegExp(`\\b${escapedTerm}\\b`, 'i').test(fullText);
      } else {
        termFound = fullText.includes(term);
      }

      if (isNegated && termFound) return false;
      if (!isNegated && !termFound) return false;
    }
    return true;
  };

  const filteredJobs = jobs.filter(job => 
    job.match_score >= minMatch && 
    (job.goal_match_score == null || job.goal_match_score >= minGoalMatch) &&
    matchesFocus(job, focus) &&
    (showHiddenJobs || !job.is_hidden)
  );

  // Poll for scraper status
  useEffect(() => {
    const pollStatus = async () => {
      const stat = await getScraperStatus();
      
      setIsRunning(stat.isRunning);
      if (stat.isRunning) {
        setLiveStatus(stat.status);
        setProgress(stat.progress);
        // Refresh jobs and logs while running
        const j = await getScrapedJobs();
        const l = await getScraperLogs();
        setJobs(j);
        setLogs(l);
      }
    };

    const fetchCleaning = async () => {
      try {
        const { getQueuedCleanups } = await import('@/app/actions');
        const queued = await getQueuedCleanups();
        const newGlobal: Record<number, boolean> = {};
        queued.forEach(key => {
          const [type, id] = key.split('-');
          if (type === 'scraped') newGlobal[Number(id)] = true;
        });
        setGlobalCleaningJobs(newGlobal);
      } catch (e) {}
    };

    pollStatus();
    fetchCleaning();
    const interval = setInterval(() => {
      pollStatus();
      fetchCleaning();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    if (!url) {
      alert('Please enter a URL to scrape.');
      return;
    }
    setIsRunning(true);
    await saveFocusToSettings(focus);
    await startScraper(url, website, focus, minMatch, minGoalMatch);
    alert('Scraper started in background! Check logs shortly.');
  };

  const handleScrapeDefaults = async () => {
    setIsRunning(true);
    await saveFocusToSettings(focus);
    alert('Starting sequential scraper for default sites in the background!');
    await startSequentialScraper(DEFAULT_SITES, focus, minMatch, minGoalMatch);
  };

  const handleDeepScrapeDefaults = async () => {
    setIsRunning(true);
    await saveFocusToSettings(focus);
    alert('Starting DEEP AGENTIC scraper for default sites in the background (using Ollama)! This will be slow.');
    await startDeepSequentialScraper(DEFAULT_SITES, focus, minMatch, minGoalMatch);
  };

  const handleMove = async (id: number) => {
    await moveToMainBoard(id);
    router.refresh();
  };

  const handleHide = async (id: number) => {
    await hideScrapedJob(id);
    router.refresh();
  };

  const handleUnhide = async (id: number) => {
    await unhideScrapedJob(id);
    router.refresh();
  };

  const handleHardDelete = async (id: number) => {
    await hardDeleteScrapedJob(id); // This is permanent delete
    router.refresh();
  };

  const handleCleanup = async (id: number) => {
    setCleaningJobs(prev => ({ ...prev, [id]: true }));
    try {
      const res = await aiCleanupJob(id, 'scraped');
      if (!res.success) {
        alert(res.error || 'Failed to clean up job');
      } else {
        setJobs(prev => prev.map(j => j.id === id ? { ...j, original_job_data: '{}' } : j));
        router.refresh();
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCleaningJobs(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Globe size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }} /> Automated Scraper</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginTop: '0.5rem' }}>Find jobs in the background and filter them by focus and AI match score.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
        <div>
          <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={20} className="text-accent" /> Run Manual Scrape
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>Target URL</label>
                <input 
                  type="text" 
                  value={url} 
                  onChange={e => setUrl(e.target.value)} 
                  placeholder="https://news.ycombinator.com/jobs or builtin.com..." 
                  style={{ width: '100%', padding: '10px', fontSize: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--surface-border)', borderRadius: '6px', color: 'var(--text-primary)' }} 
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>Current Focus Filter (Optional)</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select 
                    value={focusMode} 
                    onChange={e => {
                      const val = e.target.value;
                      setFocusMode(val);
                      if (val === 'none') {
                        setFocus('');
                        updateSetting('scraper_last_focus', '');
                      } else if (val !== 'custom') {
                        setFocus(val);
                        updateSetting('scraper_last_focus', val);
                      }
                    }}
                    style={{ flex: 1, padding: '10px', fontSize: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--surface-border)', borderRadius: '6px', color: 'var(--text-primary)' }}
                  >
                    <option value="none">No Focus (Scrape Everything)</option>
                    {savedFocusesState.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                    <option value="custom">-- Type New Focus --</option>
                  </select>
                  {focusMode === 'custom' && (
                    <div style={{ display: 'flex', flex: 1, gap: '0.5rem' }}>
                      <input 
                        type="text" 
                        value={focus} 
                        onChange={e => {
                          setFocus(e.target.value);
                          updateSetting('scraper_last_focus', e.target.value);
                        }} 
                        placeholder="e.g. Research Internship..." 
                        style={{ flex: 1, padding: '10px', fontSize: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--surface-border)', borderRadius: '6px', color: 'var(--text-primary)' }} 
                      />
                      <button 
                        onClick={async () => {
                          if (focus.trim() && !savedFocusesState.includes(focus)) {
                            await saveFocusToSettings(focus);
                            setSavedFocusesState([...savedFocusesState, focus]);
                            setFocusMode(focus);
                          }
                        }}
                        style={{ padding: '0 1rem', background: 'var(--surface-border)', border: 'none', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}
                        title="Save to Presets"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>Jobs will be quickly filtered by the LLM for this focus before computing expensive match scores.</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>Minimum Match Score ({minMatch}%)</label>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={minMatch} 
                  onChange={(e) => {
                    setMinMatch(Number(e.target.value));
                    updateSetting('scraper_min_match', e.target.value);
                  }} 
                  style={{ width: '100%', accentColor: 'var(--accent-color)' }}
                /> 
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '8px', color: 'var(--text-secondary)' }}>Minimum Goal Match Score ({minGoalMatch}%)</label>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={minGoalMatch} 
                  onChange={(e) => {
                    setMinGoalMatch(Number(e.target.value));
                    updateSetting('scraper_min_goal_match', e.target.value);
                  }} 
                  style={{ width: '100%', accentColor: '#60a5fa' }}
                /> 
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>Requires a "Target Job Goal" to be set in Settings.</span>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button className="btn-primary" onClick={handleStart} disabled={isRunning} style={{ flex: '1 1 45%' }}>
                  <Search size={18} /> {isRunning ? 'Starting...' : 'Start Custom Scraper'}
                </button>
                <button className="btn-secondary" onClick={handleScrapeDefaults} disabled={isRunning} style={{ flex: '1 1 45%' }}>
                  <Globe size={18} /> {isRunning ? 'Starting...' : 'Scrape All Defaults'}
                </button>
                <button 
                  onClick={handleDeepScrapeDefaults} 
                  disabled={isRunning} 
                  style={{ flex: '1 1 100%', padding: '0.75rem', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid #8b5cf6', color: '#8b5cf6', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600 }}
                  title="Uses Ollama to autonomously click and navigate through the websites."
                >
                  <Cpu size={18} /> {isRunning ? 'Starting...' : 'Deep Scrape Defaults (Agentic)'}
                </button>
              </div>
              
              {isRunning && (
                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--surface-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Status: <span style={{ color: 'var(--text-primary)' }}>{liveStatus}</span></span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent-color)', transition: 'width 0.3s' }}></div>
                      </div>
                      <button 
                        onClick={async () => {
                          await cancelScraper();
                          alert("Cancellation requested. The scraper will stop processing shortly.");
                        }}
                        style={{ marginTop: '12px', width: '100%', padding: '8px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        Stop / Cancel Scraper
                      </button>
                    </div>
                  )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Scraped Jobs Dashboard
            </h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox" 
                checked={showHiddenJobs} 
                onChange={e => setShowHiddenJobs(e.target.checked)} 
                style={{ cursor: 'pointer' }}
              />
              Show Hidden Jobs
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredJobs.length === 0 ? (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No jobs found yet. Run the scraper to populate this dashboard!
              </div>
            ) : (
              filteredJobs.map((job) => {
                const isExpanded = expandedJobId === job.id;
                const isOriginal = showingOriginals[job.id];
                let originalData = null;
                if (job.original_job_data) {
                  try {
                    originalData = JSON.parse(job.original_job_data);
                  } catch (e) {}
                }
                const displayTitle = isOriginal && originalData ? originalData.title : job.title;
                const displayCompany = isOriginal && originalData ? originalData.company : job.company;
                const displayLocation = isOriginal && originalData ? originalData.location : job.location;
                const displayDescription = isOriginal && originalData ? originalData.description : job.description;

                return (
                  <div key={job.id} className="glass-panel" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => setExpandedJobId(isExpanded ? null : job.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '4px', color: job.is_hidden ? 'var(--text-secondary)' : 'var(--accent-color)', textDecoration: job.is_hidden ? 'line-through' : 'none' }}>{displayTitle}</h3>
                        <div style={{ color: 'var(--text-secondary)' }}>
                          {displayCompany} {displayLocation && `• ${displayLocation}`} 
                          {job.is_hidden ? <span style={{ marginLeft: '8px', fontSize: '0.8rem', padding: '2px 6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Hidden</span> : null}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className="kanban-badge" style={{ background: 'var(--surface-color)', border: '1px solid var(--surface-border)' }}>
                          <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
                          {job.source_website}
                        </span>
                        <span className="kanban-badge" style={{ 
                          background: job.match_score >= 80 ? 'rgba(34, 197, 94, 0.2)' : 
                                      job.match_score >= 60 ? 'rgba(234, 179, 8, 0.2)' : 
                                      'rgba(239, 68, 68, 0.2)',
                          color: job.match_score >= 80 ? '#4ade80' : 
                                 job.match_score >= 60 ? '#facc15' : 
                                 '#f87171',
                          border: '1px solid currentColor'
                        }}>
                          {job.match_score}% Profile Match
                        </span>
                        {job.goal_match_score != null && (
                          <span className="kanban-badge" style={{ 
                            background: job.goal_match_score >= 80 ? 'rgba(59, 130, 246, 0.2)' : 
                                        job.goal_match_score >= 60 ? 'rgba(168, 85, 247, 0.2)' : 
                                        'rgba(236, 72, 153, 0.2)',
                            color: job.goal_match_score >= 80 ? '#60a5fa' : 
                                   job.goal_match_score >= 60 ? '#c084fc' : 
                                   '#f472b6',
                            border: '1px solid currentColor'
                          }}>
                            {job.goal_match_score}% Goal Match
                          </span>
                        )}
                        {job.deletion_suggested === 1 && (
                          <span className="kanban-badge" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }} title="AI flagged this as an invalid job post. See AI Cleanup tab to keep or delete.">
                            Deletion Suggested
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div style={{ 
                      fontSize: '0.9rem', 
                      color: 'var(--text-secondary)', 
                      marginBottom: '1.5rem', 
                      maxHeight: isExpanded ? 'none' : '100px', 
                      overflow: 'hidden', 
                      textOverflow: isExpanded ? 'clip' : 'ellipsis', 
                      display: isExpanded ? 'block' : '-webkit-box', 
                      WebkitLineClamp: isExpanded ? undefined : 3, 
                      WebkitBoxOrient: 'vertical',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {displayDescription}
                      {isExpanded && job.notes && (
                        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', borderLeft: '3px solid var(--accent-color)' }}>
                          <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '8px' }}>AI Match Reasoning:</strong>
                          {job.notes}
                        </div>
                      )}
                      {isExpanded && job.url && (
                         <div style={{ marginTop: '1rem' }}>
                           <a href={job.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}>View Original Posting</a>
                         </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                      {job.original_job_data ? (
                        <div style={{ display: 'flex', border: '1px solid rgba(168, 85, 247, 0.2)', borderRadius: '6px', overflow: 'hidden', background: 'rgba(168, 85, 247, 0.05)' }}>
                          <button 
                            className="btn-secondary" 
                            onClick={(e) => { e.stopPropagation(); setShowingOriginals(prev => ({ ...prev, [job.id]: !prev[job.id] })); }}
                            style={{ border: 'none', borderRight: '1px solid rgba(168, 85, 247, 0.2)', background: showingOriginals[job.id] ? 'rgba(168, 85, 247, 0.2)' : 'transparent', color: '#c084fc', margin: 0, borderRadius: 0 }}
                            title="Toggle Clean/Original View"
                          >
                            {showingOriginals[job.id] ? 'Original View' : 'Cleaned View'}
                          </button>
                          <button 
                            className="btn-secondary" 
                            onClick={(e) => { e.stopPropagation(); handleCleanup(job.id); }}
                            disabled={cleaningJobs[job.id] || globalCleaningJobs[job.id]}
                            style={{ border: 'none', background: 'transparent', color: '#c084fc', margin: 0, borderRadius: 0 }}
                            title="Re-run AI Cleanup"
                          >
                            {(cleaningJobs[job.id] || globalCleaningJobs[job.id]) ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Re-run
                          </button>
                        </div>
                      ) : (
                        <button 
                          className="btn-secondary" 
                          onClick={(e) => { e.stopPropagation(); handleCleanup(job.id); }}
                          disabled={cleaningJobs[job.id] || globalCleaningJobs[job.id]}
                          style={{ color: '#c084fc' }}
                          title="Clean up with AI"
                        >
                          {(cleaningJobs[job.id] || globalCleaningJobs[job.id]) ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />} AI Clean
                        </button>
                      )}
                      {job.is_hidden ? (
                        <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); handleUnhide(job.id); }} style={{ color: 'var(--text-primary)' }} title="Unhide this job">
                          <Eye size={16} /> Unhide
                        </button>
                      ) : (
                        <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); handleHide(job.id); }} style={{ color: 'var(--text-secondary)' }} title="Hide job so scraper remembers to skip it">
                          <EyeOff size={16} /> Hide
                        </button>
                      )}
                      <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); handleHardDelete(job.id); }} style={{ color: '#ef4444' }} title="Permanently delete job">
                        <Trash2 size={16} /> Delete
                      </button>
                      <button className="btn-primary" onClick={(e) => { e.stopPropagation(); handleMove(job.id); }}>
                        <ArrowRight size={16} /> Move to Main Tracker
                      </button>
                    </div>
                </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={18} className="text-accent" /> Scraper Health Logs
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn-secondary" onClick={() => router.refresh()} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Refresh Logs</button>
              {logs.length === 0 ? (
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>No logs yet.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} style={{ 
                    padding: '0.75rem', 
                    borderRadius: '6px', 
                    fontSize: '0.85rem',
                    background: log.status === 'success' ? 'rgba(34, 197, 94, 0.1)' : 
                                log.status === 'blocked' ? 'rgba(239, 68, 68, 0.1)' : 
                                log.status === 'running' ? 'rgba(56, 189, 248, 0.1)' :
                                'rgba(0,0,0,0.2)',
                    borderLeft: `3px solid ${
                      log.status === 'success' ? '#4ade80' : 
                      log.status === 'blocked' ? '#f87171' : 
                      log.status === 'running' ? '#38bdf8' : 
                      '#94a3b8'
                    }`
                  }}>
                    <div suppressHydrationWarning style={{ fontWeight: 600, marginBottom: '4px' }}>{new Date(log.created_at).toLocaleString()}</div>
                    <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-all', marginBottom: '4px' }}>{log.url}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{log.status}</span>
                      {log.status === 'success' && <span>{log.jobs_found} jobs</span>}
                    </div>
                    {log.error_message && <div style={{ color: '#f87171', marginTop: '4px', fontSize: '0.8rem' }}>{log.error_message}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
