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
    RESEND_API_KEY?: string;
    RESEND_FROM?: string;
    R2_BUCKET?: R2Bucket;
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


app.get("/api/v1/platform/subscriptions", async (c) => {
 const access=await requirePlatformOperator(c);
 if ("error" in access) return c.json({error:access.error,message:"Platform operator access is required."},access.error==="forbidden"?403:401);
 const {data,error}=await access.supabase.from("institution_subscriptions").select("id,institution_id,status,billing_period,period_start,period_end,grace_end,owner_decision_required,extended_until,created_at,institutions(display_name,slug),subscription_plans(code,name,monthly_price,annual_price,currency,max_active_users,storage_limit_bytes),cash_receipts(receipt_number,amount,currency,received_on,confirmed_at)").order("period_end",{ascending:true}).limit(300);
 if(error){console.error("Subscription list failed",{code:error.code});return c.json({error:"read_failed",message:"Could not load subscriptions."},500);}
 return c.json({subscriptions:data||[]});
});

app.post("/api/v1/platform/subscriptions/:id/receipt", async (c) => {
 const access=await requirePlatformOperator(c);
 if ("error" in access) return c.json({error:access.error,message:"Platform operator access is required."},access.error==="forbidden"?403:401);
 const id=c.req.param("id");
 if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:"validation_error",message:"Invalid subscription reference."},400);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>();}catch{return c.json({error:"invalid_json",message:"Submit a valid cash receipt."},400);}
 const amount=Number(body.amount),currency=clean(body.currency,3).toUpperCase(),period=clean(body.period,20);
 const receivedOn=clean(body.receivedOn,10),coveredFrom=clean(body.coveredFrom,10),coveredUntil=clean(body.coveredUntil,10);
 if(!Number.isFinite(amount)||amount<=0||!/^[A-Z]{3}$/.test(currency)||!["monthly","annual"].includes(period)||![receivedOn,coveredFrom,coveredUntil].every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))||coveredUntil<coveredFrom)return c.json({error:"validation_error",message:"Provide a positive amount, currency, billing period and valid receipt dates."},400);
 const {data:sub,error:subError}=await access.supabase.from("institution_subscriptions").select("institution_id").eq("id",id).maybeSingle();
 if(subError||!sub)return c.json({error:"not_found",message:"Subscription not found."},404);
 const {data,error}=await access.supabase.rpc("platform_record_cash_receipt",{p_actor:access.user.id,p_institution:sub.institution_id,p_subscription:id,p_amount:amount,p_currency:currency,p_received_on:receivedOn,p_period:period,p_covered_from:coveredFrom,p_covered_until:coveredUntil,p_exchange_rate:body.exchangeRate?Number(body.exchangeRate):null,p_reference:clean(body.reference,120)||null,p_notes:clean(body.notes,1000)||null,p_confirm:body.confirm===true});
 if(error){console.error("Cash receipt operation failed",{code:error.code});return c.json({error:"receipt_failed",message:"The receipt could not be recorded. Check the subscription and receipt dates."},400);}
 return c.json({recorded:true,receiptNumber:data,confirmed:body.confirm===true},201);
});

app.post("/api/v1/platform/subscriptions/:id/action", async (c) => {
 const access=await requirePlatformOperator(c);
 if ("error" in access) return c.json({error:access.error,message:"Platform operator access is required."},access.error==="forbidden"?403:401);
 const id=c.req.param("id");
 if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:"validation_error",message:"Invalid subscription reference."},400);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>();}catch{return c.json({error:"invalid_json",message:"Submit a valid subscription action."},400);}
 const action=clean(body.action,30),until=clean(body.extendUntil,10),reason=clean(body.reason,1000);
 if(!["extend","terminate","restore_overdue"].includes(action)||(action==="extend"&&!/^\d{4}-\d{2}-\d{2}$/.test(until)))return c.json({error:"validation_error",message:"Choose a valid owner action and provide an extension date when extending."},400);
 const {data,error}=await access.supabase.rpc("platform_manage_subscription",{p_actor:access.user.id,p_subscription:id,p_action:action,p_extend_until:action==="extend"?until:null,p_reason:reason});
 if(error){const status=error.code==="42501"?403:error.code==="P0002"?404:400;return c.json({error:"subscription_action_failed",message:status===403?"Only the platform owner can perform this action.":"The subscription action could not be completed."},status);}
 return c.json({updated:true,subscription:data});
});


