import React from "react";
import { Loader } from "@geist-ui/icons";
import { motion } from "motion/react";

export default function AuthGateLoader() {
  return (
    <div className="min-h-screen bg-[#09090F] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="w-12 h-12 rounded-2xl bg-[#12121A] border border-[#27273A] flex items-center justify-center">
          <Loader size={22} className="text-purple-400 animate-spin" />
        </div>
        <p className="text-sm text-zinc-500">Loading…</p>
      </motion.div>
    </div>
  );
}
