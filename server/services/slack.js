const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Fire-and-forget alert for unexpected server errors. Silently no-ops until
// SLACK_WEBHOOK_URL is configured, and never throws — a broken alert path
// must never take down the request it's reporting on.
/**
 * Render anything throwable as readable text. `String(err)` on a plain object
 * yields "[object Object]", which is what several money-path alerts were
 * sending before the Razorpay SDK's bare-object rejections were wrapped.
 */
function describe(error) {
    if (error?.message) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export async function notifySlackError(context, error) {
    if (!SLACK_WEBHOOK_URL) return;
    try {
        await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `:warning: *${context}*\n\`\`\`${describe(error)}\`\`\``,
            }),
        });
    } catch (slackErr) {
        console.error('Slack notification failed:', slackErr.message);
    }
}
