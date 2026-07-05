import React from "react";
import { ImageWithFallback } from "../figma/ImageWithFallback";

export const GlowBg = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-zinc-950">
      {/* Abstract Texture */}
      <div className="absolute top-0 left-0 right-0 h-[1200px] opacity-16 mask-image-b">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950 z-10" />
        <ImageWithFallback 
          src="https://images.unsplash.com/photo-1710438399422-2fca27686bcd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbW9kZXJuJTIwYWJzdHJhY3QlMjBiYWNrZ3JvdW5kfGVufDF8fHx8MTc4MTczOTMxOHww&ixlib=rb-4.1.0&q=80&w=1080" 
          alt="Abstract dark modern background"
          className="w-full h-full object-cover grayscale opacity-30"
        />
      </div>

      <div className="absolute top-[-100px] -left-[10%] w-[42vw] h-[640px] rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="absolute top-[100px] -right-[10%] w-[36vw] h-[720px] rounded-full bg-emerald-600/16 blur-3xl" />
      <div className="absolute top-[600px] left-[20%] w-[48vw] h-[560px] rounded-full bg-fuchsia-600/12 blur-3xl" />
      
      {/* Grid overlay for hero */}
      <div className="absolute top-0 left-0 right-0 h-[1000px] bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
    </div>
  );
};
