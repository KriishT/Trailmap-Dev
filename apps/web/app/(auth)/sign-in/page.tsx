import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth/auth-form";
import { isLocalMode } from "@/lib/local-mode";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <>
      <header className="app-header"><div className="wrap"><Brand /></div></header>
      <main id="main" className="wrap page"><AuthForm mode="sign-in" local={isLocalMode()} /></main>
    </>
  );
}