async function requireSignedIn(c: Context<Env>) {
 const authorization=c.req.header("Authorization")||"";
 const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
 if(!token||!c.env.SUPABASE_URL||!c.env.SUPABASE_SERVICE_ROLE_KEY)return {error:"unauthorized" as const};
 const supabase=createClient(c.env.SUPABASE_URL,c.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await supabase.auth.getUser(token);
 if(error||!data.user)return {error:"unauthorized" as const};
 return {user:data.user,supabase};
}
const uploadTypes=new Set(["application/pdf","text/plain","text/markdown","application/rtf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","image/jpeg","image/png","image/webp","audio/mpeg","video/mp4"]);

app.post("/api/v1/storage/upload",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized",message:"Sign in before uploading a course resource."},401);
 if(!c.env.R2_BUCKET)return c.json({error:"storage_unavailable",message:"File storage is not configured."},503);
 let form:FormData;try{form=await c.req.formData()}catch{return c.json({error:"invalid_upload",message:"Submit a valid file upload."},400)}
 const file=form.get("file") as unknown as File|null,tenant=clean(form.get("institutionId"),64),courseId=clean(form.get("courseId"),64),title=clean(form.get("title"),180);
 if(!(file instanceof File)||!tenant||!courseId||title.length<2)return c.json({error:"validation_error",message:"Choose a course, title and file."},400);
 if(file.size<1||file.size>20*1024*1024)return c.json({error:"file_size",message:"Files must be no larger than 20 MB."},413);
 if(!uploadTypes.has(file.type))return c.json({error:"file_type",message:"This file type is not supported."},415);
 const {data:member}=await a.supabase.from("institution_memberships").select("id,role").eq("institution_id",tenant).eq("user_id",a.user.id).eq("status","active").in("role",["institution_admin","lecturer","staff"]).maybeSingle();
 if(!member)return c.json({error:"forbidden",message:"Active teaching or administrator access is required."},403);
 const {data:sub}=await a.supabase.from("institution_subscriptions").select("status,subscription_plans(storage_limit_bytes)").eq("institution_id",tenant).in("status",["active","grace_period"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!sub)return c.json({error:"subscription_inactive",message:"An active subscription is required to upload files."},403);
 const plan=sub.subscription_plans as unknown as {storage_limit_bytes:number}|null;
 if(!plan)return c.json({error:"storage_limit",message:"The institution's storage plan could not be verified."},403);
 const {data:reserved,error:reserveError}=await a.supabase.rpc("adjust_storage_usage",{p_institution_id:tenant,p_delta:file.size,p_limit:Number(plan.storage_limit_bytes)});
 if(reserveError||reserved===null)return c.json({error:"storage_limit",message:"The institution has reached its storage allowance. Contact the platform owner to change the plan."},413);
 const {data:course}=await a.supabase.from("courses").select("id").eq("id",courseId).eq("institution_id",tenant).maybeSingle();
 if(!course){await a.supabase.rpc("adjust_storage_usage",{p_institution_id:tenant,p_delta:-file.size,p_limit:Number(plan.storage_limit_bytes)});return c.json({error:"course_not_found",message:"The selected course does not belong to this institution."},404);}
 const name=file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"resource";
 const key=tenant+"/"+courseId+"/"+crypto.randomUUID()+"-"+name;
 try {
  await c.env.R2_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"},customMetadata:{institutionId:tenant,courseId,uploadedBy:a.user.id}});
  const {error}=await a.supabase.from("learning_materials").insert({institution_id:tenant,course_id:courseId,title,description:clean(form.get("description"),1000)||null,object_key:key,content_type:file.type,size_bytes:file.size,uploaded_by:a.user.id,published:false});
  if(error){await c.env.R2_BUCKET.delete(key);await a.supabase.rpc("adjust_storage_usage",{p_institution_id:tenant,p_delta:-file.size,p_limit:Number(plan.storage_limit_bytes)});return c.json({error:"upload_failed",message:"Could not attach the file to the course."},500)}
 } catch (error) {
  await a.supabase.rpc("adjust_storage_usage",{p_institution_id:tenant,p_delta:-file.size,p_limit:Number(plan.storage_limit_bytes)});
  console.error("Storage write failed",{message:error instanceof Error?error.message:"unknown"});
  return c.json({error:"upload_failed",message:"The file could not be stored. Storage reservation was released."},500);
 }
 return c.json({uploaded:true,objectKey:key,sizeBytes:file.size},201);
});

app.get("/api/v1/storage/:materialId",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized",message:"Sign in to access this resource."},401);
 if(!c.env.R2_BUCKET)return c.json({error:"storage_unavailable",message:"File storage is not configured."},503);
 const id=c.req.param("materialId");if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:"not_found",message:"Resource not found."},404);
 const {data:m}=await a.supabase.from("learning_materials").select("id,institution_id,course_id,object_key,title,content_type,published").eq("id",id).maybeSingle();
 if(!m)return c.json({error:"not_found",message:"Resource not found."},404);
 const {data:member}=await a.supabase.from("institution_memberships").select("role").eq("institution_id",m.institution_id).eq("user_id",a.user.id).eq("status","active").maybeSingle();
 if(!member)return c.json({error:"forbidden",message:"You do not have access to this institution."},403);
 if(member.role==="learner"){
  if(!m.published)return c.json({error:"forbidden",message:"This resource has not been published to learners."},403);
  const {data:learner}=await a.supabase.from("learner_records").select("id").eq("institution_id",m.institution_id).eq("user_id",a.user.id).maybeSingle();
  if(!learner)return c.json({error:"forbidden",message:"Your learner record is not linked to this account."},403);
  const {data:enrolment}=await a.supabase.from("course_enrolments").select("id").eq("institution_id",m.institution_id).eq("course_id",m.course_id).eq("learner_id",learner.id).eq("status","enrolled").maybeSingle();
  if(!enrolment)return c.json({error:"forbidden",message:"You must be enrolled in this course."},403);
 }
 const object=await c.env.R2_BUCKET.get(m.object_key);if(!object)return c.json({error:"not_found",message:"Stored file not found."},404);
 return new Response(object.body,{headers:{"Content-Type":m.content_type||"application/octet-stream","Content-Disposition":'attachment; filename="'+clean(m.title,120).replace(/["\\\\]/g,"")+'"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
});

async function runScheduledTasks(env:Env["Bindings"]){
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Supabase Worker secrets are required");
 const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const {data:subs,error}=await db.from("institution_subscriptions").select("id,institution_id,status,period_end,grace_end").in("status",["active","grace_period","overdue"]).lte("period_end",soon);
 if(error)throw error;
 for(const s of subs||[]){
  const end=String(s.period_end);
  if(end===soon||end===today){
   const {data:admins}=await db.from("institution_memberships").select("user_id,profiles(email)").eq("institution_id",s.institution_id).eq("role","institution_admin").eq("status","active");
   for(const a of admins||[]){
    const profile=a.profiles as unknown as {email?:string}|null;if(!profile?.email)continue;
    const key="renewal:"+s.id+":"+end+":"+a.user_id;
    await db.from("notifications").upsert({institution_id:s.institution_id,recipient_user_id:a.user_id,channel:"email",template_key:"subscription_renewal_reminder",payload:{to:profile.email,subject:"SawaLearn subscription renewal",text:"Your institution subscription ends on "+end+". Contact the platform owner to record and confirm renewal."},scheduled_at:new Date().toISOString(),status:"queued",idempotency_key:key},{onConflict:"idempotency_key",ignoreDuplicates:true});
   }
  }
  if(String(s.grace_end)<today&&s.status!=="overdue"){
   await db.from("institution_subscriptions").update({status:"overdue",owner_decision_required:true,updated_at:new Date().toISOString()}).eq("id",s.id);
   await db.from("audit_logs").insert({institution_id:s.institution_id,action:"subscription_overdue_owner_decision_required",target_type:"institution_subscription",target_id:s.id,metadata:{period_end:s.period_end,grace_end:s.grace_end}});
   const {data:owners}=await db.from("platform_memberships").select("user_id,profiles(email)").eq("role","platform_owner");
   for(const owner of owners||[]){
    const profile=owner.profiles as unknown as {email?:string}|null;if(!profile?.email)continue;
    await db.from("notifications").upsert({institution_id:s.institution_id,recipient_user_id:owner.user_id,channel:"email",template_key:"subscription_owner_decision",payload:{to:profile.email,subject:"SawaLearn subscription requires an owner decision",text:"An institution subscription is past its seven-day grace period. Institution ID: "+s.institution_id+". Choose an explicit extension or termination; no automatic termination has occurred."},scheduled_at:new Date().toISOString(),status:"queued",idempotency_key:"owner-decision:"+s.id+":"+owner.user_id},{onConflict:"idempotency_key",ignoreDuplicates:true});
   }
  }
 }

 const month=new Date().toISOString().slice(0,7);
 const {data:institutions}=await db.from("institutions").select("id,display_name").eq("status","active").limit(1000);
 for(const institution of institutions||[]){
  const {data:sub}=await db.from("institution_subscriptions").select("id,subscription_plans(max_active_users,storage_limit_bytes)").eq("institution_id",institution.id).in("status",["active","grace_period","overdue"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!sub)continue;
  const plan=sub.subscription_plans as unknown as {max_active_users:number;storage_limit_bytes:number}|null;if(!plan)continue;
  const {count:activeUsers}=await db.from("institution_memberships").select("id",{count:"exact",head:true}).eq("institution_id",institution.id).eq("status","active");
  const {data:storage}=await db.from("storage_usage").select("used_bytes").eq("institution_id",institution.id).maybeSingle();
  const userPercent=Math.floor(Number(activeUsers||0)/Number(plan.max_active_users)*100);
  const storagePercent=Math.floor(Number(storage?.used_bytes||0)/Number(plan.storage_limit_bytes)*100);
  for(const metric of [{name:"active_users",value:userPercent},{name:"storage",value:storagePercent}]){
   const level=metric.value>=100?100:metric.value>=90?90:metric.value>=80?80:0;if(!level)continue;
   const key="capacity:"+institution.id+":"+metric.name+":"+level+":"+month;
   const {data:admins}=await db.from("institution_memberships").select("user_id,profiles(email)").eq("institution_id",institution.id).eq("role","institution_admin").eq("status","active");
   for(const admin of admins||[]){
    const profile=admin.profiles as unknown as {email?:string}|null;if(!profile?.email)continue;
    await db.from("notifications").upsert({institution_id:institution.id,recipient_user_id:admin.user_id,channel:"email",template_key:"capacity_warning",payload:{to:profile.email,subject:"SawaLearn capacity alert: "+institution.display_name,text:"Your institution is using "+metric.value+"% of its "+(metric.name==="storage"?"storage allowance":"active-user allowance")+". At 100%, new activations or uploads that exceed the allowance are blocked; existing records remain available."},scheduled_at:new Date().toISOString(),status:"queued",idempotency_key:key+":"+admin.user_id},{onConflict:"idempotency_key",ignoreDuplicates:true});
   }
  }
 }
 if(env.RESEND_API_KEY&&env.RESEND_FROM){
  const {data:queue}=await db.from("notifications").select("id,payload,attempts").eq("channel","email").eq("status","queued").lte("scheduled_at",new Date().toISOString()).order("scheduled_at").limit(50);
  for(const n of queue||[]){
   const {data:claimed}=await db.from("notifications").update({status:"sending",attempts:Number(n.attempts||0)+1}).eq("id",n.id).eq("status","queued").select("id").maybeSingle();if(!claimed)continue;
   const p=n.payload as {to?:string;subject?:string;text?:string};
   try{const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESEND_FROM,to:p.to,subject:p.subject,text:p.text})});if(!res.ok)throw new Error("Resend status "+res.status);await db.from("notifications").update({status:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("id",n.id)}
   catch(e){const tries=Number(n.attempts||0)+1;await db.from("notifications").update({status:tries>=5?"failed":"queued",scheduled_at:new Date(Date.now()+Math.min(360,2**tries*5)*60000).toISOString(),last_error:String(e).slice(0,500)}).eq("id",n.id)}
  }
 }
}


app.post("/api/v1/institution/members/invite",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized",message:"Sign in to invite institution members."},401);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json",message:"Submit a valid member invitation."},400)}
 const tenant=clean(body.institutionId,64),email=clean(body.email,254).toLowerCase(),role=clean(body.role,30);
 if(!tenant||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!["learner","lecturer","staff","institution_admin"].includes(role))return c.json({error:"validation_error",message:"Provide an institution, valid email address and permitted role."},400);
 const {data:actor}=await a.supabase.from("institution_memberships").select("role").eq("institution_id",tenant).eq("user_id",a.user.id).eq("status","active").maybeSingle();
 if(!actor||actor.role!=="institution_admin")return c.json({error:"forbidden",message:"Only an institution administrator can invite members."},403);
 const {data:institution}=await a.supabase.from("institutions").select("status,display_name").eq("id",tenant).maybeSingle();
 if(!institution||institution.status!=="active")return c.json({error:"institution_inactive",message:"This institution is not active."},403);
 const {data:subscription}=await a.supabase.from("institution_subscriptions").select("status,subscription_plans(max_active_users)").eq("institution_id",tenant).in("status",["active","grace_period"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!subscription)return c.json({error:"subscription_inactive",message:"An active subscription is required to invite members."},403);
 const plan=subscription.subscription_plans as unknown as {max_active_users:number}|null;
 const {count}=await a.supabase.from("institution_memberships").select("id",{count:"exact",head:true}).eq("institution_id",tenant).eq("status","active");
 if(!plan||Number(count||0)>=Number(plan.max_active_users))return c.json({error:"capacity_limit",message:"The active-user allowance has been reached. Archive an inactive account or contact the platform owner to change the plan."},409);
 const fullName=clean(body.displayName,120),first=clean(body.firstName,100),last=clean(body.lastName,100),learnerNumber=clean(body.learnerNumber,80);
 if(fullName.length<2||(role==="learner"&&(first.length<1||last.length<1||learnerNumber.length<1)))return c.json({error:"validation_error",message:"Enter the member's full name; learner invitations also require first name, last name and learner ID."},400);
 const {data:invited,error:inviteError}=await a.supabase.auth.admin.inviteUserByEmail(email,{data:{full_name:fullName},redirectTo:c.env.APP_BASE_URL});
 if(inviteError||!invited.user){console.error("Institution invite failed",{message:inviteError?.message});return c.json({error:"invite_failed",message:"The invitation could not be sent. Confirm Auth email delivery is configured."},400)}
 const userId=invited.user.id;
 const {error:profileError}=await a.supabase.from("profiles").upsert({id:userId,display_name:fullName,email},{onConflict:"id"});
 if(profileError){console.error("Profile provisioning failed",{code:profileError.code});return c.json({error:"member_provisioning_failed",message:"The invitation was sent but the profile could not be created. Contact support before resending."},500)}
 const {data:membership,error:memberError}=await a.supabase.from("institution_memberships").insert({institution_id:tenant,user_id:userId,role,status:"invited"}).select("id,role,status").single();
 if(memberError){console.error("Membership provisioning failed",{code:memberError.code});return c.json({error:"member_provisioning_failed",message:"The invitation was sent but membership could not be created. Contact support."},500)}
 if(role==="learner"){
  const {error:learnerError}=await a.supabase.from("learner_records").insert({institution_id:tenant,user_id:userId,learner_number:learnerNumber,first_name:first,last_name:last,status:"invited"});
  if(learnerError){await a.supabase.from("institution_memberships").delete().eq("id",membership.id);console.error("Learner record provisioning failed",{code:learnerError.code});return c.json({error:"member_provisioning_failed",message:"The learner record could not be created. Check the learner ID and try again."},400)}
 }
 await a.supabase.from("audit_logs").insert({actor_user_id:a.user.id,institution_id:tenant,action:"institution_member_invited",target_type:"institution_membership",target_id:membership.id,metadata:{email,role}});
 return c.json({invited:true,membershipId:membership.id,email,role,status:"invited",message:"Invitation sent. Activate access after the member verifies their email."},201);
});

