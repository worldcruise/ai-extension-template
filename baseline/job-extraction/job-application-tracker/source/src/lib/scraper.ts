import { chromium } from 'playwright';
import { getDb } from './db';
import { generateEmbedding, cosineSimilarity, generateTextOllama, calculateMatchScore, callScraperLLM } from './ml';

// Basic configuration for the persistent context
const USER_DATA_DIR = './playwright-user-data';

interface ScrapedJobRaw {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
}

/**
 * A highly generic parser that just looks for common job card patterns.
 */
async function parseGeneric(page: any, targetUrl: string, pageNumber: number = 1): Promise<ScrapedJobRaw[]> {
  await page.waitForTimeout(5000);
  
  if (pageNumber > 1) {
    // LLM-powered Pagination
    const interactiveElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, a'));
      return elements
        .filter(el => {
          const rect = el.getBoundingClientRect();
          // Look at elements in the bottom half of the page
          return rect.top > window.innerHeight / 2 && rect.top < window.innerHeight * 2;
        })
        .map(el => (el as HTMLElement).innerText.trim())
        .filter(text => text.length > 0 && text.length < 30);
    });

    const uniqueElements = Array.from(new Set(interactiveElements));
    if (uniqueElements.length > 0) {
      const prompt = `You are a web scraping assistant. Given this list of text from buttons/links near the bottom of a webpage, which one is most likely the 'Next Page', 'Load More', or 'Show More' button?
Return ONLY a JSON object: {"nextButtonText": "exact text"} or {"nextButtonText": null} if none match.
Elements: ${JSON.stringify(uniqueElements.slice(0, 50))}`;
      
      try {
        let response = await callScraperLLM(prompt);
        response = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.nextButtonText) {
            console.log(`[Scraper] LLM identified next button: ${parsed.nextButtonText}`);
            await page.evaluate((textToClick: string) => {
              const buttons = Array.from(document.querySelectorAll('button, a'));
              for (const btn of buttons) {
                if ((btn as HTMLElement).innerText.trim() === textToClick) {
                  (btn as HTMLElement).click();
                  break;
                }
              }
            }, parsed.nextButtonText);
            await page.waitForTimeout(3000);
          }
        }
      } catch (err) {
        console.error("LLM Pagination failed, skipping click", err);
      }
    }
  }

  // Auto-scroll a few times to trigger lazy loading/infinite scrolling jobs
  const scrollAttempts = 3 * pageNumber;
  for (let i = 0; i < scrollAttempts; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
  
  // LLM-powered Link Extraction
  const allLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .filter(a => {
        const href = a.href;
        const text = a.innerText.trim();
        // Basic pre-filtering to save tokens
        if (!href || href.startsWith('javascript:') || href === '#' || text.length < 5) return false;
        if (text.toLowerCase().includes('about us') || text.toLowerCase().includes('privacy')) return false;
        return true;
      })
      .map(a => ({ href: a.href, text: a.innerText.trim().substring(0, 100) }));
  });

  // Deduplicate links by href
  const uniqueLinksMap = new Map();
  for (const link of allLinks) {
    if (!uniqueLinksMap.has(link.href)) uniqueLinksMap.set(link.href, link.text);
  }
  const uniqueLinks = Array.from(uniqueLinksMap.entries()).map(([href, text]) => ({ href, text }));
  
  let jobLinks: string[] = [];
  
  // Batch processing (process up to 50 links to avoid huge context and truncation)
  const linksToProcess = uniqueLinks.slice(0, 50);
  if (linksToProcess.length > 0) {
    const prompt = `You are a web scraping assistant. You are given a JSON array of links and their text extracted from a job board webpage. 
Your task is to identify which links point to individual job postings. 
Exclude links to 'About Us', login, generic category pages, or the company homepage.
Return a JSON array of strings containing ONLY the exact URLs (href) that point to job postings. 
CRITICAL RULES:
1. Do not include markdown blocks or any other text. 
2. Output ONLY a valid JSON array of strings.
3. NEVER use comments like "// ..." or "# ..." to truncate the JSON. Output the FULL, valid JSON array.

Input Links: ${JSON.stringify(linksToProcess)}`;

    try {
      let response = await callScraperLLM(prompt);
      response = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      
      try {
        jobLinks = JSON.parse(response);
      } catch (e) {
        const jsonMatch = response.match(/\[.*\]/s);
        if (jsonMatch) {
          jobLinks = JSON.parse(jsonMatch[0]);
        }
      }
      if (!Array.isArray(jobLinks)) jobLinks = [];
    } catch (err) {
      console.error("LLM Link Extraction failed, returning empty array", err);
    }
  }

  const db = getDb();
  const jobs: ScrapedJobRaw[] = [];
  
  // Tier 3: Raw Text LLM Extraction Fallback
  if (jobLinks.length === 0) {
    console.log(`[Scraper] Tier 2 (DOM Links) yielded 0 job links, falling back to Tier 3 (Raw Text)...`);
    const pageText = await page.evaluate(() => document.body.innerText);
    const truncatedText = pageText.substring(0, 4000);
    
    const textPrompt = `You are a web scraping assistant. I am providing you the raw visible text from a job board webpage. 
Extract all job postings you can find. 
Return a JSON array of objects, where each object has exactly these string keys: "title", "company", "location". 
CRITICAL RULES:
1. Do not include markdown blocks or any other text. 
2. Output ONLY a valid JSON array of objects.
3. NEVER use comments like "// ..." or "# ..." to truncate the JSON. Output the FULL, valid JSON array.
If you cannot find any jobs, return [].

Page Text:
${truncatedText}`;
    
    try {
      let response = await callScraperLLM(textPrompt);
      response = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      
      let jobsList: any[] = [];
      try {
        jobsList = JSON.parse(response);
      } catch (e) {
        const jsonMatch = response.match(/\[.*\]/s);
        if (jsonMatch) {
          jobsList = JSON.parse(jsonMatch[0]);
        }
      }
      
      if (Array.isArray(jobsList)) {
        for (const job of jobsList) {
          if (jobs.length >= 50) break;
          if (!job.title || !job.company) continue;
          
          const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE title = ? AND company = ?').get(job.title, job.company);
          const existingMain = db.prepare('SELECT id FROM jobs WHERE title = ? AND company = ?').get(job.title, job.company);
          const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE title = ? AND company = ?').get(job.title, job.company);
          if (existingScraped || existingMain || existingIgnored) continue;
          
          jobs.push({
            title: job.title.toString().substring(0, 200).trim(),
            company: job.company.toString().substring(0, 100).trim(),
            location: job.location?.toString().substring(0, 100).trim() || 'Unknown',
            url: targetUrl, // Set to the board's URL since we have no individual link
            description: ''
          });
        }
      }
    } catch (err) {
      console.error("Tier 3 LLM Extraction failed", err);
    }
    
    return jobs;
  }

  // Quick URL-based Deduplication before expensive page visits
  const validLinks = jobLinks.filter((link: string) => {
    const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE url = ? AND url IS NOT NULL AND url != \'\'').get(link);
    const existingMain = db.prepare('SELECT id FROM jobs WHERE url = ? AND url IS NOT NULL AND url != \'\'').get(link);
    const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE url = ? AND url IS NOT NULL AND url != \'\'').get(link);
    return !existingScraped && !existingMain && !existingIgnored;
  });

  console.log(`[Scraper] Found ${jobLinks.length} links on page, ${validLinks.length} are new URLs.`);
  
  // Visit each valid link to get the description
  for (const link of validLinks) {
    if (jobs.length >= 50) break; // Stop when we've successfully gathered 50 NEW jobs

    const cancelFlag = db.prepare("SELECT value FROM settings WHERE key = 'scraper_cancel_requested'").get() as any;
    if (cancelFlag && cancelFlag.value === 'true') {
      console.log("[Scraper] Task was cancelled by the user during link collection.");
      throw new Error('CANCELLED_BY_USER');
    }

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      
      const details = await page.evaluate(() => {
        const titleText = document.querySelector('h1')?.innerText || document.title || 'Unknown Title';
        const bodyText = document.body.innerText;
        // Truncate body text to a reasonable length for the LLM
        return {
          title: titleText.substring(0, 200).replace(/\n/g, ' ').trim(),
          company: 'Unknown Company',
          location: 'Remote/Unknown',
          description: bodyText.substring(0, 3000)
        };
      });
      
      // Secondary Title+Company Deduplication Check
      const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE title = ? AND company = ?').get(details.title, details.company);
      const existingMain = db.prepare('SELECT id FROM jobs WHERE title = ? AND company = ?').get(details.title, details.company);
      const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE title = ? AND company = ?').get(details.title, details.company);
      
      if (existingScraped || existingMain || existingIgnored) {
        console.log(`[Scraper] Skipping duplicate job during parse: ${details.title}`);
        continue;
      }
      
      jobs.push({
        url: link,
        ...details
      });
    } catch (e) {
      console.error("Failed to scrape link: " + link);
    }
  }

  return jobs;
}

