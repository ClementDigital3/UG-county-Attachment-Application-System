const nodemailer = require("nodemailer");

function normalizeBoolean(value) {
  return ["true", "1", "yes", "on"].includes((value || "").toString().trim().toLowerCase());
}

function normalizeSmsNumber(value) {
  const raw = (value || "").toString().trim();
  if (!raw) {
    return null;
  }

  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && /^\+\d{10,15}$/.test(digits)) {
    return digits;
  }

  const onlyDigits = digits.replace(/[^\d]/g, "");
  if (/^0\d{9}$/.test(onlyDigits)) {
    return `+254${onlyDigits.slice(1)}`;
  }

  if (/^254\d{9}$/.test(onlyDigits)) {
    return `+${onlyDigits}`;
  }

  if (/^\d{10,15}$/.test(onlyDigits)) {
    return `+${onlyDigits}`;
  }

  return null;
}

function createEntry({
  channel,
  status,
  subject = "",
  message = "",
  recipient = "",
  reason = "",
  initiatedBy = "system",
  eventType = ""
}) {
  return {
    channel,
    status,
    subject: (subject || "").toString(),
    message: (message || "").toString(),
    recipient: (recipient || "").toString(),
    reason: (reason || "").toString(),
    initiatedBy: (initiatedBy || "system").toString(),
    eventType: (eventType || "").toString(),
    sentAt: new Date().toISOString()
  };
}

function createNotificationService({
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPass,
  emailFrom,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber
}) {
  const hasEmailConfig =
    Boolean(smtpHost) &&
    Boolean(smtpPort) &&
    Boolean(smtpUser) &&
    Boolean(smtpPass) &&
    Boolean(emailFrom);
  const hasSmsConfig =
    Boolean(twilioAccountSid) &&
    Boolean(twilioAuthToken) &&
    Boolean(twilioFromNumber);

  const transporter = hasEmailConfig
    ? nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: normalizeBoolean(smtpSecure),
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    })
    : null;

  async function sendEmail({ to, subject, message, initiatedBy, eventType }) {
    const safeTo = (to || "").toString().trim();
    if (!safeTo) {
      return createEntry({
        channel: "email",
        status: "skipped",
        subject,
        message,
        recipient: safeTo,
        reason: "No email address available.",
        initiatedBy,
        eventType
      });
    }

    if (!hasEmailConfig || !transporter) {
      return createEntry({
        channel: "email",
        status: "skipped",
        subject,
        message,
        recipient: safeTo,
        reason: "Email provider is not configured.",
        initiatedBy,
        eventType
      });
    }

    try {
      await transporter.sendMail({
        from: emailFrom,
        to: safeTo,
        subject,
        text: message
      });

      return createEntry({
        channel: "email",
        status: "sent",
        subject,
        message,
        recipient: safeTo,
        initiatedBy,
        eventType
      });
    } catch (error) {
      return createEntry({
        channel: "email",
        status: "failed",
        subject,
        message,
        recipient: safeTo,
        reason: error.message || "Email send failed.",
        initiatedBy,
        eventType
      });
    }
  }

  async function sendSms({ to, message, initiatedBy, eventType }) {
    const normalizedTo = normalizeSmsNumber(to);
    if (!normalizedTo) {
      return createEntry({
        channel: "sms",
        status: "skipped",
        message,
        recipient: (to || "").toString(),
        reason: "No valid phone number available.",
        initiatedBy,
        eventType
      });
    }

    if (!hasSmsConfig) {
      return createEntry({
        channel: "sms",
        status: "skipped",
        message,
        recipient: normalizedTo,
        reason: "SMS provider is not configured.",
        initiatedBy,
        eventType
      });
    }

    try {
      const body = new URLSearchParams({
        To: normalizedTo,
        From: twilioFromNumber,
        Body: message
      });

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return createEntry({
          channel: "sms",
          status: "failed",
          message,
          recipient: normalizedTo,
          reason: errorText || `SMS send failed with status ${response.status}.`,
          initiatedBy,
          eventType
        });
      }

      return createEntry({
        channel: "sms",
        status: "sent",
        message,
        recipient: normalizedTo,
        initiatedBy,
        eventType
      });
    } catch (error) {
      return createEntry({
        channel: "sms",
        status: "failed",
        message,
        recipient: normalizedTo,
        reason: error.message || "SMS send failed.",
        initiatedBy,
        eventType
      });
    }
  }

  async function send({
    channels = ["email"],
    toEmail,
    toPhone,
    subject,
    message,
    initiatedBy = "system",
    eventType = "manual"
  }) {
    const normalizedChannels = Array.from(
      new Set(
        (Array.isArray(channels) ? channels : [channels])
          .map((channel) => (channel || "").toString().trim().toLowerCase())
          .filter((channel) => channel === "email" || channel === "sms")
      )
    );

    const results = [];
    if (normalizedChannels.includes("email")) {
      results.push(
        await sendEmail({
          to: toEmail,
          subject,
          message,
          initiatedBy,
          eventType
        })
      );
    }

    if (normalizedChannels.includes("sms")) {
      results.push(
        await sendSms({
          to: toPhone,
          message,
          initiatedBy,
          eventType
        })
      );
    }

    return results;
  }

  function getProviderSummary() {
    return {
      emailEnabled: hasEmailConfig,
      smsEnabled: hasSmsConfig
    };
  }

  return {
    send,
    getProviderSummary
  };
}

module.exports = {
  createNotificationService,
  normalizeSmsNumber
};
