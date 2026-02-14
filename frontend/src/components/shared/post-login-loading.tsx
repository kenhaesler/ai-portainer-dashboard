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
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-xl"
      onAnimationComplete={(definition) => {
        if (definition === 'exit' && onComplete) {
          onComplete();
        }
      }}
    >
      <div className="relative mb-8">
        {/* Outer Glow */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute inset-0 rounded-full bg-primary/20 blur-3xl"
        />

        {/* Rotating Logo */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "linear"
          }}
          className="relative h-32 w-32"
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
      <div className="text-center">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-lg font-medium tracking-tight"
        >
          Initializing Intelligence
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-2 flex items-center justify-center gap-2"
        >
          <span className="h-px w-8 bg-muted-foreground/30" />
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Powered by AI
          </p>
          <span className="h-px w-8 bg-muted-foreground/30" />
        </motion.div>
      </div>

      {/* Loading Progress Line */}
      <div className="absolute bottom-16 w-64">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted/30">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="h-full w-1/2 bg-gradient-to-r from-transparent via-primary to-transparent"
          />
        </div>
      </div>
    </motion.div>
  );
}
