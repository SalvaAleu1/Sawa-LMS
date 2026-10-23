import { createClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

type Env = {
  Bindings: {
    APP_ENV: string;
    APP_BASE_URL?: string;
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  };
};
const app = new Hono<Env>();

app.use("*", secureHeaders());
app.use("/api/*", cors({
  origin: (origin, c) => {
    const allowed = c.env.APP_BASE_URL;
    return allowed && origin === allowed ? origin : "";
  },
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
  maxAge: 600,
  credentials: true,
}));

app.get("/health", (c) => c.json({
  status: "ok",
  service: "sawalearn-api",
  environment: c.env.APP_ENV || "unknown",
  timestamp: new Date().toISOString(),
}));

app.get("/api/v1", (c) => c.json({
  name: "SawaLearn API",
  version: "v1",
  status: "partner-intake-enabled",
}));

const clean = (value: unknown, max = 200): string =>
  typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validTypes = ["university", "college", "school", "vocational_centre", "training_centre", "other"];

app.post("/api/v1/partner-applications", async (c) => {
  const supabaseUrl = c.env.SUPABASE_URL;
  const serviceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return c.json({ error: "service_unavailable", message: "Partner registration is temporarily unavailable. Please try again later." }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "invalid_json", message: "Please submit a valid application form." }, 400);
  }

  if (clean(body.companyFax, 120)) return c.json({ accepted: true });

  const legalName = clean(body.legalName, 180);
  const displayName = clean(body.displayName, 120);
  const institutionType = clean(body.institutionType, 40);
  const countryCode = clean(body.countryCode, 2).toUpperCase();
  const contactName = clean(body.contactName, 120);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 40);
  const website = clean(body.website, 200);
  const estimatedLearners = Number(body.estimatedLearners);
  const message = clean(body.message, 1500);

  if (legalName.length < 2 || displayName.length < 2 || !validTypes.includes(institutionType) ||
      !/^[A-Z]{2}$/.test(countryCode) || contactName.length < 2 ||
      !emailPattern.test(email) || phone.length < 5 ||
      !Number.isInteger(estimatedLearners) || estimatedLearners < 0 || estimatedLearners > 10000000 ||
      (website && !/^https?:\/\//i.test(website))) {
    return c.json({ error: "validation_error", message: "Check the required fields. Use the institution's full legal name and a valid contact email, phone number and country code." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Application": "sawalearn-partner-intake" } },
  });
  const { data, error } = await supabase.from("partner_applications").insert({
    legal_name: legalName,
    display_name: displayName,
    institution_type: institutionType,
    country_code: countryCode,
    contact_name: contactName,
    contact_email: email,
    contact_phone: phone,
    website: website || null,
    estimated_learners: estimatedLearners,
    message: message || null,
    status: "pending_review",
  }).select("id, created_at").single();

  if (error) {
    if (error.code === "23505") {
      return c.json({ error: "application_exists", message: "An application from this contact is already awaiting review. Please contact the SawaLearn team if you need help." }, 409);
    }
    console.error("Partner application persistence failed", { code: error.code, message: error.message });
    return c.json({ error: "submission_failed", message: "We could not save your application. Please try again later." }, 500);
  }

  return c.json({
    accepted: true,
    applicationId: data.id,
    submittedAt: data.created_at,
    message: "Your partner application has been received for review. Registration is not approved until the SawaLearn team confirms it.",
  }, 201);
});


async function requirePlatformOperator(c: Context<Env>) {
  const authorization = c.req.header("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const url = c.env.SUPABASE_URL;
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !key) return { error: "unauthorized" as const };
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return { error: "unauthorized" as const };
  const { data: membership, error: membershipError } = await supabase
    .from("platform_memberships").select("role")
    .eq("user_id", authData.user.id).in("role", ["platform_owner", "platform_admin"]).limit(1).maybeSingle();
  if (membershipError || !membership) return { error: "forbidden" as const };
  const profileName = clean(authData.user.user_metadata?.full_name, 120) || authData.user.email || "Platform operator";
  await supabase.from("profiles").upsert({
    id: authData.user.id, display_name: profileName, email: authData.user.email || null
  }, { onConflict: "id", ignoreDuplicates: true });
  return { user: authData.user, supabase };
}


app.post("/api/v1/invitations/redeem", async (c) => {
  const authorization = c.req.header("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const url = c.env.SUPABASE_URL;
  const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !url || !key) return c.json({ error: "unauthorized", message: "Sign in to the account matching the invitation email first." }, 401);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user || !authData.user.email) return c.json({ error: "unauthorized", message: "Your session is invalid. Please sign in again." }, 401);
  let body: Record<string, unknown>;
  try { body = await c.req.json<Record<string, unknown>>(); }
  catch { return c.json({ error: "invalid_json", message: "Submit a valid invitation request." }, 400); }
  const inviteToken = clean(body.token, 128).toLowerCase();
  const displayName = clean(body.displayName, 120);
  if (!/^[a-f0-9]{64}$/.test(inviteToken) || displayName.length < 2) return c.json({ error: "validation_error", message: "Enter the invitation token and your full name." }, 400);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inviteToken));
  const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase.rpc("redeem_first_admin_invite", {
    p_actor: authData.user.id, p_token_hash: tokenHash, p_display_name: displayName
  });
  if (error) {
    const forbidden = error.code === "42501";
    return c.json({ error: "invitation_rejected", message: forbidden ? "This invitation belongs to a different email address." : "The invitation is invalid, expired, or has already been used." }, forbidden ? 403 : 400);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return c.json({ redeemed: true, institutionId: row?.institution_id, message: "Your institution administrator access has been activated." });
});

