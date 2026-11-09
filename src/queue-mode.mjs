// Bulk Start/Continue stays paused. Each explicit Add has a separate one-shot
// permission to send only its newly saved request through Sidebar Chat.
export const MANUAL_QUEUE_MODE = true;
export const MANUAL_QUEUE_MESSAGE = 'Add to queue copies and sends that new job in Sidebar Chat. Bulk Start/Continue is paused; older jobs are not sent automatically.';
