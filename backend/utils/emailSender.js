// backend/utils/emailSender.js
const { MailerSend, EmailParams, Sender, Recipient } = require("mailersend");

// Ensure API Key is loaded from .env
if (!process.env.MAILERSEND_API_KEY) {
    console.error("FATAL ERROR: MAILERSEND_API_KEY environment variable is not set.");
    // Optional: Exit process if critical for startup
    // process.exit(1);
}

const mailersend = new MailerSend({
    apiKey: process.env.MAILERSEND_API_KEY,
});

const sendVerificationEmail = async (toEmail, token) => {
    // Construct the verification URL using APP_BASE_URL
    const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const verificationUrl = `${appBaseUrl}/api/auth/verify-email?token=${token}`;
    const expiryHours = process.env.VERIFICATION_TOKEN_EXPIRES_IN_HOURS || 24;

    // Define the sender using the verified email from .env
    const sentFrom = new Sender(process.env.EMAIL_FROM_ADDRESS, "Athletes Motivation App"); // MODIFIED - App name

    // Define the recipient
    const recipients = [
        new Recipient(toEmail)
    ];

    // Define email parameters
    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject("Verify Your Athletes Motivation Email Address") // MODIFIED
        .setHtml(
            `<p>Welcome to Athletes Motivation!</p> <p>Please click the button below to verify your email address:</p>
             <a href="${verificationUrl}" style="background-color: #0d6efd; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-family: sans-serif; font-size: 16px;">Verify Email</a>
             <p style="margin-top: 15px;">Or copy and paste this link into your browser:</br> <a href="${verificationUrl}">${verificationUrl}</a></p>
             <p>This link will expire in ${expiryHours} hours.</p>
             <p>If you didn't sign up for Athletes Motivation, please ignore this email.</p>` // MODIFIED
        )
        .setText( // Plain text version
            `Welcome to Athletes Motivation!\n\nPlease copy and paste the following link into your browser to verify your email address:\n${verificationUrl}\n\nThis link will expire in ${expiryHours} hours.\nIf you didn't sign up for Athletes Motivation, please ignore this email.` // MODIFIED
        );
    
    console.log("▶ [sendVerificationEmail] MAILERSEND_API_KEY:", !!process.env.MAILERSEND_API_KEY);

    try {
        console.log(`Sending verification email via MailerSend to ${toEmail}...`);
        const response = await mailersend.email.send(emailParams);

        if (response.statusCode >= 200 && response.statusCode < 300) {
             console.log(`Verification email successfully sent to ${toEmail}. Message ID (if available): ${response.headers?.['x-message-id'] || 'N/A'}`);
             return true;
        } else {
             console.error(`MailerSend returned non-success status code ${response.statusCode} for ${toEmail}. Body:`, response.body);
             return false;
        }

    } catch (error) {
        console.error("Error sending verification email via MailerSend:", error.body || error.message || error);
        if (error.body) {
            console.error("MailerSend Error Body:", JSON.stringify(error.body, null, 2));
        }
        return false;
    }
};

const sendPasswordResetEmail = async (toEmail, token) => {
    const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    // This URL should point to the frontend page that handles the password reset form
    const resetUrl = `${appBaseUrl}/reset-password.html?token=${token}`; 
    const expiryHours = 1; // Password reset links are typically shorter-lived

    const sentFrom = new Sender(process.env.EMAIL_FROM_ADDRESS, "Athletes Motivation App");
    const recipients = [new Recipient(toEmail)];

    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject("Reset Your Athletes Motivation Password")
        .setHtml(
            `<p>Hello,</p>
             <p>You requested a password reset for your Athletes Motivation account.</p>
             <p>Please click the button below to set a new password:</p>
             <a href="${resetUrl}" style="background-color: #0d6efd; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-family: sans-serif; font-size: 16px;">Reset Password</a>
             <p style="margin-top: 15px;">Or copy and paste this link into your browser:</br> <a href="${resetUrl}">${resetUrl}</a></p>
             <p>This link will expire in ${expiryHours} hour.</p>
             <p>If you did not request a password reset, please ignore this email.</p>`
        )
        .setText(
            `Hello,\n\nYou requested a password reset for your Athletes Motivation account.\n\nPlease copy and paste the following link into your browser to set a new password:\n${resetUrl}\n\nThis link will expire in ${expiryHours} hour.\nIf you did not request a password reset, please ignore this email.`
        );

    try {
        console.log(`Sending password reset email via MailerSend to ${toEmail}...`);
        const response = await mailersend.email.send(emailParams);
        if (response.statusCode >= 200 && response.statusCode < 300) {
            console.log(`Password reset email successfully sent to ${toEmail}.`);
            return true;
        } else {
            console.error(`MailerSend returned non-success status code ${response.statusCode} for password reset to ${toEmail}. Body:`, response.body);
            return false;
        }
    } catch (error) {
        console.error("Error sending password reset email via MailerSend:", error.body || error.message || error);
        if (error.body) {
            console.error("MailerSend Error Body:", JSON.stringify(error.body, null, 2));
        }
        return false;
    }
};


module.exports = { 
    sendVerificationEmail,
    sendPasswordResetEmail
};
