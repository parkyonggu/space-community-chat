const nodemailer = require('nodemailer');

function createMailer(environment = process.env) {
  const fields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missing = fields.filter(field => !environment[field]);
  if (missing.length === fields.length) {
    return {
      configured: false,
      async verify() { throw new Error('SMTP is not configured.'); },
      async send() { throw new Error('SMTP is not configured.'); },
    };
  }
  if (missing.length) throw new Error(`Missing mail configuration: ${missing.join(', ')}`);
  const port = Number(environment.SMTP_PORT);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 (TLS) or 587 (STARTTLS).');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(environment.MAIL_FROM)) {
    throw new Error('MAIL_FROM must be a valid sender email address.');
  }
  const transport = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASS },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    configured: true,
    verify: () => transport.verify(),
    async send({ to, subject, text }) {
      const result = await transport.sendMail({
        from: { name: '스페이스 커뮤니티', address: environment.MAIL_FROM },
        to, subject, text,
      });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP did not accept the recipient.');
    },
  };
}

module.exports = { createMailer };
