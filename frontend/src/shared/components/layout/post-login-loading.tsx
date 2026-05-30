import { motion } from 'framer-motion';
import { ICON_SET_MAP } from '../icons/icon-sets';

interface PostLoginLoadingProps {
  onComplete?: () => void;
}

export function PostLoginLoading({ onComplete }: PostLoginLoadingProps) {
  const icon = ICON_SET_MAP['docker-ai'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0f]"
      onAnimationComplete={(definition) => {
        if (definition === 'exit' && onComplete) {
          onComplete();
        }
      }}
    >
      {/* Background Ambient Glow */}
      <motion.div
        animate={{
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{ duration: 4, repeat: Infinity }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.15),transparent_70%)]"
      />

      <div className="relative mb-12">
        {/* Outer Glow - Intensified */}
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.4, 0.8, 0.4],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute inset-0 rounded-full bg-primary/30 blur-[100px]"
        />

        {/* Rotating Logo - Larger */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "linear"
          }}
          className="relative h-48 w-48"
        >
          <svg
            viewBox={icon.viewBox}
            className="h-full w-full text-primary"
            role="img"
            aria-label="Loading logo"
          >
            <defs>
              <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="oklch(72% 0.14 244)" />
                <stop offset="100%" stopColor="oklch(78% 0.18 158)" />
              </linearGradient>
            </defs>
            {icon.paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={p.fill === 'currentColor' ? 'url(#logoGradient)' : (p.fill ?? 'none')}
                stroke={p.stroke === 'currentColor' ? 'url(#logoGradient)' : (p.stroke ?? 'none')}
                strokeWidth={p.strokeWidth}
                strokeLinecap={p.strokeLinecap}
                strokeLinejoin={p.strokeLinejoin}
              />
            ))}
          </svg>
        </motion.div>
      </div>

      {/* Powered by AI Text */}
      <div className="relative text-center">
        <motion.p
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring" }}
          className="text-2xl font-bold tracking-tight text-white"
        >
          Initializing Intelligence
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 flex items-center justify-center gap-3"
        >
          <span className="h-px w-12 bg-primary/40" />
          <p className="text-sm font-black uppercase tracking-[0.4em] text-primary/80">
            Powered by AI
          </p>
          <span className="h-px w-12 bg-primary/40" />
        </motion.div>
      </div>

      {/* Loading Progress Line - More obvious */}
      <div className="absolute bottom-20 w-80">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5 border border-white/10">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="h-full w-2/3 bg-gradient-to-r from-transparent via-primary to-transparent"
          />
        </div>
        <p className="mt-4 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
          Establishing secure neural link...
        </p>
      </div>
    </motion.div>
  );
}
