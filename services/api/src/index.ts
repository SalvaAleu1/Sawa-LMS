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
 const file=form.get("file"),tenant=clean(form.get("institutionId"),64),courseId=clean(form.get("courseId"),64),title=clean(form.get("title"),180);
 if(!(file instanceof File)||!tenant||!courseId||title.length<2)return c.json({error:"validation_error",message:"Choose a course, title and file."},400);
 if(file.size<1||file.size>20*1024*1024)return c.json({error:"file_size",message:"Files must be no larger than 20 MB."},413);
 if(!uploadTypes.has(file.type))return c.json({error:"file_type",message:"This file type is not supported."},415);
 const {data:member}=await a.supabase.from("institution_memberships").select("id,role").eq("institution_id",tenant).eq("user_id",a.user.id).eq("status","active").in("role",["institution_admin","lecturer","staff"]).maybeSingle();
 if(!member)return c.json({error:"forbidden",message:"Active teaching or administrator access is required."},403);
 const {data:sub}=await a.supabase.from("institution_subscriptions").select("status,subscription_plans(storage_limit_bytes)").eq("institution_id",tenant).in("status",["active","grace_period"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
 if(!sub)return c.json({error:"subscription_inactive",message:"An active subscription is required to upload files."},403);
 const plan=sub.subscription_plans as unknown as {storage_limit_bytes:number}|null;
 const {data:usage}=await a.supabase.from("storage_usage").select("used_bytes").eq("institution_id",tenant).maybeSingle();
 const used=Number(usage?.used_bytes||0);
 if(!plan||used+file.size>Number(plan.storage_limit_bytes))return c.json({error:"storage_limit",message:"The institution has reached its storage allowance. Contact the platform owner to change the plan."},413);
 const {data:course}=await a.supabase.from("courses").select("id").eq("id",courseId).eq("institution_id",tenant).maybeSingle();
 if(!course)return c.json({error:"course_not_found",message:"The selected course does not belong to this institution."},404);
 const name=file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100)||"resource";
 const key=tenant+"/"+courseId+"/"+crypto.randomUUID()+"-"+name;
 await c.env.R2_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type,cacheControl:"private, no-store"},customMetadata:{institutionId:tenant,courseId,uploadedBy:a.user.id}});
 const {error}=await a.supabase.from("learning_materials").insert({institution_id:tenant,course_id:courseId,title,description:clean(form.get("description"),1000)||null,object_key:key,content_type:file.type,size_bytes:file.size,uploaded_by:a.user.id,published:false});
 if(error){await c.env.R2_BUCKET.delete(key);return c.json({error:"upload_failed",message:"Could not attach the file to the course."},500)}
 const {error:usageError}=await a.supabase.from("storage_usage").upsert({institution_id:tenant,used_bytes:used+file.size,updated_at:new Date().toISOString()},{onConflict:"institution_id"});
 if(usageError)console.error("Storage usage update failed",{code:usageError.code});
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

app.notFound((c) => c.json({ error: "not_found", message: "The requested resource was not found." }, 404));
app.onError((error, c) => {
  console.error("SawaLearn API request failed", { message: error.message, path: c.req.path });
  return c.json({ error: "internal_error", message: "An unexpected error occurred." }, 500);
});

export default { fetch: app.fetch, scheduled(_event: ScheduledController, env: Env["Bindings"], ctx: ExecutionContext) { ctx.waitUntil(runScheduledTasks(env)); } };