export async function runScraperTask(url: string, website: string, focus: string, minMatch: number, minGoalMatch: number, pageNumber: number = 1) {
  const db = getDb();
  
  const updateStatus = (status: string, progress: number) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_live_status', status);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_progress', progress.toString());
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_heartbeat', Date.now().toString());
  };

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_is_running', 'true');

  // Create Log Entry
  let targetUrl = url;
  if (pageNumber > 1) {
    if (url.includes('news.ycombinator.com')) {
      targetUrl = url.includes('?') ? `${url}&p=${pageNumber}` : `${url}?p=${pageNumber}`;
    } else {
      targetUrl = url.includes('?') ? `${url}&page=${pageNumber}` : `${url}?page=${pageNumber}`;
    }
  }

  const logInfo = db.prepare('INSERT INTO scraper_logs (website, url, status) VALUES (?, ?, ?)').run(website, targetUrl, 'running');
  const logId = logInfo.lastInsertRowid;

  const headlessSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('scraper_headless') as any;
  const isHeadless = headlessSetting ? headlessSetting.value !== 'false' : true;

  let browser;
  try {
    updateStatus(`Launching browser to scrape ${website} (Page ${pageNumber})...`, 5);
    // Launch persistent context to avoid anti-bot and save cookies
    browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: isHeadless,
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await browser.newPage();
    
    // Tier 1: Network Sniffing
    let sniffedJobs: any[] = [];
    page.on('response', async (response: any) => {
      const type = response.request().resourceType();
      if (type === 'fetch' || type === 'xhr') {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            
            const findJobArrays = (obj: any): any[] => {
              let found: any[] = [];
              if (Array.isArray(obj)) {
                if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
                  const sampleStr = JSON.stringify(obj[0]).toLowerCase();
                  if ((sampleStr.includes('title') || sampleStr.includes('role') || sampleStr.includes('headline')) && 
                      (sampleStr.includes('company') || sampleStr.includes('employer') || sampleStr.includes('organization'))) {
                     found = found.concat(obj);
                  }
                }
              } else if (obj !== null && typeof obj === 'object') {
                for (const key of Object.keys(obj)) {
                  found = found.concat(findJobArrays(obj[key]));
                }
              }
              return found;
            };
            const potentialJobs = findJobArrays(json);
            if (potentialJobs.length > 0) {
              sniffedJobs = sniffedJobs.concat(potentialJobs);
            }
          }
        } catch (e) {
          // Ignore parsing errors for non-JSON or dropped requests
        }
      }
    });

    console.log(`[Scraper] Navigating to ${targetUrl}...`);
    updateStatus(`Navigating to ${targetUrl}...`, 15);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    // Wait for dynamic content to render instead of relying on networkidle (which hangs on sites with websockets/analytics)
    await page.waitForTimeout(4000);
    
    // Check for Cloudflare / CAPTCHA blocks
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (pageText.includes('checking if the site connection is secure') || 
        pageText.includes('verify you are human') || 
        pageText.includes('cloudflare')) {
        if (!isHeadless) {
          console.log("[Scraper] Cloudflare detected in headful mode! Waiting 60 seconds for you to solve it...");
          updateStatus(`CAPTCHA detected! Please solve it in the Chromium window. Waiting 60s...`, 15);
          await page.waitForTimeout(60000); // 60 seconds for user to solve
        } else {
          throw new Error('BLOCKED_BY_CLOUDFLARE');
        }
    }

    // Dynamic Search Execution
    if (focus && pageNumber === 1) {
      updateStatus(`Preparing to search for "${focus}"...`, 20);
      const inputs = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('input, textarea'));
        return els.map(el => {
          const e = el as HTMLInputElement;
          return {
            tag: e.tagName,
            type: e.type,
            placeholder: e.placeholder || '',
            id: e.id || '',
            name: e.name || '',
            ariaLabel: e.getAttribute('aria-label') || ''
          };
        }).filter(e => e.type !== 'hidden' && e.type !== 'submit' && e.type !== 'button');
      });

      if (inputs.length > 0) {
        const prompt = `You are a web scraping assistant. You need to search for a job with the keyword: "${focus}".
Here is a list of input fields found on the page.
Determine which input field is the primary job search or keyword search box.
If you find it, return a JSON object with the "id" or "name" of the input field, and the "textToType" (which should be the keyword).
If none of them look like a search box, return {"id": null, "name": null, "textToType": null}.
Input fields: ${JSON.stringify(inputs)}
Return ONLY a valid JSON object.`;

        try {
          let response = await callScraperLLM(prompt);
          response = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.id || parsed.name) {
              const selector = parsed.id ? `[id="\${parsed.id}"]` : `[name="\${parsed.name}"]`;
              console.log(`[Scraper] LLM identified search box: \${selector}, typing: \${parsed.textToType}`);
              await page.fill(selector, parsed.textToType);
              await page.keyboard.press('Enter');
              await page.waitForTimeout(5000); // wait for search results to load
            }
          }
        } catch (err) {
          console.error("LLM Search Execution failed", err);
        }
      }
    }

    let rawJobs: ScrapedJobRaw[] = [];
    
    // Tier 1: Process Sniffed JSON Jobs
    if (sniffedJobs.length > 0) {
      console.log(`[Scraper] Tier 1: Found ${sniffedJobs.length} potential jobs in network traffic.`);
      for (const item of sniffedJobs) {
        if (rawJobs.length >= 50) break;
        
        let title = item.title || item.job_title || item.role || item.name || item.headline;
        let company = item.company?.name || item.company_name || item.employer?.name || item.company || website;
        let location = item.location?.name || item.location || item.workplace_type || 'Unknown';
        let jobUrl = item.apply_url || item.url || item.job_url || item.absolute_url || item.canonical_url;
        let description = item.description || item.body || item.content || item.summary || '';
        
        if (typeof company === 'object' && company !== null) company = JSON.stringify(company);
        if (typeof location === 'object' && location !== null) location = JSON.stringify(location);
        
        if (!title || typeof title !== 'string') continue;
        if (!jobUrl || typeof jobUrl !== 'string') jobUrl = targetUrl;
        if (!jobUrl.startsWith('http')) {
          try { jobUrl = new URL(jobUrl, targetUrl).href; } catch(e) {}
        }
        
        rawJobs.push({
          title: title.substring(0, 200).trim(),
          company: company.toString().substring(0, 100).trim(),
          location: location.toString().substring(0, 100).trim(),
          url: jobUrl,
          description: typeof description === 'string' ? description.substring(0, 3000) : ''
        });
      }
      
      // Deduplicate internally
      const uniqueScraped = [];
      const seen = new Set();
      for (const j of rawJobs) {
        const key = j.title + '|' + j.company;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueScraped.push(j);
        }
      }
      rawJobs = uniqueScraped;
      
      // Filter out DB duplicates
      rawJobs = rawJobs.filter(j => {
        const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE title = ? AND company = ?').get(j.title, j.company);
        const existingMain = db.prepare('SELECT id FROM jobs WHERE title = ? AND company = ?').get(j.title, j.company);
        const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE title = ? AND company = ?').get(j.title, j.company);
        return !existingScraped && !existingMain && !existingIgnored;
      });
      console.log(`[Scraper] Tier 1 yielded ${rawJobs.length} new jobs.`);
    }

    if (rawJobs.length === 0) {
      console.log(`[Scraper] Tier 1 yielded 0 jobs, falling back to DOM Parsing...`);
      updateStatus(`Parsing job listings from ${website}...`, 30);
      rawJobs = await parseGeneric(page, targetUrl, pageNumber); 
    }

    console.log(`[Scraper] Found ${rawJobs.length} raw jobs. Filtering...`);
    updateStatus(`Found ${rawJobs.length} raw jobs. Evaluating matches...`, 40);
    let jobsAdded = 0;

    // Get the user's profile vector
    const profiles = db.prepare('SELECT vector FROM materials WHERE is_profile = 1').all() as any[];
    let combinedProfileVector: number[] | null = null;
    
    if (profiles.length > 0) {
      const parsedProfiles = profiles.map(p => p.vector ? JSON.parse(p.vector) : null).filter(v => v !== null);
      if (parsedProfiles.length > 0) {
        const dim = parsedProfiles[0].length;
        combinedProfileVector = new Array(dim).fill(0);
        for (const vec of parsedProfiles) {
          for (let i = 0; i < dim; i++) {
            combinedProfileVector[i] += vec[i];
          }
        }
        for (let i = 0; i < dim; i++) {
          combinedProfileVector[i] /= parsedProfiles.length;
        }
      }
    }

    // Get Calibration Settings
    const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
    const settingsMap = settings.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    const calibrationMode = settingsMap['calibration_mode'] || 'simple';
    const minSim = parseFloat(settingsMap['calibration_min'] || '0.55');
    const maxSim = parseFloat(settingsMap['calibration_max'] || '0.85');
    const calibrationCurve = JSON.parse(settingsMap['calibration_curve'] || '[]');
    
    let targetJobGoalVector: number[] | null = null;
    if (settingsMap['target_job_goal_vector']) {
      try {
        targetJobGoalVector = JSON.parse(settingsMap['target_job_goal_vector']);
      } catch (err) {}
    }

    let processed = 0;
    for (const job of rawJobs) {
      processed++;
      
      // EXPLICIT YIELD: The Builtin LLM inference is extremely heavy and blocks the Node.js event loop.
      // We must artificially pause for 500ms before processing each job so the Next.js server has time
      // to process incoming HTTP requests from the frontend UI (button clicks, polling, etc).
      await new Promise(resolve => setTimeout(resolve, 500));

      // CHECK FOR CANCELLATION
      const cancelFlag = db.prepare("SELECT value FROM settings WHERE key = 'scraper_cancel_requested'").get() as any;
      if (cancelFlag && cancelFlag.value === 'true') {
        console.log("[Scraper] Task was cancelled by the user.");
        throw new Error('CANCELLED_BY_USER');
      }
      
      // DE-DUPLICATION CHECK
      const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(job.url, job.title, job.company);
      const existingMain = db.prepare('SELECT id FROM jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(job.url, job.title, job.company);
      const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(job.url, job.title, job.company);
      
      if (existingScraped || existingMain || existingIgnored) {
        console.log(`[Scraper] Skipping duplicate job: ${job.title} at ${job.company}`);
        continue;
      }

      const baseProgress = 40;
      const progressInc = (processed / rawJobs.length) * 60;
      updateStatus(`Evaluating Job ${processed}/${rawJobs.length}: ${job.title.substring(0,30)}...`, baseProgress + progressInc);
      
      let focusPassed = 1;
      let lastFocus = focus || '';


      if (combinedProfileVector || targetJobGoalVector) {
        const jobVector = await generateEmbedding(`${job.title} - ${job.company}\n\n${job.description}`);
        
        let matchScore = 0;
        let goalMatchScore = 0;
        
        if (combinedProfileVector) {
          const similarity = cosineSimilarity(combinedProfileVector, jobVector);
          matchScore = calculateMatchScore(similarity, calibrationMode, calibrationCurve, minSim, maxSim);
        }
        
        if (targetJobGoalVector) {
          const goalSimilarity = cosineSimilarity(targetJobGoalVector, jobVector);
          goalMatchScore = calculateMatchScore(goalSimilarity, calibrationMode, calibrationCurve, minSim, maxSim);
        }

        db.prepare(`
          INSERT INTO scraped_jobs (title, company, location, url, description, source_website, match_score, goal_match_score, vector, focus_passed, last_focus_evaluated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(job.title, job.company, job.location, job.url, job.description, website, matchScore, goalMatchScore, JSON.stringify(jobVector), focusPassed, lastFocus);
        
        if (matchScore >= minMatch && goalMatchScore >= minGoalMatch && focusPassed === 1) {
          jobsAdded++;
          console.log(`[Scraper] Matched job: ${job.title} (Match: ${matchScore}%, Goal: ${goalMatchScore}%)`);
        } else {
          console.log(`[Scraper] Job cached (didn't meet criteria): ${job.title} (Match: ${matchScore}%, Goal: ${goalMatchScore}%, Focus: ${focusPassed})`);
        }
      } else {
        const jobVector = await generateEmbedding(`${job.title} - ${job.company}\n\n${job.description}`);
        
        db.prepare(`
          INSERT INTO scraped_jobs (title, company, location, url, description, source_website, match_score, goal_match_score, vector, focus_passed, last_focus_evaluated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(job.title, job.company, job.location, job.url, job.description, website, 100, 100, JSON.stringify(jobVector), focusPassed, lastFocus);
        
        if (focusPassed === 1) {
          jobsAdded++;
          console.log(`[Scraper] Matched job without vectors: ${job.title}`);
        } else {
          console.log(`[Scraper] Cached job (failed focus): ${job.title}`);
        }
      }
    }

    db.prepare('UPDATE scraper_logs SET status = ?, jobs_found = ? WHERE id = ?').run('success', jobsAdded, logId);
    if (jobsAdded === 0 && rawJobs.length > 0) {
      updateStatus(`Success: Parsed ${rawJobs.length} jobs, but 0 matched your Focus Filter or 80% Match threshold.`, 100);
    } else {
      updateStatus(`Success: Scraped ${website} and added ${jobsAdded} matching jobs.`, 100);
    }
    return { jobsAdded };
  } catch (err: any) {
    console.error('[Scraper Error]', err);
    if (err.message === 'CANCELLED_BY_USER') {
      db.prepare('UPDATE scraper_logs SET status = ?, error_message = ? WHERE id = ?').run('cancelled', 'Cancelled by user', logId);
      updateStatus(`Cancelled: Scraper was aborted by the user.`, 100);
    } else {
      const status = err.message.includes('BLOCKED') ? 'blocked' : 'error';
      db.prepare('UPDATE scraper_logs SET status = ?, error_message = ? WHERE id = ?').run(status, err.message, logId);
      updateStatus(`Failed: ${err.message}`, 100);
    }
    return { jobsAdded: 0 };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function runDeepScrapeTask(targetUrl: string, website: string, focus: string, minMatch: number, minGoalMatch: number) {
  const db = getDb();
  let browser;
  let totalJobsAdded = 0;
  try {
    const logResult = db.prepare('INSERT INTO scraper_logs (website, status, url) VALUES (?, ?, ?)').run(website, 'deep-running', targetUrl);
    const logId = logResult.lastInsertRowid;
    const updateStatus = (msg: string, p: number) => {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(msg, 'scraper_live_status');
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(p.toString(), 'scraper_progress');
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_heartbeat', Date.now().toString());
    };
    
    updateStatus(`Deep Scrape: Launching browser for ${website}...`, 5);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    const page = await context.newPage();
    
    // Tier 1: Background Sniffer
    let sniffedJobs: any[] = [];
    page.on('response', async (res) => {
      try {
        if (res.request().resourceType() === 'fetch' || res.request().resourceType() === 'xhr') {
          const contentType = res.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await res.json();
            const str = JSON.stringify(json);
            if (str.length > 500 && (str.includes('"title"') || str.includes('"company"'))) {
              if (Array.isArray(json) && json.length > 0 && typeof json[0] === 'object') {
                sniffedJobs.push(...json);
              } else if (json.jobs || json.data || json.results || json.postings || json.nodes) {
                const arr = json.jobs || json.data || json.results || json.postings || json.nodes;
                if (Array.isArray(arr) && arr.length > 0) sniffedJobs.push(...arr);
                else if (Array.isArray(json.data?.jobs)) sniffedJobs.push(...json.data.jobs);
              }
            }
          }
        }
      } catch (e) {}
    });

    updateStatus(`Deep Scrape: Navigating to ${targetUrl}...`, 10);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const MAX_ITERATIONS = 10;
    
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      const cancelFlag = db.prepare("SELECT value FROM settings WHERE key = 'scraper_cancel_requested'").get() as any;
      if (cancelFlag && cancelFlag.value === 'true') break;
      
      updateStatus(`Deep Scrape Iteration ${iteration}: Harvesting jobs...`, 10 + (iteration * 8));
      
      // 1. Process current screen jobs via Sniffed + Tier 2 + Tier 3
      let rawJobs: ScrapedJobRaw[] = [];
      if (sniffedJobs.length > 0) {
        for (const item of sniffedJobs) {
          if (rawJobs.length >= 50) break;
          let title = item.title || item.job_title || item.role || item.name || item.headline;
          let company = item.company?.name || item.company_name || item.employer?.name || item.company || website;
          let location = item.location?.name || item.location || item.workplace_type || 'Unknown';
          let jobUrl = item.apply_url || item.url || item.job_url || item.absolute_url || item.canonical_url;
          let description = item.description || item.body || item.content || item.summary || '';
          if (typeof company === 'object' && company !== null) company = JSON.stringify(company);
          if (typeof location === 'object' && location !== null) location = JSON.stringify(location);
          if (!title || typeof title !== 'string') continue;
          if (!jobUrl || typeof jobUrl !== 'string') jobUrl = page.url();
          if (!jobUrl.startsWith('http')) {
            try { jobUrl = new URL(jobUrl, page.url()).href; } catch(e) {}
          }
          rawJobs.push({ title: title.substring(0, 200).trim(), company: company.toString().substring(0, 100).trim(), location: location.toString().substring(0, 100).trim(), url: jobUrl, description: typeof description === 'string' ? description.substring(0, 3000) : '' });
        }
        sniffedJobs = []; // clear for next iteration
      }
      
      const domJobs = await parseGeneric(page, page.url(), 1);
      rawJobs.push(...domJobs);
      
      // Filter out DB duplicates early
      rawJobs = rawJobs.filter(j => {
        const existingScraped = db.prepare('SELECT id FROM scraped_jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(j.url, j.title, j.company);
        const existingMain = db.prepare('SELECT id FROM jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(j.url, j.title, j.company);
        const existingIgnored = db.prepare('SELECT id FROM ignored_jobs WHERE (url = ? AND url IS NOT NULL AND url != \'\') OR (title = ? AND company = ?)').get(j.url, j.title, j.company);
        return !existingScraped && !existingMain && !existingIgnored;
      });

      // Deduplicate internally
      const uniqueScraped = [];
      const seen = new Set();
      for (const j of rawJobs) {
        const key = j.title + '|' + j.company;
        if (!seen.has(key)) { seen.add(key); uniqueScraped.push(j); }
      }
      rawJobs = uniqueScraped;
      
      if (rawJobs.length > 0) {
        updateStatus(`Deep Scrape Iteration ${iteration}: Saving ${rawJobs.length} new jobs to DB...`, 15 + (iteration * 8));
        const profiles = db.prepare('SELECT vector FROM materials WHERE is_profile = 1').all() as any[];
        let combinedProfileVector: number[] | null = null;
        if (profiles.length > 0) {
          const parsedProfiles = profiles.map(p => p.vector ? JSON.parse(p.vector) : null).filter(v => v !== null);
          if (parsedProfiles.length > 0) {
            const dim = parsedProfiles[0].length;
            combinedProfileVector = new Array(dim).fill(0);
            for (const vec of parsedProfiles) {
              for (let i = 0; i < dim; i++) combinedProfileVector[i] += vec[i];
            }
            for (let i = 0; i < dim; i++) combinedProfileVector[i] /= parsedProfiles.length;
          }
        }
        
        const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
        const settingsMap = settings.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        const calibrationMode = settingsMap['calibration_mode'] || 'simple';
        const minSim = parseFloat(settingsMap['calibration_min'] || '0.55');
        const maxSim = parseFloat(settingsMap['calibration_max'] || '0.85');
        const calibrationCurve = JSON.parse(settingsMap['calibration_curve'] || '[]');
        
        let targetJobGoalVector: number[] | null = null;
        if (settingsMap['target_job_goal_vector']) {
          try { targetJobGoalVector = JSON.parse(settingsMap['target_job_goal_vector']); } catch (err) {}
        }

        for (const job of rawJobs) {
          await new Promise(resolve => setTimeout(resolve, 100)); // yield
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('scraper_heartbeat', Date.now().toString());
          // Title weighting hack: repeat title 4 times to heavily bias the semantic vector towards the title
          const jobVector = await generateEmbedding(`${job.title}\n${job.title}\n${job.title}\n${job.title} - ${job.company}\n\n${job.description}`);
          let matchScore = 100;
          let goalMatchScore = 100;
          if (combinedProfileVector) {
            const similarity = cosineSimilarity(combinedProfileVector, jobVector);
            matchScore = calculateMatchScore(similarity, calibrationMode, calibrationCurve, minSim, maxSim);
          }
          if (targetJobGoalVector) {
            const goalSimilarity = cosineSimilarity(targetJobGoalVector, jobVector);
            goalMatchScore = calculateMatchScore(goalSimilarity, calibrationMode, calibrationCurve, minSim, maxSim);
          }
          
          db.prepare(`
            INSERT INTO scraped_jobs (title, company, location, url, description, source_website, match_score, goal_match_score, vector, focus_passed, last_focus_evaluated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(job.title, job.company, job.location, job.url, job.description, website, matchScore, goalMatchScore, JSON.stringify(jobVector), 1, focus);
          
          if (matchScore >= minMatch && goalMatchScore >= minGoalMatch) totalJobsAdded++;
        }
      }

      // 2. Autonomous Navigation Step
      updateStatus(`Deep Scrape Iteration ${iteration}: Determining next move...`, 18 + (iteration * 8));
      
      const domData = await page.evaluate(() => {
        let idCounter = 0;
        const elements = Array.from(document.querySelectorAll('a, button, input[type="text"], input[type="search"]'));
        const interactives = [];
        
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          
          let text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
          if (!text || text.length < 2) continue;
          
          const id = 'ai-node-' + idCounter++;
          el.setAttribute('data-ai-id', id);
          
          interactives.push({
            id,
            tag: el.tagName.toLowerCase(),
            text: text.substring(0, 100).replace(/\n/g, ' '),
            href: el.getAttribute('href') || undefined
          });
          if (interactives.length > 150) break; // Limit context size
        }
        return interactives;
      });
      
      if (domData.length === 0) {
        console.log(`[DeepScrape] No interactives found. Terminating deep scrape for ${website}.`);
        break;
      }

      const prompt = `You are an autonomous web scraper agent. Your goal is to navigate to find jobs matching the focus: "${focus}".
Currently you are on: ${page.url()}
Total jobs added so far: ${totalJobsAdded}
Iteration: ${iteration}/${MAX_ITERATIONS}

Here is a list of interactive elements on the screen.
Determine the BEST next action to explore the site for jobs.
- If you see a search box and haven't searched yet, type the focus keyword.
- If you see a "Next Page" or "Load More" button, click it.
- If you see a category link (like "Software Engineering"), click it.
- If you have already searched and paginated and there's nothing else to do, or if it seems like a dead end, choose "done".

Respond ONLY with a valid JSON object:
{
  "action": "click" | "type" | "done",
  "target_id": "the ID of the element (if clicking or typing)",
  "text": "text to type (if typing)",
  "reasoning": "short explanation"
}

Elements:
${JSON.stringify(domData, null, 2)}
`;

      try {
        let response = await callScraperLLM(prompt);
        response = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const decision = JSON.parse(jsonMatch[0]);
          console.log(`[DeepScrape] LLM decided to ${decision.action} on ${decision.target_id}. Reasoning: ${decision.reasoning}`);
          
          if (decision.action === 'done') {
            break;
          } else if (decision.action === 'type' && decision.target_id) {
            await page.fill(`[data-ai-id="${decision.target_id}"]`, decision.text || focus).catch(() => {});
            await page.keyboard.press('Enter').catch(() => {});
            await page.waitForTimeout(5000);
          } else if (decision.action === 'click' && decision.target_id) {
            await page.click(`[data-ai-id="${decision.target_id}"]`, { timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(5000);
          }
        }
      } catch (err) {
        console.error("[DeepScrape] LLM Navigation failed", err);
      }
    }
    
    db.prepare('UPDATE scraper_logs SET status = ?, jobs_found = ? WHERE id = ?').run('success', totalJobsAdded, logId);
    console.log(`Deep Scrape Success: Explored ${website} and added ${totalJobsAdded} matching jobs.`);
    return { jobsAdded: totalJobsAdded };
  } catch (err: any) {
    console.error('[DeepScrape Error]', err);
    console.log(`Deep Scrape Failed: ${err.message}`);
    return { jobsAdded: totalJobsAdded };
  } finally {
    if (browser) await browser.close();
  }
}

