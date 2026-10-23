import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, GraduationCap, ShieldCheck } from "lucide-react";

type FormValues = {
  legalName: string;
  displayName: string;
  institutionType: string;
  countryCode: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  estimatedLearners: string;
  message: string;
  companyFax: string;
};

const initial: FormValues = {
  legalName: "", displayName: "", institutionType: "university", countryCode: "SS",
  contactName: "", email: "", phone: "", website: "", estimatedLearners: "0",
  message: "", companyFax: "",
};

export default function PartnerApplication() {
  const [values, setValues] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; message: string } | null>(null);

  const update = (key: keyof FormValues, value: string) => setValues(current => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
      if (!apiBase) throw new Error("Partner registration is not connected yet. The deployment team must set VITE_API_BASE_URL to the SawaLearn API URL.");
      const response = await fetch(`${apiBase}/api/v1/partner-applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, estimatedLearners: Number(values.estimatedLearners) }),
      });
      const result = await response.json() as { message?: string; applicationId?: string };
      if (!response.ok) throw new Error(result.message || "We could not submit your application. Please try again.");
      setReceipt({ id: result.applicationId || "received", message: result.message || "Your application has been received." });
      setValues(initial);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="partner-page">
    <header className="partner-header">
      <a href="/" className="partner-brand" aria-label="SawaLearn home"><img src="/brand/sawalearn-mark.svg" alt="" /><span>Sawa<span>Learn</span><small>LEARN. GROW. LEAD.</small></span></a>
      <a href="/" className="partner-back"><ArrowLeft size={16}/> Platform home</a>
    </header>
    <div className="partner-layout">
      <section className="partner-intro">
        <span className="partner-kicker"><span/> PARTNER WITH SAWALEARN</span>
        <h1>Bring your learning community into one connected platform.</h1>
        <p>Tell us about your institution. Our team reviews every application before creating an institutional workspace or granting administrator access.</p>
        <div className="partner-benefit"><span><BookOpen size={19}/></span><div><b>Learning and academic operations</b><small>Prepare to manage courses, learners, assessments and academic records.</small></div></div>
        <div className="partner-benefit"><span><ShieldCheck size={19}/></span><div><b>Reviewed access</b><small>No automatic approval and no open administrator sign-up.</small></div></div>
        <div className="partner-benefit"><span><GraduationCap size={19}/></span><div><b>Built for different institutions</b><small>Universities, colleges, schools and vocational or training centres.</small></div></div>
        <div className="partner-trust"><ShieldCheck size={15}/> Your submission is reviewed before account setup.</div>
      </section>
      <section className="partner-form-panel">
        {receipt ? <div className="partner-success"><span><CheckCircle2 size={28}/></span><h2>Application received</h2><p>{receipt.message}</p><div className="application-reference"><small>APPLICATION REFERENCE</small><b>{receipt.id}</b></div><p className="partner-next">Keep this reference for follow-up. This confirmation is not an approval or an administrator invitation.</p><button className="partner-submit" onClick={() => setReceipt(null)}>Submit another application <ArrowRight size={17}/></button></div> :
          <form onSubmit={submit}>
            <div className="form-title"><span>INSTITUTION APPLICATION</span><h2>Tell us about your institution</h2><p>Fields marked with * are required.</p></div>
            {error && <div className="partner-error" role="alert">{error}</div>}
            <label className="honeypot" aria-hidden="true">Company fax<input tabIndex={-1} autoComplete="off" value={values.companyFax} onChange={e=>update("companyFax",e.target.value)}/></label>
            <div className="partner-fields">
              <label className="field-wide">Institution's legal name *<input required minLength={2} maxLength={180} value={values.legalName} onChange={e=>update("legalName",e.target.value)} placeholder="Full registered name"/></label>
              <label className="field-wide">Name to display on the platform *<input required minLength={2} maxLength={120} value={values.displayName} onChange={e=>update("displayName",e.target.value)} placeholder="Public institution name"/></label>
              <label>Institution type *<select required value={values.institutionType} onChange={e=>update("institutionType",e.target.value)}><option value="university">University</option><option value="college">College</option><option value="school">School</option><option value="vocational_centre">Vocational centre</option><option value="training_centre">Training centre</option><option value="other">Other</option></select></label>
              <label>Country code *<input required pattern="[A-Za-z]{2}" minLength={2} maxLength={2} value={values.countryCode} onChange={e=>update("countryCode",e.target.value.toUpperCase())} placeholder="SS"/></label>
              <label className="field-wide">Primary contact person *<input required minLength={2} maxLength={120} value={values.contactName} onChange={e=>update("contactName",e.target.value)} placeholder="Full name"/></label>
              <label>Contact email *<input required type="email" maxLength={254} value={values.email} onChange={e=>update("email",e.target.value)} placeholder="name@institution.org"/></label>
              <label>Phone number *<input required type="tel" minLength={5} maxLength={40} value={values.phone} onChange={e=>update("phone",e.target.value)} placeholder="+211 ..."/></label>
              <label className="field-wide">Website (optional)<input type="url" maxLength={200} value={values.website} onChange={e=>update("website",e.target.value)} placeholder="https://institution.org"/></label>
              <label className="field-wide">Approximate number of learners<input type="number" min={0} max={10000000} step={1} value={values.estimatedLearners} onChange={e=>update("estimatedLearners",e.target.value)}/></label>
              <label className="field-wide">What would you like SawaLearn to help your institution with?<textarea rows={4} maxLength={1500} value={values.message} onChange={e=>update("message",e.target.value)} placeholder="Share your current learning or administration needs (optional)."/></label>
            </div>
            <p className="partner-consent">By submitting, you confirm that you are authorised to contact us on behalf of this institution. Do not include passwords or sensitive student records.</p>
            <button className="partner-submit" type="submit" disabled={busy}>{busy ? "Submitting application…" : "Submit partner application"} {!busy && <ArrowRight size={17}/>}</button>
          </form>}
      </section>
    </div>
    <footer className="partner-footer"><span>© 2026 SawaLearn</span><span>One platform. Every learning journey.</span><span><ShieldCheck size={14}/> Reviewed partner onboarding</span></footer>
  </main>;
}