app.post("/api/v1/institution/members/:membershipId/activate",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized",message:"Sign in to activate an institution member."},401);
 const membershipId=c.req.param("membershipId");if(!/^[0-9a-f-]{36}$/i.test(membershipId))return c.json({error:"validation_error",message:"Invalid membership reference."},400);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json",message:"Provide the institution reference."},400)}
 const tenant=clean(body.institutionId,64);
 const {data:actor}=await a.supabase.from("institution_memberships").select("role").eq("institution_id",tenant).eq("user_id",a.user.id).eq("status","active").maybeSingle();
 if(!actor||actor.role!=="institution_admin")return c.json({error:"forbidden",message:"Only an institution administrator can activate accounts."},403);
 const {data:member}=await a.supabase.from("institution_memberships").select("id,user_id,role,status").eq("id",membershipId).eq("institution_id",tenant).maybeSingle();
 if(!member||member.status!=="invited")return c.json({error:"not_found",message:"An invited member was not found."},404);
 const {data:user,error:userError}=await a.supabase.auth.admin.getUserById(member.user_id);
 if(userError||!user.user?.email_confirmed_at)return c.json({error:"email_not_verified",message:"The member must verify their email before activation."},409);
 const {data:subscription}=await a.supabase.from("institution_subscriptions").select("status,subscription_plans(max_active_users)").eq("institution_id",tenant).in("status",["active","grace_period"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 const plan=subscription?.subscription_plans as unknown as {max_active_users:number}|null;
 const {count}=await a.supabase.from("institution_memberships").select("id",{count:"exact",head:true}).eq("institution_id",tenant).eq("status","active");
 if(!plan||Number(count||0)>=Number(plan.max_active_users))return c.json({error:"capacity_limit",message:"The active-user allowance has been reached. Archive an inactive account or contact the platform owner."},409);
 const {data:updated,error:updateError}=await a.supabase.from("institution_memberships").update({status:"active",activated_at:new Date().toISOString()}).eq("id",membershipId).select("id,status,role").single();
 if(updateError)return c.json({error:"activation_failed",message:"The account could not be activated."},400);
 if(member.role==="learner")await a.supabase.from("learner_records").update({status:"active"}).eq("institution_id",tenant).eq("user_id",member.user_id);
 await a.supabase.from("audit_logs").insert({actor_user_id:a.user.id,institution_id:tenant,action:"institution_member_activated",target_type:"institution_membership",target_id:membershipId,metadata:{role:member.role}});
 return c.json({activated:true,membership:updated});
});


app.post("/api/v1/institution/results/:id/action",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized",message:"Sign in to manage result publication."},401);
 const id=c.req.param("id");if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:"validation_error",message:"Invalid result publication reference."},400);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json",message:"Submit a valid result action."},400)}
 const tenant=clean(body.institutionId,64),action=clean(body.action,30);
 if(!tenant||!["submit","approve","publish"].includes(action))return c.json({error:"validation_error",message:"Choose a valid result action."},400);
 const {data:member}=await a.supabase.from("institution_memberships").select("id,role").eq("institution_id",tenant).eq("user_id",a.user.id).eq("status","active").maybeSingle();
 if(!member||!(action==="submit"?["institution_admin","staff","lecturer"].includes(member.role):member.role==="institution_admin"))return c.json({error:"forbidden",message:"Submission requires teaching access; approval and publication require an institution administrator."},403);
 const {data:result}=await a.supabase.from("result_publications").select("id,status,title,term_id").eq("id",id).eq("institution_id",tenant).maybeSingle();
 if(!result)return c.json({error:"not_found",message:"Result publication not found."},404);
 if(action==="submit"&&result.status==="draft"){
  const {data:pendingGrades,error:pendingError}=await a.supabase.from("grades").select("id,status").eq("institution_id",tenant).eq("term_id",result.term_id).not("status","in",'("approved","published")').limit(1);
  if(pendingError)return c.json({error:"grade_check_failed",message:"Could not validate grades before submission."},500);
  if(pendingGrades?.length)return c.json({error:"grades_pending",message:"Approve all grades for this term before submitting results for approval."},409);
 }
 if(action==="publish"&&result.status==="approved"){
  const {data:pendingGrades,error:pendingError}=await a.supabase.from("grades").select("id,status").eq("institution_id",tenant).eq("term_id",result.term_id).neq("status","approved").neq("status","published").limit(1);
  if(pendingError)return c.json({error:"grade_check_failed",message:"Could not validate grades before publication."},500);
  if(pendingGrades?.length)return c.json({error:"grades_pending",message:"All grades must be approved before results can be published."},409);
 }
 const next=action==="submit"&&result.status==="draft"?"submitted_for_approval":action==="approve"&&result.status==="submitted_for_approval"?"approved":action==="publish"&&result.status==="approved"?"published":null;
 if(!next)return c.json({error:"invalid_transition",message:"Results must move from draft to submitted, approved, then published."},409);
 const patch:Record<string,unknown>={status:next};
 if(action==="submit")patch.submitted_by=a.user.id;
 if(action==="approve"){patch.approved_by=a.user.id;patch.approved_at=new Date().toISOString();}
 if(action==="publish")patch.published_at=new Date().toISOString();
 const {data:updated,error:updateError}=await a.supabase.from("result_publications").update(patch).eq("id",id).eq("institution_id",tenant).select("id,status,title,published_at").single();
 if(updateError)return c.json({error:"update_failed",message:"Could not save the result publication action."},400);
 if(action==="publish"){
  const {error:gradesError}=await a.supabase.from("grades").update({status:"published",publication_id:id}).eq("institution_id",tenant).eq("term_id",result.term_id).in("status",["approved","submitted"]);
  if(gradesError){console.error("Grade publication update failed",{code:gradesError.code});return c.json({error:"publication_incomplete",message:"The publication state was saved, but grade publication needs reconciliation."},500);}
 }
 await a.supabase.from("audit_logs").insert({actor_user_id:a.user.id,institution_id:tenant,action:"results_"+action,target_type:"result_publication",target_id:id,metadata:{previous_status:result.status,new_status:next,title:result.title}});
 return c.json({updated:true,result:updated});
});


const validUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
async function requireInstitutionRole(a:any, institutionId:string, roles:string[]) {
 const {data}=await a.supabase.from("institution_memberships").select("id,role").eq("institution_id",institutionId).eq("user_id",a.user.id).eq("status","active").maybeSingle();
 if(!data||!roles.includes(data.role))return null;
 const {data:institution}=await a.supabase.from("institutions").select("status").eq("id",institutionId).maybeSingle();
 return institution?.status==="active" ? data : null;
}

app.post("/api/v1/assessments/:id/questions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assessmentId=c.req.param("id");if(!validUuid(assessmentId))return c.json({error:"validation_error",message:"Invalid assessment reference."},400);
 let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),prompt=clean(body.prompt,4000),type=clean(body.questionType,30),points=Number(body.points||1);
 if(!validUuid(tenant)||prompt.length<2||!["single_choice","multiple_choice","short_answer","essay","numeric"].includes(type)||!Number.isFinite(points)||points<=0)return c.json({error:"validation_error",message:"Provide a question, valid type and positive points."},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer"]);if(!member)return c.json({error:"forbidden",message:"Teaching or administrator access is required."},403);
 const {data:assessment}=await a.supabase.from("assessments").select("id,published,course_id").eq("id",assessmentId).eq("institution_id",tenant).maybeSingle();
 if(!assessment)return c.json({error:"not_found",message:"Assessment not found."},404);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",assessment.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden",message:"You are not assigned to this course."},403);}
 if(assessment.published)return c.json({error:"assessment_locked",message:"Unpublish the assessment before changing its questions."},409);
 const options=Array.isArray(body.options)?body.options.slice(0,10).map((o)=>clean(o,500)): [];
 if(["single_choice","multiple_choice"].includes(type)&&options.length<2)return c.json({error:"validation_error",message:"Choice questions require at least two options."},400);
 const answerKey=body.answerKey;
 if(type==="single_choice"&&(!Number.isInteger(Number(answerKey))||Number(answerKey)<0||Number(answerKey)>=options.length))return c.json({error:"validation_error",message:"The correct option must refer to an available option."},400);
 if(type==="multiple_choice"&&(!Array.isArray(answerKey)||!answerKey.length||answerKey.some((v)=>!Number.isInteger(Number(v))||Number(v)<0||Number(v)>=options.length)))return c.json({error:"validation_error",message:"Select one or more valid correct options."},400);
 const {data:last}=await a.supabase.from("assessment_questions").select("position").eq("assessment_id",assessmentId).order("position",{ascending:false}).limit(1).maybeSingle();
 const {data,error}=await a.supabase.from("assessment_questions").insert({institution_id:tenant,assessment_id:assessmentId,position:Number(last?.position||0)+1,question_type:type,prompt,options,answer_key:answerKey??null,points}).select("id,position,question_type,prompt,options,points").single();
 if(error)return c.json({error:"question_save_failed",message:"Could not save the assessment question."},400);
 return c.json({question:data},201);
});

