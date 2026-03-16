const fs = require('fs');

const filePath = 'server/email.ts';
let content = fs.readFileSync(filePath, 'utf8');

const oldSubject = "const subject = `${count} missed workout${count !== 1 ? 's' : ''} — get back on track`;";
const newSubject = `const pluralSuffix = count !== 1 ? 's' : '';
  const subject = \`\${count} missed workout\${pluralSuffix} — get back on track\`;`;

content = content.replace(oldSubject, newSubject);

const oldParagraph = "<p style=\"font-size:16px;color:#334155;\">Hey ${name}, you had ${count} planned session${count !== 1 ? 's' : ''} that ${count !== 1 ? 'were' : 'was'} missed:</p>";
const newParagraph = `\${(() => {
      const sSuffix = count !== 1 ? 's' : '';
      const wasWere = count !== 1 ? 'were' : 'was';
      return \`<p style="font-size:16px;color:#334155;">Hey \${name}, you had \${count} planned session\${sSuffix} that \${wasWere} missed:</p>\`;
    })()}`;

// Actually let's just create variables before the return statement.
const replacement = `export function buildMissedWorkoutEmail(user: User, missed: MissedWorkoutData[]): { subject: string; html: string } {
  const name = getUserName(user);
  const count = missed.length;
  const pluralSuffix = count !== 1 ? 's' : '';
  const wasWere = count !== 1 ? 'were' : 'was';
  const subject = \`\${count} missed workout\${pluralSuffix} — get back on track\`;

  const workoutItems = missed.map(w => \`
    <div class="workout-item">
      <div class="workout-focus">\${w.focus}</div>
      <div class="workout-detail">\${w.mainWorkout.substring(0, 120)}\${w.mainWorkout.length > 120 ? '...' : ''}</div>
      <div class="workout-date">\${w.date}</div>
    </div>
  \`).join('');

  const html = \`
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { text-align: center; margin-bottom: 30px; }
  .header h1 { color: #0f172a; margin-bottom: 5px; }
  .header p { color: #64748b; margin-top: 0; }
  .content { background: #f8fafc; padding: 24px; border-radius: 8px; }
  .workout-item { background: white; padding: 16px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
  .workout-focus { font-weight: 600; color: #0f172a; margin-bottom: 4px; }
  .workout-detail { color: #475569; font-size: 14px; margin-bottom: 8px; }
  .workout-date { color: #64748b; font-size: 12px; }
  .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <h1>Missed Workout Reminder</h1>
    <p>Don't let momentum slip away</p>
  </div>
  <div class="content">
    <p style="font-size:16px;color:#334155;">Hey \${name}, you had \${count} planned session\${pluralSuffix} that \${wasWere} missed:</p>

    \${workoutItems}

    <p style="font-size:14px;color:#64748b;margin-top:16px;">Missing a session happens to everyone. The important thing is to get back on track. You can mark these as skipped or reschedule them in the app.</p>

    <div style="margin-top: 24px; text-align: center;">
      <a href="\${process.env.APP_URL || 'https://hyrox-tracker.com'}/timeline" style="display: inline-block; background-color: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Timeline</a>
    </div>
  </div>
  <div class="footer">
    <p>You're receiving this because you enabled email reminders in your HyroxTracker preferences.</p>
  </div>
</body>
</html>
  \`.trim();

  return { subject, html };
}`;

// Re-read and replace the whole function
const oldFuncRegex = /export function buildMissedWorkoutEmail[\s\S]*?return { subject, html };\n\}/;
content = content.replace(oldFuncRegex, replacement);

fs.writeFileSync(filePath, content);
