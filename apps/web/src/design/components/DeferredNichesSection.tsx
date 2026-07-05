"use client";

import React from "react";
import dynamic from "next/dynamic";

const NichesSection = dynamic(() => import("./NichesSection").then((module) => module.NichesSection), {
  ssr: false,
});

export function DeferredNichesSection() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = React.useState(false);

  React.useEffect(() => {
    if (shouldRender) return;

    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div
      ref={ref}
      id={shouldRender ? undefined : "niches"}
      className={shouldRender ? undefined : "leadvirt-deferred-paint min-h-[900px]"}
      aria-hidden={shouldRender ? undefined : true}
    >
      {shouldRender ? <NichesSection /> : null}
    </div>
  );
}
