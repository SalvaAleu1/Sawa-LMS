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
  status: "foundation",
  message: "Authentication and tenant-authorized endpoints are being implemented in subsequent delivery stages.",
}));

app.notFound((c) => c.json({ error: "not_found", message: "The requested resource was not found." }, 404));
app.onError((error, c) => {
  // Keep internal stack traces and secrets out of public responses.
  console.error("SawaLearn API request failed", { message: error.message, path: c.req.path });
  return c.json({ error: "internal_error", message: "An unexpected error occurred." }, 500);
});

export default app;
