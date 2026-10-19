import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth/auth-form";
import { isLocalMode } from "@/lib/local-mode";

export const metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <>
      <header className="app-header"><div className="wrap"><Brand /></div></header>
      <main id="main" className="wrap page"><AuthForm mode="sign-up" local={isLocalMode()} /></main>
    </>
  );
}
