// PLUGleads Animation Data Atoms for Framer Motion & GSAP
// These physics dictate the industrial roofer-themed UI interactions.

export const ROOFING_PHYSICS = {
  // 1. The "Shingle-Slide" Transition (Card Entrance)
  shingleSlide: {
    initial: { x: "100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-100%", opacity: 0 },
    transition: { type: "spring", stiffness: 260, damping: 20 }
  },

  // 2. The "Tear-Off" Delete (Card Rejection/Dead Lead)
  tearOffDisposal: {
    exit: {
      clipPath: "polygon(0 0, 100% 0, 100% 75%, 85% 90%, 70% 75%, 55% 90%, 40% 75%, 25% 90%, 10% 75%, 0 90%)",
      y: 800,
      rotate: -10,
      opacity: 0,
      transition: { duration: 0.8, ease: "easeIn" }
    }
  },

  // 3. The "Nail-Gun" Confirmation (Button Tap/Save)
  nailGunRecoil: {
    whileTap: { 
      scale: 0.92, 
      y: 4, 
      transition: { type: "spring", stiffness: 600, damping: 10 } 
    }
  },

  // 4. The "Bundle-Drop" Weight (Bulk Import Arrival)
  bundleDrop: {
    initial: { y: -200, opacity: 0, scale: 1.05 },
    animate: { 
      y: 0, 
      opacity: 1, 
      scale: 1,
      transition: { type: "spring", bounce: 0.6, duration: 0.8 }
    }
  }
};