app.get("/api/v1/assessments/:id/questions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assessmentId=c.req.param("id"),tenant=clean(c.req.query("institutionId"),64);if(!validUuid(assessmentId)||!validUuid(tenant))return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer","learner"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:assessment}=await a.supabase.from("assessments").select("id,published,course_id,starts_at,ends_at,max_score").eq("id",assessmentId).eq("institution_id",tenant).maybeSingle();
 if(!assessment)return c.json({error:"not_found"},404);
 if(member.role==="learner"){
  if(!assessment.published)return c.json({error:"not_available",message:"This assessment is not published."},403);
  const {data:lr}=await a.supabase.from("learner_records").select("id").eq("institution_id",tenant).eq("user_id",a.user.id).maybeSingle();
  if(!lr)return c.json({error:"learner_record_missing"},403);
  const {data:enrolment}=await a.supabase.from("course_enrolments").select("id").eq("institution_id",tenant).eq("course_id",assessment.course_id).eq("learner_id",lr.id).eq("status","enrolled").maybeSingle();
  if(!enrolment)return c.json({error:"not_enrolled"},403);
 }
 const {data,error}=await a.supabase.from("assessment_questions").select("id,position,question_type,prompt,options,points").eq("institution_id",tenant).eq("assessment_id",assessmentId).order("position");
 if(error)return c.json({error:"question_read_failed"},500);
 return c.json({assessment,questions:data||[]});
});

