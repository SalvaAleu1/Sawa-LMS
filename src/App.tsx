import InstitutionWorkspace from "./InstitutionWorkspace";
import PartnerApplication from "./PartnerApplication";
import PlatformReview from "./PlatformReview";
import PlatformSubscriptions from "./PlatformSubscriptions";
import "./partner.css";
import "./workspace.css";

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/partners/apply") return <PartnerApplication />;
  if (path === "/platform/review") return <PlatformReview />;
  if (path === "/platform/subscriptions") return <PlatformSubscriptions />;
  return <InstitutionWorkspace />;
}
