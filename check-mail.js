const { createMailer } = require('./mailer');

require('@next/env').loadEnvConfig(__dirname, process.env.NODE_ENV !== 'production');
async function main() {
  const mailer = createMailer();
  if (!mailer.configured) throw new Error('SMTP environment variables are missing. See .env.example and DEPLOYMENT.md.');
  await mailer.verify();
  console.log('PASS: SMTP connection, TLS and authentication verified. No email was sent.');
}
main().catch(error => {
  console.error('SMTP check failed:', error.code || error.message);
  process.exitCode = 1;
});
