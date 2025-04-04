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
    const sentFrom = new Sender(process.env.EMAIL_FROM_ADDRESS, "Running Moti App"); // Use your app name

    // Define the recipient
    const recipients = [
        new Recipient(toEmail)
    ];

    // Define email parameters
    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject("Verify Your Running Moti Email Address")
        .setHtml(
            `<p>Welcome to Running Moti!</p>
             <p>Please click the button below to verify your email address:</p>
             <a href="${verificationUrl}" style="background-color: #0d6efd; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; font-family: sans-serif; font-size: 16px;">Verify Email</a>
             <p style="margin-top: 15px;">Or copy and paste this link into your browser:</br> <a href="${verificationUrl}">${verificationUrl}</a></p>
             <p>This link will expire in ${expiryHours} hours.</p>
             <p>If you didn't sign up for Running Moti, please ignore this email.</p>`
        )
        .setText( // Plain text version
            `Welcome to Running Moti!\n\nPlease copy and paste the following link into your browser to verify your email address:\n${verificationUrl}\n\nThis link will expire in ${expiryHours} hours.\nIf you didn't sign up for Running Moti, please ignore this email.`
        );
        // Optional: Add Reply-To, CC, BCC, Tags etc.
        // .setReplyTo(sentFrom)
        // .setTags(["verification", "signup"])

    try {
        console.log(`Sending verification email via MailerSend to ${toEmail}...`);
        const response = await mailersend.email.send(emailParams);

        // MailerSend response structure might vary, check their SDK docs.
        // Usually, a successful send doesn't throw an error. Check for specific status if needed.
        // The response object often includes message IDs, etc. but usually not needed here unless logging details.
        console.log("MailerSend API response status:", response.statusCode); // Example logging
        // console.log("MailerSend API response headers:", response.headers);

        if (response.statusCode >= 200 && response.statusCode < 300) {
             console.log(`Verification email successfully sent to ${toEmail}. Message ID (if available): ${response.headers?.['x-message-id'] || 'N/A'}`);
             return true;
        } else {
             // Handle non-2xx status codes as errors if needed
             console.error(`MailerSend returned non-success status code ${response.statusCode} for ${toEmail}. Body:`, response.body);
             return false;
        }

    } catch (error) {
        console.error("Error sending verification email via MailerSend:", error.body || error.message || error);
        // Log the full error object if available, MailerSend errors often have details in error.body
        if (error.body) {
            console.error("MailerSend Error Body:", JSON.stringify(error.body, null, 2));
        }
        return false;
    }
};

module.exports = { sendVerificationEmail };

// Note: MailerSend SDK doesn't have a direct 'verify' method like Nodemailer.
// Configuration is verified upon the first API call attempt. Ensure API key is correct.