app.get("/api/v1/platform/partner-applications", async (c) => {
  const access = await requirePlatformOperator(c);
  if ("error" in access) return c.json({ error: access.error, message: access.error === "forbidden" ? "Platform operator access is required." : "Please sign in again." }, access.error === "forbidden" ? 403 : 401);
  const status = c.req.query("status") || "pending_review";
  if (!["pending_review", "under_review", "approved", "rejected", "withdrawn"].includes(status)) return c.json({ error: "validation_error", message: "Invalid application status filter." }, 400);
  const { data, error } = await access.supabase.from("partner_applications")
    .select("id, legal_name, display_name, institution_type, country_code, contact_name, contact_email, contact_phone, website, estimated_learners, message, status, created_at, reviewed_at, review_notes")
    .eq("status", status).order("created_at", { ascending: true }).limit(100);
  if (error) {
    console.error("Partner application queue read failed", { code: error.code });
    return c.json({ error: "read_failed", message: "Could not load the review queue." }, 500);
  }
  return c.json({ applications: data || [] });
});


app.post("/api/v1/platform/partner-applications/:id/approve", async (c) => {
  const access = await requirePlatformOperator(c);
  if ("error" in access) return c.json({ error: access.error, message: access.error === "forbidden" ? "Platform operator access is required." : "Please sign in again." }, access.error === "forbidden" ? 403 : 401);
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: "validation_error", message: "Invalid application reference." }, 400);
  let body: Record<string, unknown>;
  try { body = await c.req.json<Record<string, unknown>>(); }
  catch { return c.json({ error: "invalid_json", message: "Submit a valid approval request." }, 400); }
  const slug = clean(body.slug, 60).toLowerCase();
  const planCode = clean(body.planCode, 30).toLowerCase();
  const period = clean(body.period, 20);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !["starter","standard","professional","enterprise"].includes(planCode) || !["monthly","annual"].includes(period)) {
    return c.json({ error: "validation_error", message: "Provide a valid institution URL slug, plan and billing period." }, 400);
  }
  // The raw invite token is returned once to the authenticated platform operator.
  // Only its SHA-256 digest is persisted. Deliver it to the approved contact through a secure channel.
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBytes, b => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await access.supabase.rpc("platform_approve_partner", {
    p_application_id: id, p_actor: access.user.id, p_slug: slug,
    p_plan_code: planCode, p_period: period, p_invite_token_hash: tokenHash
  });
  if (error) {
    const status = error.code === "23505" ? 409 : error.code === "42501" ? 403 : 400;
    return c.json({ error: "approval_failed", message: status === 409 ? "That institution slug is already in use." : status === 403 ? "Platform operator access is required." : "Approval could not be completed. Check the application status and database migrations." }, status);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.institution_id || !row?.invite_id) return c.json({ error: "approval_failed", message: "The database did not return the expected approval result." }, 500);
  return c.json({
    approved: true, institutionId: row.institution_id, inviteId: row.invite_id,
    administratorEmail: "The approved contact email is stored with the invitation.",
    invitationToken: token, expiresInHours: 72,
    warning: "This token is shown once. Send it only to the approved contact using a secure channel. The recipient must create/sign in to an account before redeeming it."
  }, 201);
});

app.patch("/api/v1/platform/partner-applications/:id", async (c) => {
  const access = await requirePlatformOperator(c);
  if ("error" in access) return c.json({ error: access.error, message: access.error === "forbidden" ? "Platform operator access is required." : "Please sign in again." }, access.error === "forbidden" ? 403 : 401);
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: "validation_error", message: "Invalid application reference." }, 400);
  let body: Record<string, unknown>;
  try { body = await c.req.json<Record<string, unknown>>(); }
  catch { return c.json({ error: "invalid_json", message: "Submit a valid review action." }, 400); }
  const status = clean(body.status, 30);
  const reviewNotes = clean(body.reviewNotes, 1000);
  if (!["under_review", "rejected"].includes(status)) return c.json({ error: "invalid_transition", message: "Only 'under review' or 'rejected' can be set here. Approval requires the secure tenant and administrator-invitation workflow." }, 400);
  const { data: previous, error: readError } = await access.supabase.from("partner_applications")
    .select("id, status, legal_name").eq("id", id).maybeSingle();
  if (readError || !previous) return c.json({ error: "not_found", message: "Partner application not found." }, 404);
  const { data, error } = await access.supabase.from("partner_applications")
    .update({ status, review_notes: reviewNotes || null, reviewed_by: access.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", id).select("id, status, reviewed_at").single();
  if (error) {
    console.error("Partner application review update failed", { code: error.code });
    return c.json({ error: "update_failed", message: "Could not save the review decision." }, 500);
  }
  const { error: auditError } = await access.supabase.from("audit_logs").insert({
    actor_user_id: access.user.id,
    action: status === "rejected" ? "partner_application_rejected" : "partner_application_marked_under_review",
    target_type: "partner_application", target_id: id,
    metadata: { previous_status: previous.status, new_status: status, institution_name: previous.legal_name }
  });
  if (auditError) console.error("Partner review audit write failed", { code: auditError.code });
  return c.json({ application: data, auditRecorded: !auditError });
});

app.notFound((c) => c.json({ error: "not_found", message: "The requested resource was not found." }, 404));
app.onError((error, c) => {
  console.error("SawaLearn API request failed", { message: error.message, path: c.req.path });
  return c.json({ error: "internal_error", message: "An unexpected error occurred." }, 500);
});

export default app;