app.post("/api/v1/assessments/:id/submissions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assessmentId=c.req.param("id");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),answers=body.answers;
 if(!validUuid(assessmentId)||!validUuid(tenant)||!answers||typeof answers!=="object"||Array.isArray(answers))return c.json({error:"validation_error",message:"Provide an assessment and answers."},400);
 const member=await requireInstitutionRole(a,tenant,["learner"]);if(!member)return c.json({error:"forbidden",message:"Learner access is required."},403);
 const {data:lr}=await a.supabase.from("learner_records").select("id").eq("institution_id",tenant).eq("user_id",a.user.id).maybeSingle();
 const {data:assessment}=await a.supabase.from("assessments").select("id,published,course_id,starts_at,ends_at").eq("id",assessmentId).eq("institution_id",tenant).maybeSingle();
 if(!lr||!assessment||!assessment.published)return c.json({error:"not_available",message:"Learner record or published assessment not found."},403);
 const now=Date.now();if(assessment.starts_at&&now<new Date(assessment.starts_at).getTime())return c.json({error:"not_started",message:"The assessment has not started."},409);if(assessment.ends_at&&now>new Date(assessment.ends_at).getTime())return c.json({error:"closed",message:"The assessment deadline has passed."},409);
 const {data:enrolment}=await a.supabase.from("course_enrolments").select("id").eq("institution_id",tenant).eq("course_id",assessment.course_id).eq("learner_id",lr.id).eq("status","enrolled").maybeSingle();if(!enrolment)return c.json({error:"not_enrolled"},403);
 const {data:existingSubmission}=await a.supabase.from("assessment_submissions").select("id,status").eq("institution_id",tenant).eq("assessment_id",assessmentId).eq("learner_id",lr.id).maybeSingle();
 if(existingSubmission&&existingSubmission.status!=="in_progress")return c.json({error:"already_submitted",message:"This assessment has already been submitted and cannot be replaced."},409);
 const {data:questions,error:qError}=await a.supabase.from("assessment_questions").select("id,question_type,answer_key,points").eq("institution_id",tenant).eq("assessment_id",assessmentId);
 if(qError||!questions?.length)return c.json({error:"assessment_empty",message:"This assessment has no questions yet."},409);
 const submitted=answers as Record<string,unknown>;const allowed=new Set(questions.map(q=>q.id));if(Object.keys(submitted).some(k=>!allowed.has(k)))return c.json({error:"invalid_answers",message:"Answers contain unknown question IDs."},400);
 let rawScore=0,autoGradable=true;const sanitized:Record<string,unknown>={};
 for(const q of questions){const answer=submitted[q.id];if(answer===undefined)continue;sanitized[q.id]=answer;if(q.question_type==="single_choice"||q.question_type==="multiple_choice"){const expected=q.answer_key;const normalize=(v:unknown)=>JSON.stringify(Array.isArray(v)?v.map(Number).sort((x,y)=>x-y):Number(v));if(normalize(answer)===normalize(expected))rawScore+=Number(q.points);}else autoGradable=false;}
 const totalPoints=questions.reduce((n,q)=>n+Number(q.points||0),0);
 if(totalPoints<=0||totalPoints>Number(assessment.max_score))return c.json({error:"invalid_question_points",message:"The question points must total a positive value no greater than the assessment maximum."},409);
 const score=autoGradable?Number((rawScore*Number(assessment.max_score)/totalPoints).toFixed(2)):null;
 const status=autoGradable?"graded":"submitted";
 const {data,error}=await a.supabase.from("assessment_submissions").insert({institution_id:tenant,assessment_id:assessmentId,learner_id:lr.id,answers:sanitized,score,status,submitted_at:new Date().toISOString()}).select("id,status,score,submitted_at").single();
 if(error)return c.json({error:"submission_failed",message:"The submission could not be saved. It may already have been submitted."},400);
 if(autoGradable){const {error:gradeError}=await a.supabase.from("grades").upsert({institution_id:tenant,learner_id:lr.id,course_id:assessment.course_id,assessment_id:assessmentId,score,status:"submitted",entered_by:a.user.id},{onConflict:"institution_id,learner_id,course_id,assessment_id"});if(gradeError){console.error("Auto-graded result persistence failed",{code:gradeError.code});return c.json({error:"grade_persistence_failed",message:"The submission was saved, but the grade record needs administrator review."},500);}}
 return c.json({submission:data},201);
});


app.get("/api/v1/assessments/:id/submissions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assessmentId=c.req.param("id"),tenant=clean(c.req.query("institutionId"),64);
 if(!validUuid(assessmentId)||!validUuid(tenant))return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:assessment}=await a.supabase.from("assessments").select("id,course_id,max_score").eq("id",assessmentId).eq("institution_id",tenant).maybeSingle();if(!assessment)return c.json({error:"not_found"},404);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",assessment.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden"},403);}
 const {data,error}=await a.supabase.from("assessment_submissions").select("id,learner_id,answers,score,status,submitted_at,graded_at,feedback,learner_records(first_name,last_name,learner_number)").eq("institution_id",tenant).eq("assessment_id",assessmentId).order("submitted_at");
 if(error)return c.json({error:"submissions_read_failed"},500);
 return c.json({submissions:data||[]});
});

