import Link from "next/link";

/** Survey benchmark mark: a triangle on a datum line. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 21 19H3z" />
      <path d="M2 22h20" />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <BrandMark />
      Trailmap Evidence
    </Link>
  );
}
