import React from "react";

export const GlowBg = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-zinc-950">
      <div className="leadvirt-glow-bg absolute top-0 left-0 right-0 h-[1200px] mask-image-b" />

      <div className="leadvirt-ambient-indigo absolute top-[-100px] -left-[10%] w-[50vw] h-[800px] rounded-full" />
      <div className="leadvirt-ambient-emerald absolute top-[100px] -right-[10%] w-[40vw] h-[900px] rounded-full" />
      <div className="leadvirt-ambient-fuchsia absolute top-[600px] left-[20%] w-[60vw] h-[700px] rounded-full" />
      
      <div className="absolute top-0 left-0 right-0 h-[1000px] bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
    </div>
  );
};
