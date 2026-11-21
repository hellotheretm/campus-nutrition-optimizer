"use client";

import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

/** Gentle fade-up on first view. Respects the user's reduced-motion setting. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
