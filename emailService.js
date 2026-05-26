const nodemailer = require('nodemailer');
const config = require('./config');
const logger = require('./logger');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }
  return transporter;
}

async function sendMail(to, subject, html) {
  try {
    const info = await getTransporter().sendMail({
      from: config.email.from,
      to,
      subject,
      html,
    });
    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return info;
  } catch (error) {
    logger.error('Email send failed', { to, subject, error: error.message });
  }
}

async function notifyAdminNewSignup(user) {
  const subject = 'New Member Registration - Action Required';
  const html = `
    <h2>New Member Registration</h2>
    <p>A new member has registered and is awaiting approval.</p>
    <ul>
      <li><strong>Name:</strong> ${user.firstName} ${user.lastName}</li>
      <li><strong>Email:</strong> ${user.email}</li>
      <li><strong>City:</strong> ${user.city || 'Not provided'}</li>
      <li><strong>County:</strong> ${user.county || 'Not provided'}</li>
      <li><strong>Interest Areas:</strong> ${user.interestAreas || 'Not specified'}</li>
    </ul>
    <p>Please log in to the admin dashboard to review this application.</p>
  `;
  return sendMail(config.email.adminEmail, subject, html);
}

async function sendWelcomeEmail(user) {
  const subject = 'Welcome to the FAIR Group';
  const html = `
    <h2>Welcome, ${user.firstName}!</h2>
    <p>Thank you for registering with the FAIR Group. Your application has been received and is being reviewed.</p>
    <p>You will receive an email once your application has been approved. After approval, you can log in to access your member dashboard and join working groups.</p>
    <p>If you have questions, please contact us at ${config.email.adminEmail}.</p>
    <p>Sincerely,<br>The FAIR Group Team</p>
  `;
  return sendMail(user.email, subject, html);
}

async function sendApprovalEmail(user) {
  const subject = 'Your FAIR Group Membership Has Been Approved';
  const html = `
    <h2>Congratulations, ${user.firstName}!</h2>
    <p>Your FAIR Group membership application has been approved. You now have full access to the member portal.</p>
    <p>Log in to your dashboard to explore working groups, access resources, and connect with fellow coalition members.</p>
    <p>Welcome to the coalition.</p>
    <p>Sincerely,<br>The FAIR Group Team</p>
  `;
  return sendMail(user.email, subject, html);
}

async function sendRejectionEmail(user) {
  const subject = 'FAIR Group Membership Application Update';
  const html = `
    <h2>Hello, ${user.firstName}</h2>
    <p>Thank you for your interest in the FAIR Group. After reviewing your application, we are unable to approve your membership at this time.</p>
    <p>If you believe this was made in error or have questions, please contact us at ${config.email.adminEmail}.</p>
    <p>Sincerely,<br>The FAIR Group Team</p>
  `;
  return sendMail(user.email, subject, html);
}

async function sendPasswordResetEmail(user, resetToken) {
  const baseUrl = config.server.env === 'production'
    ? 'https://fairgroup.org'
    : `http://localhost:${config.server.port}`;
  const resetUrl = `${baseUrl}/password-reset.html?token=${resetToken}`;

  const subject = 'Password Reset Request - FAIR Group';
  const html = `
    <h2>Password Reset</h2>
    <p>Hello, ${user.firstName}. We received a request to reset your password.</p>
    <p>Click the link below to set a new password. This link expires in 60 minutes.</p>
    <p><a href="${resetUrl}">Reset Your Password</a></p>
    <p>If you did not request this, you can safely ignore this email.</p>
    <p>Sincerely,<br>The FAIR Group Team</p>
  `;
  return sendMail(user.email, subject, html);
}

module.exports = {
  notifyAdminNewSignup,
  sendWelcomeEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendPasswordResetEmail,
};
