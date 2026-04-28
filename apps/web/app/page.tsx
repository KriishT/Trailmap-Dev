import { createSupabaseServerClient } from "@/lib/supabase-server";
import { HeroSection } from "@/components/hero/hero-section";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <HeroSection isSignedIn={!!user} />;
}

