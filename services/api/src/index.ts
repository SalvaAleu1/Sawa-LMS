import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
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

app.notFound((c) => c.json({ error: "not_found", message: "The requested resource was not found." }, 404));
app.onError((error, c) => {
  console.error("SawaLearn API request failed", { message: error.message, path: c.req.path });
  return c.json({ error: "internal_error", message: "An unexpected error occurred." }, 500);
});

export default app;
