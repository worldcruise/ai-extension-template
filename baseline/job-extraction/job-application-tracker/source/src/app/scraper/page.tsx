import { getScrapedJobs, getScraperLogs, getSettings } from '@/app/actions';
import ScraperClient from './ScraperClient';

export const dynamic = 'force-dynamic';

export default async function ScraperPage() {
  const jobs = await getScrapedJobs();
  const logs = await getScraperLogs();
  const settings = await getSettings();

  return (
    <ScraperClient 
      initialJobs={jobs}
      initialLogs={logs}
      settings={settings}
    />
  );
}