app.post("/api/v1/assessments/submissions/:submissionId/grade",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const submissionId=c.req.param("submissionId");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),score=Number(body.score),feedback=clean(body.feedback,3000);
 if(!validUuid(submissionId)||!validUuid(tenant)||!Number.isFinite(score)||score<0)return c.json({error:"validation_error",message:"Provide a valid score and institution."},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:submission}=await a.supabase.from("assessment_submissions").select("id,assessment_id,learner_id,assessment:assessments(course_id,max_score)").eq("id",submissionId).eq("institution_id",tenant).maybeSingle();
 if(!submission)return c.json({error:"not_found"},404);
 const assessment=submission.assessment as unknown as {course_id:string;max_score:number};
 if(score>Number(assessment.max_score))return c.json({error:"score_too_high",message:"Score cannot exceed the assessment maximum."},400);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",assessment.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden",message:"You are not assigned to this course."},403);}
 const {data:updated,error}=await a.supabase.from("assessment_submissions").update({score,status:"graded",feedback,graded_by:a.user.id,graded_at:new Date().toISOString()}).eq("id",submissionId).eq("institution_id",tenant).select("id,score,status,feedback,graded_at").single();
 if(error)return c.json({error:"grading_failed"},400);
 await a.supabase.from("grades").upsert({institution_id:tenant,learner_id:submission.learner_id,course_id:assessment.course_id,assessment_id:submission.assessment_id,score,status:"submitted",entered_by:a.user.id},{onConflict:"institution_id,learner_id,course_id,assessment_id"});
 return c.json({submission:updated});
});



app.post("/api/v1/assignments/:id/submissions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assignmentId=c.req.param("id");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),submissionText=clean(body.submissionText,30000);
 if(!validUuid(assignmentId)||!validUuid(tenant)||submissionText.length<1)return c.json({error:"validation_error",message:"Write your assignment response before submitting."},400);
 const member=await requireInstitutionRole(a,tenant,["learner"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:learner}=await a.supabase.from("learner_records").select("id").eq("institution_id",tenant).eq("user_id",a.user.id).maybeSingle();
 const {data:assignment}=await a.supabase.from("assignments").select("id,course_id,published,due_at,max_score").eq("id",assignmentId).eq("institution_id",tenant).maybeSingle();
 if(!learner||!assignment||!assignment.published)return c.json({error:"assignment_unavailable",message:"A published assignment and linked learner record are required."},403);
 if(assignment.due_at&&Date.now()>new Date(assignment.due_at).getTime())return c.json({error:"assignment_closed",message:"The assignment deadline has passed."},409);
 const {data:enrolment}=await a.supabase.from("course_enrolments").select("id").eq("institution_id",tenant).eq("course_id",assignment.course_id).eq("learner_id",learner.id).eq("status","enrolled").maybeSingle();if(!enrolment)return c.json({error:"not_enrolled"},403);
 const {data:existing}=await a.supabase.from("assignment_submissions").select("id,status").eq("institution_id",tenant).eq("assignment_id",assignmentId).eq("learner_id",learner.id).maybeSingle();
 if(existing)return c.json({error:"already_submitted",message:"This assignment has already been submitted. Contact your lecturer if a correction is required."},409);
 const {data,error}=await a.supabase.from("assignment_submissions").insert({institution_id:tenant,assignment_id:assignmentId,learner_id:learner.id,submission_text:submissionText,status:"submitted"}).select("id,status,submitted_at").single();
 if(error)return c.json({error:"submission_failed",message:"The assignment submission could not be saved."},400);
 return c.json({submission:data},201);
});
app.get("/api/v1/assignments/:id/submissions",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const assignmentId=c.req.param("id"),tenant=clean(c.req.query("institutionId"),64);if(!validUuid(assignmentId)||!validUuid(tenant))return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:assignment}=await a.supabase.from("assignments").select("id,course_id,max_score").eq("id",assignmentId).eq("institution_id",tenant).maybeSingle();if(!assignment)return c.json({error:"not_found"},404);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",assignment.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden"},403);}
 const {data,error}=await a.supabase.from("assignment_submissions").select("id,learner_id,submission_text,status,submitted_at,score,feedback,learner_records(first_name,last_name,learner_number)").eq("institution_id",tenant).eq("assignment_id",assignmentId).order("submitted_at");
 if(error)return c.json({error:"submissions_read_failed"},500);
 return c.json({assignment,submissions:data||[]});
});
app.post("/api/v1/assignments/submissions/:submissionId/grade",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const id=c.req.param("submissionId");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),score=Number(body.score),feedback=clean(body.feedback,3000);
 if(!validUuid(id)||!validUuid(tenant)||!Number.isFinite(score)||score<0)return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:submission}=await a.supabase.from("assignment_submissions").select("id,assignment_id,learner_id,assignments(course_id,max_score)").eq("id",id).eq("institution_id",tenant).maybeSingle();if(!submission)return c.json({error:"not_found"},404);
 const assignment=submission.assignments as unknown as {course_id:string;max_score:number};
 if(score>Number(assignment.max_score))return c.json({error:"score_too_high",message:"Score cannot exceed the assignment maximum."},400);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",assignment.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden"},403);}
 const {data:updated,error}=await a.supabase.from("assignment_submissions").update({score,feedback,status:"graded",graded_by:a.user.id,graded_at:new Date().toISOString()}).eq("id",id).eq("institution_id",tenant).select("id,score,feedback,status,graded_at").single();
 if(error)return c.json({error:"grading_failed"},400);
 return c.json({submission:updated});
});

app.post("/api/v1/grades/:id/action",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const id=c.req.param("id");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),action=clean(body.action,20);
 if(!validUuid(id)||!validUuid(tenant)||!["submit","approve"].includes(action))return c.json({error:"validation_error",message:"Choose a valid grade action."},400);
 const roles=action==="approve"?["institution_admin"]:["institution_admin","staff","lecturer"];
 const member=await requireInstitutionRole(a,tenant,roles);if(!member)return c.json({error:"forbidden",message:action==="approve"?"Only an institution administrator can approve grades.":"Teaching or administrator access is required."},403);
 const {data:grade}=await a.supabase.from("grades").select("id,status,course_id,learner_id,score,term_id").eq("id",id).eq("institution_id",tenant).maybeSingle();
 if(!grade)return c.json({error:"not_found",message:"Grade not found."},404);
 if(member.role==="lecturer"){const {data:course}=await a.supabase.from("courses").select("id").eq("id",grade.course_id).eq("lecturer_membership_id",member.id).maybeSingle();if(!course)return c.json({error:"forbidden",message:"You are not assigned to this course."},403);}
 const next=action==="submit"&&grade.status==="draft"?"submitted":action==="approve"&&grade.status==="submitted"?"approved":null;
 if(!next)return c.json({error:"invalid_transition",message:"Grades must move from draft to submitted, then approved."},409);
 const patch:Record<string,unknown>={status:next};if(action==="approve")patch.approved_by=a.user.id;
 const {data:updated,error}=await a.supabase.from("grades").update(patch).eq("id",id).eq("institution_id",tenant).select("id,status,score,letter_grade").single();
 if(error)return c.json({error:"grade_update_failed"},400);
 await a.supabase.from("audit_logs").insert({actor_user_id:a.user.id,institution_id:tenant,action:"grade_"+action,target_type:"grade",target_id:id,metadata:{previous_status:grade.status,new_status:next,course_id:grade.course_id,learner_id:grade.learner_id}});
 return c.json({updated:true,grade:updated});
});

