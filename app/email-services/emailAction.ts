"use server";

import { Resend } from "resend";

import { getSession } from "../../lib/auth/session";
import { listProfiles } from "../../lib/db/students/students.admin.repo";

import { EmailBody } from "./EmailBody";

/**
 * Bulk announcement email.
 *
 * The previous version had no authorisation at all: any visitor could invoke
 * this server action with an arbitrary recipient list and have the site send
 * mail through its Resend account. It now requires a session whose email is in
 * the `ADMIN_EMAILS` allowlist, and recipients are read from published profiles
 * on the server rather than accepted from the browser — so neither the audience
 * nor the sender's identity is client-controlled.
 */
function isAdmin(email: string): boolean {
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.trim().toLowerCase());
}

export interface SendResult {
  success: boolean;
  message: string;
  error?: string;
  recipientCount?: number;
}

export async function sendAnnouncementAction(
  subject: string,
  body: string,
): Promise<SendResult> {
  const session = await getSession();

  if (!session || !isAdmin(session.email)) {
    // Deliberately vague: a signed-out visitor should not learn who the admins
    // are, and a signed-in non-admin should not learn the allowlist exists.
    return { success: false, message: "Not authorised", error: "Not authorised" };
  }

  const cleanSubject = subject.trim();
  const cleanBody = body.trim();

  if (!cleanSubject) {
    return { success: false, message: "Subject is required", error: "Subject is required" };
  }

  const profiles = await listProfiles();
  const recipients = profiles
    .filter((profile) => profile.published && profile.email)
    .map((profile) => profile.email);

  if (recipients.length === 0) {
    return {
      success: false,
      message: "No published profiles to send to",
      error: "No published profiles to send to",
    };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: "RUET CSE <noreply@mail.ruetcsearchive.app>",
      to: recipients,
      subject: cleanSubject,
      react: EmailBody({
        name: "there",
        message: cleanBody,
        portalUrl: "https://students.ruetcsearchive.app/profiles",
      }),
    });

    if (error) {
      console.error("Resend send failed:", error);
      return {
        success: false,
        message: "Failed to send",
        error: error.message || "Unknown error",
      };
    }

    return {
      success: true,
      message: `Sent to ${recipients.length} ${recipients.length === 1 ? "profile" : "profiles"}`,
      recipientCount: recipients.length,
    };
  } catch (error) {
    console.error("Announcement send failed:", error);
    return {
      success: false,
      message: "Failed to send",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface AudienceInfo {
  count: number;
}

/** Recipient count for the confirmation step, without exposing the addresses. */
export async function getAudienceSizeAction(): Promise<AudienceInfo> {
  const session = await getSession();

  if (!session || !isAdmin(session.email)) return { count: 0 };

  const profiles = await listProfiles();
  return { count: profiles.filter((profile) => profile.published).length };
}
