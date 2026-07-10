import Image from "next/image";

export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-brand-mark="true"
      className={`relative block shrink-0 overflow-hidden bg-zinc-950 ${className}`}
    >
      <Image
        src="/brand/logo.png"
        alt=""
        width={1254}
        height={1254}
        sizes="80px"
        className="absolute -left-[55%] -top-[41%] h-[210%] w-[210%] max-w-none"
      />
    </span>
  );
}