app.get("/api/v1/learners/:learnerId/transcript",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const learnerId=c.req.param("learnerId"),tenant=clean(c.req.query("institutionId"),64);if(!validUuid(learnerId)||!validUuid(tenant))return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin","staff","lecturer","learner"]);if(!member)return c.json({error:"forbidden"},403);
 const {data:learner}=await a.supabase.from("learner_records").select("id,first_name,last_name,learner_number,programme_id,user_id").eq("id",learnerId).eq("institution_id",tenant).maybeSingle();if(!learner)return c.json({error:"not_found"},404);
 if(member.role==="learner"&&learner.user_id!==a.user.id)return c.json({error:"forbidden"},403);
 const {data:grades,error}=await a.supabase.from("grades").select("score,letter_grade,grade_points,credits,status,term_id,courses(code,title,credits),academic_terms(name,academic_years(name))").eq("institution_id",tenant).eq("learner_id",learnerId).in("status",["published"]).order("term_id");
 if(error)return c.json({error:"transcript_failed"},500);
 const rows=(grades||[]).map((g)=>({score:g.score,letterGrade:g.letter_grade,gradePoints:g.grade_points,credits:Number(g.credits??(g.courses as {credits?:number}|null)?.credits??0),term:g.academic_terms,course:g.courses}));
 const totalCredits=rows.reduce((n,g)=>n+g.credits,0),weighted=rows.reduce((n,g)=>n+(Number(g.gradePoints||0)*g.credits),0);
 const termGroups=new Map<string,{term:unknown;credits:number;weighted:number;courses:number}>();
 for(const row of rows){const key=String(row.term?.name||"Unassigned");const group=termGroups.get(key)||{term:row.term,credits:0,weighted:0,courses:0};group.credits+=row.credits;group.weighted+=Number(row.gradePoints||0)*row.credits;group.courses+=1;termGroups.set(key,group);}
 const termGpas=Array.from(termGroups.entries()).map(([term,g])=>({term,credits:g.credits,courses:g.courses,gpa:g.credits?Number((g.weighted/g.credits).toFixed(3)):null}));
 return c.json({learner:{name:learner.first_name+" "+learner.last_name,learnerNumber:learner.learner_number},grades:rows,termGpas,summary:{publishedCourses:rows.length,credits:totalCredits,cgpa:totalCredits?Number((weighted/totalCredits).toFixed(3)):null}});
});

app.post("/api/v1/learners/:learnerId/certificates",async(c)=>{
 const a=await requireSignedIn(c);if("error" in a)return c.json({error:"unauthorized"},401);
 const learnerId=c.req.param("learnerId");let body:Record<string,unknown>;try{body=await c.req.json<Record<string,unknown>>()}catch{return c.json({error:"invalid_json"},400)}
 const tenant=clean(body.institutionId,64),type=clean(body.certificateType,80);
 if(!validUuid(learnerId)||!validUuid(tenant)||type.length<2)return c.json({error:"validation_error"},400);
 const member=await requireInstitutionRole(a,tenant,["institution_admin"]);if(!member)return c.json({error:"forbidden",message:"Only an institution administrator can issue certificates."},403);
 const {data:learner}=await a.supabase.from("learner_records").select("id,first_name,last_name,learner_number").eq("id",learnerId).eq("institution_id",tenant).maybeSingle();if(!learner)return c.json({error:"not_found"},404);
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 const number=clean(body.certificateNumber,100)||("SWL-"+new Date().getUTCFullYear()+"-"+crypto.randomUUID().slice(0,8).toUpperCase());
 const {data,error}=await a.supabase.from("certificates").insert({institution_id:tenant,learner_id:learnerId,certificate_number:number,certificate_type:type,issued_by:a.user.id,verification_token_hash:hash,metadata:{learner_number:learner.learner_number}}).select("id,certificate_number,certificate_type,issued_at").single();
 if(error)return c.json({error:"certificate_issue_failed",message:"Certificate could not be issued. Check whether the certificate number already exists."},400);
 await a.supabase.from("audit_logs").insert({actor_user_id:a.user.id,institution_id:tenant,action:"certificate_issued",target_type:"certificate",target_id:data.id,metadata:{learner_id:learnerId,certificate_number:number}});
 return c.json({certificate:data,verificationToken:token,verificationUrl:"/verify/"+token,warning:"Save the verification token now. It is shown only once."},201);
});

app.get("/api/v1/certificates/verify/:token",async(c)=>{
 const token=clean(c.req.param("token"),128);if(!/^[a-f0-9]{64}$/.test(token))return c.json({valid:false,message:"Certificate not found."},404);
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
 const {data,error}=await createClient(c.env.SUPABASE_URL||"",c.env.SUPABASE_SERVICE_ROLE_KEY||"",{auth:{persistSession:false,autoRefreshToken:false}}).rpc("verify_certificate",{p_token_hash:hash});
 if(error)return c.json({error:"verification_unavailable",message:"Certificate verification is temporarily unavailable."},503);
 const record=Array.isArray(data)?data[0]:data;
 if(!record)return c.json({valid:false,message:"Certificate not found."},404);
 return c.json({certificate:record});
});

app.notFound((c) => c.json({ error: "not_found", message: "The requested resource was not found." }, 404));
app.onError((error, c) => {
  console.error("SawaLearn API request failed", { message: error.message, path: c.req.path });
  return c.json({ error: "internal_error", message: "An unexpected error occurred." }, 500);
});

export default { fetch: app.fetch, scheduled(_event: ScheduledController, env: Env["Bindings"], ctx: ExecutionContext) { ctx.waitUntil(runScheduledTasks(env)); } };
