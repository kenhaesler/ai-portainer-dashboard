# Web Application Performance Optimization Guide

## Executive Summary

This comprehensive research document covers performance optimization strategies for a full-stack web application built with React 19, Fastify 5, SQLite, Socket.IO, Redis, and modern tooling. Recommendations are prioritized by impact vs. effort and include concrete implementation examples.

**Quick Wins (High Impact, Low Effort):**
- Enable React 19 compiler (measure component render regressions before/after)
- Configure Vite build optimizations (often meaningful bundle/runtime improvements, app-dependent)
- Audit SQLite pragmas and checkpointing strategy (WAL is already enabled in this repo)
- Add Fastify compression (60%+ response size reduction)
- Enable TypeScript incremental builds (1.16-7.73x faster compilation)

---

## Table of Contents

1. [Frontend Performance](#1-frontend-performance)
2. [Backend Performance](#2-backend-performance)
3. [Network & Data Transfer](#3-network--data-transfer)
4. [Build & Development Speed](#4-build--development-speed)
5. [Monitoring & Profiling](#5-monitoring--profiling)
6. [Implementation Priority Matrix](#6-implementation-priority-matrix)

---

## 1. Frontend Performance

### 1.1 React 19 Compiler & Optimizations

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐ (Low)

#### Overview
React 19 introduces an automatic compiler that optimizes performance by converting components into efficient JavaScript code, eliminating the need for manual `useMemo()` and `useCallback()` in many cases.

#### Key Benefits
- Reduced manual memoization in many safe cases
- Automatic memoization where safe
- Potential render performance improvements in hot paths (must be benchmarked)
- Easier performance maintenance as components evolve

#### Implementation

```tsx
// React 19 automatically optimizes this - no manual memoization needed
function ProductList({ products }) {
  // Do not mutate props; copy before sorting
  const sortedProducts = [...products].sort((a, b) => a.price - b.price);

  return (
    <div>
      {sortedProducts.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

**Configure the compiler in your build tool:**

```js
// vite.config.ts
export default {
  plugins: [
    react({
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {
            // Enable strict mode for maximum optimization
            compilationMode: 'strict'
          }]
        ]
      }
    })
  ]
}
```

#### Concurrent Features

**useTransition for Non-Blocking Updates:**

```tsx
import { useTransition } from 'react';

function SearchableList() {
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState('');

  const handleChange = (e) => {
    // Mark filter update as non-urgent
    startTransition(() => {
      setFilter(e.target.value);
    });
  };

  return (
    <>
      <input onChange={handleChange} />
      {isPending && <Spinner />}
      <FilteredList filter={filter} />
    </>
  );
}
```

**Async Transitions (Actions):**

```tsx
function CommentForm() {
  const [isPending, startTransition] = useTransition();
  const [comments, setComments] = useState<string[]>([]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Async work can run in a transition action
    startTransition(async () => {
      const nextComment = e.target.comment.value;
      const saved = await submitComment(nextComment);

      // State updates after await must be wrapped in another transition
      startTransition(() => {
        setComments((prev) => [...prev, saved.text]);
      });
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea name="comment" />
      <button disabled={isPending}>
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

**Optimistic Updates:**

```tsx
import { useOptimistic } from 'react';

function TodoList({ todos }) {
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (state, newTodo) => [...state, { ...newTodo, pending: true }]
  );

  const handleAdd = async (text) => {
    // Show optimistically
    addOptimisticTodo({ id: Date.now(), text });

    // Actually save
    await saveTodo(text);
  };

  return (
    <ul>
      {optimisticTodos.map(todo => (
        <li key={todo.id} className={todo.pending ? 'opacity-50' : ''}>
          {todo.text}
        </li>
      ))}
    </ul>
  );
}
```

#### Tradeoffs
- Compiler may increase build time slightly
- Not all code patterns can be auto-optimized (dynamic object creation still needs manual optimization)

**Sources:**
- [React 19 Key Features](https://colorwhistle.com/latest-react-features/)
- [React 19 vs React 18: Performance Improvements](https://dev.to/manojspace/react-19-vs-react-18-performance-improvements-and-migration-guide-5h85)
- [React Performance Optimization: Best Practices](https://dev.to/alex_bobes/react-performance-optimization-15-best-practices-for-2025-17l9)

---

### 1.2 Strategic Use of React Memoization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐ (Low-Medium)

#### When to Use (Profile First!)

While React 19's compiler handles many cases, manual optimization is still valuable for:
- Expensive computations
- Functions passed as props to child components
- Dependencies in useEffect
- Components that re-render frequently with stable props

#### useMemo: Memoize Expensive Calculations

```tsx
function DataTable({ data, filters }) {
  // Expensive filtering/sorting - worth memoizing
  const processedData = useMemo(() => {
    return data
      .filter(item => item.status === filters.status)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(item => ({
        ...item,
        displayName: formatComplexName(item) // expensive operation
      }));
  }, [data, filters.status]); // Only recalculate when these change

  return <Table data={processedData} />;
}
```

#### useCallback: Stabilize Function References

```tsx
function ParentComponent() {
  const [count, setCount] = useState(0);
  const [otherState, setOtherState] = useState('');

  // Without useCallback, this creates a new function on every render
  // causing ExpensiveChild to re-render unnecessarily
  const handleClick = useCallback(() => {
    console.log('Clicked', count);
  }, [count]); // Only recreate when count changes

  return (
    <>
      <ExpensiveChild onClick={handleClick} />
      <input value={otherState} onChange={e => setOtherState(e.target.value)} />
    </>
  );
}

const ExpensiveChild = React.memo(({ onClick }) => {
  // Only re-renders when onClick reference changes
  return <button onClick={onClick}>Click me</button>;
});
```

#### React.memo: Prevent Unnecessary Component Re-renders

```tsx
// Wrap component to skip re-renders when props haven't changed
const ContainerCard = React.memo(({ container }) => {
  return (
    <div className="card">
      <h3>{container.name}</h3>
      <p>Status: {container.status}</p>
    </div>
  );
}, (prevProps, nextProps) => {
  // Optional: custom comparison function
  // Return true if props are equal (skip re-render)
  return prevProps.container.id === nextProps.container.id &&
         prevProps.container.status === nextProps.container.status;
});
```

#### Anti-Patterns (Don't Over-Optimize!)

```tsx
// ❌ BAD: Memoizing cheap calculations adds overhead
const total = useMemo(() => a + b, [a, b]);

// ✅ GOOD: Just calculate directly
const total = a + b;

// ❌ BAD: Memoizing primitives
const value = useMemo(() => props.value, [props.value]);

// ✅ GOOD: Primitives are cheap to compare
const value = props.value;

// ❌ BAD: useCallback alone doesn't help if parent re-renders anyway
const handleClick = useCallback(() => {
  console.log('click');
}, []);

// ✅ GOOD: Combine with React.memo on child
const Child = React.memo(({ onClick }) => <button onClick={onClick} />);
```

#### Best Practices
1. **Profile first** - Use React DevTools Profiler to identify actual bottlenecks
2. **Memoize at the boundary** - Focus on expensive computations and frequently re-rendering components
3. **Keep dependencies minimal** - More dependencies = less effective memoization
4. **Don't memoize everything** - Adds cognitive load and memory overhead

**Sources:**
- [React memo documentation](https://react.dev/reference/react/memo)
- [Improve React Performance With useMemo And useCallback](https://www.debugbear.com/blog/react-usememo-usecallback)
- [Optimize React Re-Renders with useMemo and useCallback](https://oneuptime.com/blog/post/2026-01-15-optimize-react-rerenders-usememo-usecallback/view)

---

### 1.3 Vite Build Optimization

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### Overview
Vite 6.0 can improve build performance and bundle output with proper configuration, but exact gains depend on dependency graph and route structure.

#### Configuration Example

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    // Analyze bundle size
    visualizer({
      filename: './dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true
    })
  ],

  build: {
    // Enable build optimizations
    target: 'esnext',
    minify: 'terser',

    terserOptions: {
      compress: {
        drop_console: true, // Remove console.logs in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info'] // Remove specific calls
      }
    },

    // CSS code splitting
    cssCodeSplit: true,

    // Rollup options for code splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'chart-vendor': ['recharts'],
          'ui-vendor': ['framer-motion', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],

          // Feature-based chunks (lazy-loaded)
          'container-pages': [
            './src/pages/containers.tsx',
            './src/pages/container-detail.tsx'
          ],
          'monitoring-pages': [
            './src/pages/monitoring.tsx',
            './src/pages/anomalies.tsx'
          ]
        },

        // Name chunks for better debugging
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'entries/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },

    // Increase chunk size warning limit (default 500kb)
    chunkSizeWarningLimit: 1000,

    // Source maps for production debugging (optional)
    sourcemap: false // or 'hidden' for error reporting
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@tanstack/react-query',
      'recharts'
    ],
    // Force optimize these even if they're ESM
    force: true
  }
});
```

#### Route-Based Code Splitting

```tsx
// App.tsx - Lazy load pages for automatic code splitting
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Lazy load all pages
const Dashboard = lazy(() => import('./pages/dashboard'));
const Containers = lazy(() => import('./pages/containers'));
const ContainerDetail = lazy(() => import('./pages/container-detail'));
const Monitoring = lazy(() => import('./pages/monitoring'));

// Loading component
function PageLoader() {
  return <div className="flex items-center justify-center h-screen">Loading...</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/containers" element={<Containers />} />
          <Route path="/containers/:id" element={<ContainerDetail />} />
          <Route path="/monitoring" element={<Monitoring />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
```

#### Tree Shaking Optimization

```tsx
// ❌ BAD: Imports entire library
import _ from 'lodash';
const result = _.debounce(fn, 300);

// ✅ GOOD: Import only what you need
import debounce from 'lodash/debounce';
const result = debounce(fn, 300);

// ✅ GOOD: Recharts public entrypoint (supported API)
import { LineChart, BarChart } from 'recharts';

// ❌ AVOID: Internal/deep imports are unstable across versions
import { LineChart } from 'recharts/es6/chart/LineChart';
```

#### Results
- Initial bundle: can drop substantially when large dependencies are split
- Build time: may improve with optimized chunks and dependency strategy
- Better browser caching (vendors change less than app code)

**Sources:**
- [Vite Build Options](https://vite.dev/config/build-options)
- [Vite 6.0 Build Optimization Guide](https://markaicode.com/vite-6-build-optimization-guide/)
- [Optimizing React Vite Bundle Size](https://shaxadd.medium.com/optimizing-your-react-vite-application-a-guide-to-reducing-bundle-size-6b7e93891c96)

---

### 1.4 TanStack Query Optimization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐ (Low-Medium)

#### Overview
Proper cache configuration prevents unnecessary network requests and improves perceived performance.

#### Optimal Configuration

```tsx
// lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // How long data is considered fresh (no refetch)
      // Container data: 30s (changes moderately)
      staleTime: 30 * 1000,

      // How long unused data stays in cache
      // Keep for 5 minutes for quick navigation
      gcTime: 5 * 60 * 1000, // formerly cacheTime

      // Retry failed requests
      retry: 2,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch on window focus for critical data
      refetchOnWindowFocus: true,

      // Don't refetch on reconnect (we use real-time updates)
      refetchOnReconnect: false,

      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
    mutations: {
      retry: 1,
    }
  }
});
```

#### Per-Query Configuration

```tsx
// hooks/use-containers.ts
import { useQuery } from '@tanstack/react-query';

// Frequently accessed, changes often - short stale time
export function useContainers() {
  return useQuery({
    queryKey: ['containers'],
    queryFn: fetchContainers,
    staleTime: 10 * 1000, // 10s - containers change frequently
    gcTime: 5 * 60 * 1000, // 5min cache
  });
}

// Rarely changes - long stale time
export function useContainerNetworks() {
  return useQuery({
    queryKey: ['networks'],
    queryFn: fetchNetworks,
    staleTime: 5 * 60 * 1000, // 5min - networks rarely change
    gcTime: 30 * 60 * 1000, // 30min cache
  });
}

// Real-time critical - very short stale time
export function useContainerMetrics(containerId: string) {
  return useQuery({
    queryKey: ['metrics', containerId],
    queryFn: () => fetchMetrics(containerId),
    staleTime: 5 * 1000, // 5s - metrics change constantly
    gcTime: 60 * 1000, // 1min cache (metrics are time-sensitive)
    refetchInterval: 30 * 1000, // Poll every 30s
  });
}
```

#### Prefetching for Navigation

```tsx
// components/container-list.tsx
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

function ContainerList({ containers }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleContainerHover = (containerId: string) => {
    // Prefetch container details on hover
    queryClient.prefetchQuery({
      queryKey: ['container', containerId],
      queryFn: () => fetchContainerDetail(containerId),
      staleTime: 30 * 1000,
    });
  };

  const handleContainerClick = (containerId: string) => {
    // Data is already prefetched - instant navigation!
    navigate(`/containers/${containerId}`);
  };

  return (
    <div>
      {containers.map(container => (
        <div
          key={container.id}
          onMouseEnter={() => handleContainerHover(container.id)}
          onClick={() => handleContainerClick(container.id)}
        >
          {container.name}
        </div>
      ))}
    </div>
  );
}
```

#### Optimistic Updates

```tsx
// hooks/use-container-mutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useUpdateContainerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateContainer,

    // Optimistically update UI before server responds
    onMutate: async (updatedContainer) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['containers'] });

      // Snapshot previous value
      const previousContainers = queryClient.getQueryData(['containers']);

      // Optimistically update cache
      queryClient.setQueryData(['containers'], (old: Container[]) =>
        old.map(c => c.id === updatedContainer.id ? updatedContainer : c)
      );

      // Return context with snapshot
      return { previousContainers };
    },

    // On error, rollback to snapshot
    onError: (err, updatedContainer, context) => {
      queryClient.setQueryData(['containers'], context.previousContainers);
    },

    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}
```

#### Selective Query Invalidation

```tsx
// Instead of invalidating all queries
queryClient.invalidateQueries(); // ❌ Bad - refetches everything

// Invalidate specific queries
queryClient.invalidateQueries({ queryKey: ['containers'] }); // ✅ Good

// Invalidate with filters
queryClient.invalidateQueries({
  queryKey: ['containers'],
  predicate: query => query.state.data?.length > 0 // Only if we have data
}); // ✅ Better
```

#### Benefits
- Reduced API calls: 40-60% fewer requests
- Instant navigation with prefetching
- Better UX with optimistic updates
- Lower server load

**Sources:**
- [TanStack Query Prefetching Docs](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [React Query Prefetching Example](https://tanstack.com/query/latest/docs/framework/react/examples/prefetching)
- [How to Prefetch Data with TanStack Query](https://jsdev.space/howto/react-query-prefetch/)

---

### 1.5 CSS & Animation Performance

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐⭐ (Medium)

#### Backdrop-Blur Performance Concerns

**Problem:** Backdrop-blur is GPU-intensive and can drop frames on mobile devices.

**Solution:** Strategic use with performance optimizations.

```css
/* ❌ BAD: Backdrop blur on every card */
.card {
  backdrop-filter: blur(20px);
}

/* ✅ GOOD: Only on important UI elements */
.modal-overlay,
.sidebar,
.header {
  backdrop-filter: blur(12px); /* Lower blur = better performance */

  /* Hint to browser for optimization */
  will-change: backdrop-filter;

  /* Create GPU layer */
  transform: translateZ(0);
}

/* Remove will-change after animation completes to free memory */
.modal-overlay.is-open {
  will-change: backdrop-filter;
}

.modal-overlay:not(.is-open) {
  will-change: auto;
}
```

#### GPU-Accelerated Properties

```css
/* ❌ BAD: Animating layout properties (causes reflow) */
.card {
  transition: width 0.3s, height 0.3s, left 0.3s;
}

/* ✅ GOOD: Only transform and opacity (GPU-accelerated) */
.card {
  transition: transform 0.3s, opacity 0.3s;
}

/* Scale instead of changing width/height */
.card:hover {
  transform: scale(1.05);
}
```

#### Will-Change Optimization

```css
/* ❌ BAD: will-change on everything */
* {
  will-change: transform, opacity;
}

/* ✅ GOOD: Only on elements that will animate */
.animating-element {
  will-change: transform;
}

/* ✅ BETTER: Add dynamically via JavaScript */
```

```tsx
// Add will-change just before animation, remove after
function AnimatedCard() {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (cardRef.current) {
      cardRef.current.style.willChange = 'transform';
    }
  };

  const handleAnimationEnd = () => {
    if (cardRef.current) {
      cardRef.current.style.willChange = 'auto'; // Free memory
    }
  };

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onTransitionEnd={handleAnimationEnd}
      className="card"
    >
      Content
    </div>
  );
}
```

#### Alternative to Real Blur (Performance Boost)

Instead of animating blur value (very expensive), use cross-fade technique:

```tsx
// Pre-compute blurred versions at build time
function BlurredBackground() {
  return (
    <div className="relative">
      {/* Base layer - no blur */}
      <img src="bg.jpg" className="absolute inset-0" />

      {/* Pre-blurred layers */}
      <img
        src="bg-blur-5.jpg"
        className="absolute inset-0 opacity-0 transition-opacity"
        style={{ opacity: blurLevel >= 5 ? 1 : 0 }}
      />
      <img
        src="bg-blur-10.jpg"
        className="absolute inset-0 opacity-0 transition-opacity"
        style={{ opacity: blurLevel >= 10 ? 1 : 0 }}
      />
    </div>
  );
}
```

#### Limit Blur Effects

```tsx
// Track and limit concurrent blur effects
const MAX_BLUR_EFFECTS = 5;

function DashboardLayout() {
  const blurredElements = [
    'sidebar',
    'header',
    'modal-overlay',
    // Limit to 3-5 total
  ];

  return (
    <div>
      <aside className="backdrop-blur-md">Sidebar</aside>
      <header className="backdrop-blur-sm">Header</header>

      {/* Cards without blur */}
      <main>
        <Card /> {/* No backdrop-filter here */}
      </main>
    </div>
  );
}
```

#### Performance Recommendations
- Limit to 3-5 simultaneous blur effects on mobile
- Use blur values ≤ 12px (lower = faster)
- Prefer opacity/transform over width/height/position
- Add `will-change` dynamically, remove after animation
- Consider pre-blurred images for backgrounds

**Sources:**
- [CSS Backdrop-Filter Performance](https://blog.openreplay.com/creating-blurred-backgrounds-css-backdrop-filter/)
- [Costly CSS Properties and Optimization](https://dev.to/leduc1901/costly-css-properties-and-how-to-optimize-them-3bmd)
- [Animating a blur](https://developer.chrome.com/blog/animated-blur)

---

### 1.6 Framer Motion Optimization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐ (Low-Medium)

#### LazyMotion for Bundle Size Reduction

```tsx
// app.tsx - Global setup
import { LazyMotion, domAnimation } from 'framer-motion';

function App() {
  return (
    <LazyMotion features={domAnimation} strict>
      {/* All motion components use lazy-loaded features */}
      <RouterProvider router={router} />
    </LazyMotion>
  );
}
```

```tsx
// components/animated-card.tsx
// Use 'm' instead of 'motion' with LazyMotion
import { m } from 'framer-motion';

function AnimatedCard() {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      Card content
    </m.div>
  );
}
```

**Bundle size reduction:** 34kb → 4.6kb for initial render.

#### GPU-Accelerated Animations

```tsx
// ❌ BAD: Animating layout properties
<motion.div
  animate={{ width: 200, height: 200, left: 100 }}
/>

// ✅ GOOD: Only transform and opacity
<motion.div
  animate={{
    scale: 1.2,
    x: 100,
    y: 50,
    opacity: 0.8
  }}
/>
```

#### Layout Animations (Automatic FLIP)

```tsx
// Framer Motion automatically uses FLIP technique for layout changes
import { motion } from 'framer-motion';

function ExpandableCard({ isExpanded }) {
  return (
    <motion.div
      layout // Animates layout changes smoothly
      className={isExpanded ? 'w-full' : 'w-64'}
    >
      <motion.h2 layout="position"> {/* Only animate position */}
        Title
      </motion.h2>
      <motion.p layout="position">
        Content
      </motion.p>
    </motion.div>
  );
}
```

#### Optimize Frequent Animations

```tsx
// Use useMotionValue for frequently updated values (bypasses React re-renders)
import { useMotionValue, useTransform, motion } from 'framer-motion';

function Cursor() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    const handleMouseMove = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <motion.div
      style={{
        x,
        y,
        // Doesn't trigger React re-renders - pure transform
      }}
      className="cursor-dot"
    />
  );
}
```

#### Stagger Children Efficiently

```tsx
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05, // 50ms between each child
      delayChildren: 0.1,
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 }
  }
};

function ContainerList({ containers }) {
  return (
    <motion.ul
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {containers.map(container => (
        <motion.li key={container.id} variants={itemVariants}>
          {container.name}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

#### Reduce Motion for Accessibility

```tsx
import { MotionConfig } from 'framer-motion';

function App() {
  return (
    <MotionConfig reducedMotion="user">
      {/* Respects prefers-reduced-motion */}
      <AnimatedContent />
    </MotionConfig>
  );
}
```

**Sources:**
- [Reduce bundle size of Framer Motion](https://motion.dev/docs/react-reduce-bundle-size)
- [Framer Motion Performance Tips](https://tillitsdone.com/blogs/framer-motion-performance-tips/)
- [Best Practices for Performant Animations](https://app.studyraid.com/en/read/7850/206073/best-practices-for-performant-animations)

---

### 1.7 List Virtualization

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### When to Use
- Lists with 100+ items
- Tables with many rows
- Infinite scrolling feeds
- Real-time logs

#### Implementation with react-window

```bash
npm install react-window
```

```tsx
// components/virtualized-container-list.tsx
import { FixedSizeList } from 'react-window';

interface Container {
  id: string;
  name: string;
  status: string;
}

function VirtualizedContainerList({ containers }: { containers: Container[] }) {
  // Row renderer
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const container = containers[index];

    return (
      <div style={style} className="border-b p-4 hover:bg-gray-50">
        <div className="font-medium">{container.name}</div>
        <div className="text-sm text-gray-500">{container.status}</div>
      </div>
    );
  };

  return (
    <FixedSizeList
      height={600} // Viewport height
      itemCount={containers.length}
      itemSize={80} // Row height in pixels
      width="100%"
      overscanCount={5} // Render 5 extra items for smooth scrolling
    >
      {Row}
    </FixedSizeList>
  );
}
```

#### Variable Height Items

```tsx
import { VariableSizeList } from 'react-window';

function VirtualizedLogList({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<VariableSizeList>(null);

  // Calculate height for each item
  const getItemSize = (index: number) => {
    const log = logs[index];
    // Multi-line logs are taller
    const lines = log.message.split('\n').length;
    return 40 + (lines - 1) * 20;
  };

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => (
    <div style={style} className="p-2 border-b">
      <pre className="text-xs">{logs[index].message}</pre>
    </div>
  );

  return (
    <VariableSizeList
      ref={listRef}
      height={500}
      itemCount={logs.length}
      itemSize={getItemSize}
      width="100%"
      overscanCount={3}
    >
      {Row}
    </VariableSizeList>
  );
}
```

#### Grid Virtualization

```tsx
import { FixedSizeGrid } from 'react-window';

function VirtualizedImageGrid({ images }: { images: string[] }) {
  const COLUMN_COUNT = 4;
  const ROW_COUNT = Math.ceil(images.length / COLUMN_COUNT);

  const Cell = ({ columnIndex, rowIndex, style }: any) => {
    const index = rowIndex * COLUMN_COUNT + columnIndex;
    const image = images[index];

    if (!image) return null;

    return (
      <div style={style} className="p-2">
        <img src={image} alt="" className="w-full h-full object-cover" />
      </div>
    );
  };

  return (
    <FixedSizeGrid
      columnCount={COLUMN_COUNT}
      columnWidth={200}
      height={600}
      rowCount={ROW_COUNT}
      rowHeight={200}
      width={800}
    >
      {Cell}
    </FixedSizeGrid>
  );
}
```

#### Performance Impact
- 10,000 items: 60fps scrolling vs. unusable without virtualization
- Memory usage: ~95% reduction
- Initial render: 10x faster

**Sources:**
- [List Virtualization in React](https://medium.com/@atulbanwar/list-virtualization-in-react-3db491346af4)
- [Virtualize large lists with react-window](https://web.dev/articles/virtualize-long-lists-react-window)
- [Rendering large lists with React Virtualized](https://blog.logrocket.com/rendering-large-lists-react-virtualized/)

---

### 1.8 Recharts Performance Optimization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐⭐ (Medium)

#### Data Sampling for Large Datasets

```tsx
// utils/data-sampling.ts
export function downsampleData<T extends { timestamp: number }>(
  data: T[],
  maxPoints: number = 100
): T[] {
  if (data.length <= maxPoints) return data;

  const samplingRate = Math.ceil(data.length / maxPoints);
  return data.filter((_, index) => index % samplingRate === 0);
}
```

```tsx
// components/metrics-chart.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function MetricsChart({ data }: { data: MetricPoint[] }) {
  // Only render last 100 points for performance
  const sampledData = useMemo(
    () => downsampleData(data, 100),
    [data]
  );

  return (
    <LineChart width={600} height={300} data={sampledData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="timestamp" />
      <YAxis />
      <Tooltip />
      <Line
        type="monotone"
        dataKey="value"
        stroke="#8884d8"
        dot={false} // Disable dots for performance
        isAnimationActive={false} // Disable animations for large datasets
      />
    </LineChart>
  );
}
```

#### Memoize Chart Components

```tsx
// Prevent re-renders when data hasn't changed
const MemoizedChart = React.memo(({ data, width, height }) => {
  return (
    <LineChart width={width} height={height} data={data}>
      <Line dataKey="value" stroke="#8884d8" />
    </LineChart>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if data reference changed
  return prevProps.data === nextProps.data &&
         prevProps.width === nextProps.width &&
         prevProps.height === nextProps.height;
});
```

#### Stabilize dataKey

```tsx
// ❌ BAD: Creates new object every render
function Chart() {
  return <Line dataKey={d => d.value * 2} />;
}

// ✅ GOOD: Stable dataKey
function Chart() {
  const transformedData = useMemo(
    () => data.map(d => ({ ...d, doubledValue: d.value * 2 })),
    [data]
  );

  return <Line dataKey="doubledValue" />;
}
```

#### Windowing for Real-Time Data

```tsx
function RealTimeChart({ data }: { data: MetricPoint[] }) {
  // Only show last 5 minutes of data
  const windowedData = useMemo(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    return data
      .filter(point => point.timestamp >= fiveMinutesAgo)
      .slice(-100); // Max 100 points
  }, [data]);

  return (
    <LineChart data={windowedData}>
      {/* ... */}
    </LineChart>
  );
}
```

#### Disable Animations for Large Datasets

```tsx
function PerformantChart({ data }) {
  const disableAnimations = data.length > 50;

  return (
    <LineChart data={data}>
      <Line
        dataKey="value"
        isAnimationActive={!disableAnimations}
        animationDuration={disableAnimations ? 0 : 300}
      />
    </LineChart>
  );
}
```

**Sources:**
- [Recharts Performance Optimization](https://recharts.github.io/en-US/guide/performance/)
- [Recharts is slow with large data](https://github.com/recharts/recharts/issues/1146)
- [Rendering Optimization Techniques](https://app.studyraid.com/en/read/11352/355003/rendering-optimization-techniques)

---

## 2. Backend Performance

### 2.1 Fastify 5 Optimizations

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### Schema Compilation & Validation

Fastify pre-compiles JSON schemas into highly optimized functions.

```ts
// routes/containers.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Define schema once, reuse everywhere
const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['running', 'stopped', 'paused']),
  image: z.string()
});

// Convert to JSON Schema for Fastify
const containerJsonSchema = zodToJsonSchema(containerSchema);

export async function containerRoutes(fastify: FastifyInstance) {
  fastify.get('/containers', {
    // Schema compiled once at route registration
    schema: {
      response: {
        200: {
          type: 'array',
          items: containerJsonSchema
        }
      }
    }
  }, async (request, reply) => {
    const containers = await getContainers();

    // fast-json-stringify automatically serializes based on schema
    return containers;
  });
}
```

#### Serialization Performance

```ts
// Fastify uses fast-json-stringify (5-10x faster than JSON.stringify)
// Automatically applied when response schema is defined

// ❌ SLOW: No schema - uses JSON.stringify
fastify.get('/data', async () => {
  return { large: 'object' };
});

// ✅ FAST: With schema - uses fast-json-stringify
fastify.get('/data', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: {
          large: { type: 'string' }
        }
      }
    }
  }
}, async () => {
  return { large: 'object' };
});
```

#### Response Caching

```ts
// Use @fastify/caching for automatic response caching
import caching from '@fastify/caching';

await fastify.register(caching, {
  privacy: 'private',
  expiresIn: 300, // 5 minutes
  serverExpiresIn: 60, // Server-side cache: 1 minute
});

fastify.get('/containers', {
  // Enable caching for this route
  cache: {
    expiresIn: 30000, // 30 seconds
    privacy: 'private'
  }
}, async () => {
  return await fetchContainersFromPortainer();
});
```

#### Custom Serializers for Performance

```ts
// For frequently serialized objects, create custom serializers
import fastJson from 'fast-json-stringify';

const containerSerializer = fastJson({
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'integer' } // timestamp as integer, not string
  }
});

fastify.get('/containers/:id', async (request, reply) => {
  const container = await getContainer(request.params.id);

  // Use custom serializer
  reply.type('application/json');
  return containerSerializer(container);
});
```

**Sources:**
- [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Master Fastify Performance](https://astconsulting.in/java-script/nodejs/fastify/master-fastify-performance-production-optimization)
- [Fastify In-Depth: Speed, Performance, Scalability](https://leapcell.medium.com/fastify-in-depth-speed-performance-and-scalability-node-js-web-framework-22cfc308791f)

---

### 2.2 SQLite Performance Tuning

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### Essential PRAGMA Settings

```ts
// db/sqlite.ts
import Database from 'better-sqlite3';

export function createDatabase(path: string) {
  const db = new Database(path);

  // Essential performance pragmas
  db.pragma('journal_mode = WAL'); // Write-Ahead Logging
  db.pragma('synchronous = NORMAL'); // Safe with WAL, much faster
  db.pragma('cache_size = -64000'); // 64MB cache (negative = KB)
  db.pragma('temp_store = MEMORY'); // Temp tables in RAM
  db.pragma('mmap_size = 30000000000'); // Memory-mapped I/O (30GB)
  db.pragma('page_size = 4096'); // Match OS page size

  // Auto-vacuum to prevent fragmentation
  db.pragma('auto_vacuum = INCREMENTAL');

  // Optimize queries
  db.pragma('optimize');

  return db;
}
```

**Performance impact:** WAL + `synchronous=NORMAL` often improves write concurrency and latency, but exact gains vary by workload and hardware.

#### Prepared Statements (Critical!)

```ts
// ❌ BAD: Creating new statement every time
export function getContainer(id: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
}

// ✅ GOOD: Prepare once, reuse many times
const stmts = {
  getContainer: null as any,
  updateContainer: null as any,
};

export function initStatements(db: Database.Database) {
  stmts.getContainer = db.prepare('SELECT * FROM containers WHERE id = ?');
  stmts.updateContainer = db.prepare(
    'UPDATE containers SET status = ?, updated_at = ? WHERE id = ?'
  );
}

export function getContainer(id: string) {
  return stmts.getContainer.get(id);
}
```

#### Transaction Batching

```ts
// ❌ SLOW: Individual inserts (~500ms for 1000 rows)
export function insertContainers(containers: Container[]) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO containers VALUES (?, ?, ?)');

  for (const container of containers) {
    stmt.run(container.id, container.name, container.status);
  }
}

// ✅ FAST: Batched in transaction (~10ms for 1000 rows)
export function insertContainers(containers: Container[]) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO containers VALUES (?, ?, ?)');

  const insertMany = db.transaction((containers: Container[]) => {
    for (const container of containers) {
      stmt.run(container.id, container.name, container.status);
    }
  });

  insertMany(containers);
}
```

#### Strategic Indexing

```sql
-- migrations/003-add-indexes.sql

-- Index foreign keys
CREATE INDEX IF NOT EXISTS idx_metrics_container_id
  ON metrics(container_id);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_metrics_container_timestamp
  ON metrics(container_id, timestamp DESC);

-- Partial index for active containers only
CREATE INDEX IF NOT EXISTS idx_active_containers
  ON containers(status, name)
  WHERE status = 'running';

-- Index for full-text search
CREATE VIRTUAL TABLE containers_fts USING fts5(
  name,
  image,
  content=containers,
  content_rowid=rowid
);
```

#### WAL Checkpoint Management

```ts
// Prevent WAL from growing too large
setInterval(() => {
  const db = getDb();

  // Checkpoint WAL (move to main DB)
  db.pragma('wal_checkpoint(TRUNCATE)');
}, 5 * 60 * 1000); // Every 5 minutes

// Or on-demand when WAL gets large
export function checkpointIfNeeded() {
  const db = getDb();
  const walSize = db.pragma('wal_size', { simple: true });

  if (walSize > 1000) { // More than 1000 pages
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
}
```

#### Query Optimization

```ts
// Use EXPLAIN QUERY PLAN to optimize queries
export function analyzeQuery(sql: string) {
  const db = getDb();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  console.log(plan);
}

// Example usage
analyzeQuery(`
  SELECT * FROM metrics
  WHERE container_id = 'abc'
  AND timestamp > 1234567890
  ORDER BY timestamp DESC
  LIMIT 100
`);

// Look for "USING INDEX" in output - if not present, add index!
```

#### Connection Pool Pattern

```ts
// better-sqlite3 is synchronous, but can use worker threads for parallelism
import { Worker } from 'worker_threads';

class DatabasePool {
  private workers: Worker[] = [];

  constructor(dbPath: string, poolSize: number = 4) {
    for (let i = 0; i < poolSize; i++) {
      this.workers.push(new Worker('./db-worker.js', {
        workerData: { dbPath }
      }));
    }
  }

  async query(sql: string, params: any[]) {
    const worker = this.getNextWorker();
    return new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage({ sql, params });
    });
  }

  private getNextWorker() {
    // Round-robin or least-busy strategy
    return this.workers[Math.floor(Math.random() * this.workers.length)];
  }
}
```

**Sources:**
- [SQLite Performance Tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite PRAGMA Cheatsheet](https://cj.rs/blog/sqlite-pragma-cheatsheet-for-performance-and-consistency/)
- [better-sqlite3 Performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)

---

### 2.3 Socket.IO Optimization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐ (Low-Medium)

#### Enable Compression

```ts
// server.ts
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  // Enable compression (gzip) for messages > 1KB
  perMessageDeflate: {
    threshold: 1024, // Compress messages larger than 1KB
    zlibDeflateOptions: {
      chunkSize: 8 * 1024, // 8KB chunks
      memLevel: 7, // Memory usage vs speed tradeoff
      level: 3 // Compression level (0-9, lower = faster)
    }
  },

  // HTTP compression for initial handshake
  httpCompression: {
    threshold: 1024
  }
});
```

**Impact:** 40-60% reduction in network traffic for JSON payloads.

#### Binary Transport for Performance

```ts
// Instead of JSON for metrics
// ❌ JSON: { "cpu": 45.2, "memory": 512000000, "timestamp": 1234567890 }
// ✅ Binary: 16 bytes (4 bytes per float/int)

// Server: Send binary data
io.to('monitoring').emit('metrics', Buffer.from(new Float32Array([
  45.2,           // CPU %
  512000000,      // Memory bytes
  1234567890      // Timestamp
])));

// Client: Parse binary data
socket.on('metrics', (buffer: ArrayBuffer) => {
  const view = new Float32Array(buffer);
  const metrics = {
    cpu: view[0],
    memory: view[1],
    timestamp: view[2]
  };
});
```

#### Message Batching

```ts
// ❌ BAD: Emitting every metric individually
function sendMetrics(containerId: string, metrics: Metric[]) {
  metrics.forEach(metric => {
    io.to(`container:${containerId}`).emit('metric', metric);
  });
}

// ✅ GOOD: Batch metrics
function sendMetrics(containerId: string, metrics: Metric[]) {
  // Send all at once
  io.to(`container:${containerId}`).emit('metrics:batch', metrics);
}

// ✅ BETTER: Time-based batching
class MetricBatcher {
  private batches = new Map<string, Metric[]>();
  private timer: NodeJS.Timeout;

  constructor(private io: Server, private interval = 1000) {
    this.timer = setInterval(() => this.flush(), interval);
  }

  add(containerId: string, metric: Metric) {
    if (!this.batches.has(containerId)) {
      this.batches.set(containerId, []);
    }
    this.batches.get(containerId)!.push(metric);
  }

  flush() {
    for (const [containerId, metrics] of this.batches) {
      if (metrics.length > 0) {
        this.io.to(`container:${containerId}`).emit('metrics:batch', metrics);
      }
    }
    this.batches.clear();
  }
}
```

#### Efficient Room Management

```ts
// ❌ BAD: Broadcasting to all sockets
io.emit('container:update', container); // Sends to everyone

// ✅ GOOD: Use rooms for targeted broadcasts
socket.on('subscribe:container', (containerId) => {
  socket.join(`container:${containerId}`);
});

socket.on('unsubscribe:container', (containerId) => {
  socket.leave(`container:${containerId}`);
});

// Only send to subscribers
io.to(`container:${containerId}`).emit('update', container);
```

#### Throttling High-Frequency Events

```ts
// Client-side: Throttle rapid events
import { throttle } from 'lodash';

const throttledEmit = throttle((event, data) => {
  socket.emit(event, data);
}, 1000); // Max once per second

// Usage
window.addEventListener('scroll', () => {
  throttledEmit('scroll:position', window.scrollY);
});
```

#### WebSocket vs. HTTP Polling

```ts
// Force WebSocket-only (fastest transport)
const io = new Server(httpServer, {
  transports: ['websocket'], // Skip polling entirely

  // Or allow fallback but prefer WebSocket
  transports: ['websocket', 'polling'],

  // Upgrade timeout
  upgradeTimeout: 10000
});
```

**Impact:** WebSocket reduces latency from 150ms to 55ms vs. polling.

**Sources:**
- [Socket.IO Performance Tuning](https://socket.io/docs/v4/performance-tuning/)
- [Optimizing Socket.IO Performance with Binary Mode](https://blog.cantremember.com/optimizing-socketio-performance-with-binary-mode)
- [Scaling Socket.IO](https://ably.com/topic/scaling-socketio)

---

### 2.4 Redis Caching Patterns

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐⭐ (Medium)

#### Cache-Aside Pattern (Most Common)

```ts
// services/portainer-cache.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function getContainers(): Promise<Container[]> {
  const cacheKey = 'portainer:containers';

  // 1. Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Cache miss - fetch from Portainer
  const containers = await fetchContainersFromPortainer();

  // 3. Store in cache with TTL
  await redis.setex(cacheKey, 30, JSON.stringify(containers));

  return containers;
}
```

#### Redis Pipeline for Bulk Operations

```ts
// ❌ SLOW: Multiple round-trips
async function cacheMultipleContainers(containers: Container[]) {
  for (const container of containers) {
    await redis.setex(
      `container:${container.id}`,
      300,
      JSON.stringify(container)
    );
  }
}

// ✅ FAST: Single round-trip with pipeline
async function cacheMultipleContainers(containers: Container[]) {
  const pipeline = redis.pipeline();

  for (const container of containers) {
    pipeline.setex(
      `container:${container.id}`,
      300,
      JSON.stringify(container)
    );
  }

  await pipeline.exec();
}
```

**Impact:** 10-100x faster for bulk operations.

#### Cache Warming Strategy

```ts
// Proactively populate cache during low traffic
export async function warmCache() {
  const criticalData = [
    { key: 'containers', fetcher: fetchContainers, ttl: 30 },
    { key: 'images', fetcher: fetchImages, ttl: 300 },
    { key: 'networks', fetcher: fetchNetworks, ttl: 600 },
  ];

  const pipeline = redis.pipeline();

  for (const { key, fetcher, ttl } of criticalData) {
    const data = await fetcher();
    pipeline.setex(key, ttl, JSON.stringify(data));
  }

  await pipeline.exec();
}

// Run during deployment or low-traffic hours
if (process.env.NODE_ENV === 'production') {
  // Warm cache every 15 minutes
  setInterval(warmCache, 15 * 60 * 1000);

  // Initial warm-up
  warmCache();
}
```

#### Implement Cache Eviction Policies

```ts
// Configure Redis for LRU eviction
// Add to redis.conf or pass as startup options

// maxmemory 256mb
// maxmemory-policy allkeys-lru  # Evict least recently used keys

// In code, set appropriate TTLs
const TTL_CONFIG = {
  containers: 30,        // 30s - changes frequently
  images: 5 * 60,        // 5min - rarely changes
  networks: 10 * 60,     // 10min - very stable
  metrics: 60,           // 1min - time-sensitive
  'user:session': 24 * 60 * 60, // 24h
};

export function getCacheTTL(category: keyof typeof TTL_CONFIG): number {
  return TTL_CONFIG[category];
}
```

#### Cache Stampede Prevention

```ts
// Problem: Cache expires, 1000 simultaneous requests hit DB
// Solution: Use Redis lock with SETNX

export async function getContainersWithLock(): Promise<Container[]> {
  const cacheKey = 'portainer:containers';
  const lockKey = `${cacheKey}:lock`;

  // Try to get from cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Try to acquire lock
  const lockAcquired = await redis.setnx(lockKey, '1');

  if (lockAcquired) {
    // We got the lock - fetch data
    try {
      await redis.expire(lockKey, 10); // Lock expires in 10s

      const containers = await fetchContainersFromPortainer();
      await redis.setex(cacheKey, 30, JSON.stringify(containers));

      return containers;
    } finally {
      await redis.del(lockKey);
    }
  } else {
    // Someone else is fetching - wait briefly and retry
    await new Promise(resolve => setTimeout(resolve, 100));
    return getContainersWithLock(); // Retry
  }
}
```

#### Multi-Layer Caching

```ts
// Layer 1: In-memory (instant)
// Layer 2: Redis (fast)
// Layer 3: Database (slow)

class MultiLayerCache {
  private memoryCache = new Map<string, { data: any; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    // L1: Memory cache
    const cached = this.memoryCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    // L2: Redis cache
    const redisValue = await redis.get(key);
    if (redisValue) {
      const data = JSON.parse(redisValue);

      // Populate L1
      this.memoryCache.set(key, {
        data,
        expires: Date.now() + 5000 // 5s in-memory TTL
      });

      return data;
    }

    return null;
  }

  async set(key: string, value: any, ttl: number) {
    // Set in both layers
    this.memoryCache.set(key, {
      data: value,
      expires: Date.now() + Math.min(ttl * 1000, 5000)
    });

    await redis.setex(key, ttl, JSON.stringify(value));
  }
}
```

**Sources:**
- [Redis Caching with Express](https://redis.io/learn/develop/node/nodecrashcourse/caching)
- [Node.js Distributed Caching Best Practices](https://medium.com/@arunangshudas/8-best-practices-for-node-js-distributed-caching-4991066a9586)
- [Multi-Layer Caching with Redis](https://oneuptime.com/blog/post/2026-01-25-multi-layer-caching-redis-nodejs/view)

---

### 2.5 Zod Schema Performance

**Impact:** ⭐⭐⭐ (Medium) | **Effort:** ⭐⭐ (Low-Medium)

#### Schema Caching

```ts
// ❌ BAD: Creating schema on every request
app.post('/containers', async (req, res) => {
  const schema = z.object({
    name: z.string(),
    image: z.string()
  });

  const data = schema.parse(req.body); // Schema created every time
});

// ✅ GOOD: Define schema once, reuse
const createContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  env: z.array(z.string()).optional()
});

app.post('/containers', async (req, res) => {
  const data = createContainerSchema.parse(req.body);
});
```

#### Use safeParse for Non-Critical Validation

```ts
// ❌ parse() throws on error (expensive with try/catch in hot paths)
try {
  const data = schema.parse(input);
} catch (error) {
  // Handle error
}

// ✅ safeParse() returns result object (faster)
const result = schema.safeParse(input);
if (!result.success) {
  return res.status(400).json({ errors: result.error.errors });
}

const data = result.data;
```

#### Lazy Initialization for Large Schemas

```ts
// For complex schemas, use lazy loading
const containerSchema = z.lazy(() => z.object({
  id: z.string(),
  name: z.string(),
  // ... many more fields
  nested: z.lazy(() => nestedSchema) // Only parse if accessed
}));
```

#### Pre-compile with Fastify

```ts
// Compile Zod to JSON Schema once
import { zodToJsonSchema } from 'zod-to-json-schema';

const containerSchema = z.object({
  name: z.string(),
  image: z.string()
});

// Convert to JSON Schema for Fastify
const jsonSchema = zodToJsonSchema(containerSchema);

// Fastify compiles this once at startup
fastify.post('/containers', {
  schema: {
    body: jsonSchema
  }
}, async (request, reply) => {
  // Validation already done by Fastify (faster than Zod)
  const data = request.body;
});
```

#### Alternative: Use AJV Directly for High-Throughput

```ts
// For maximum performance, skip Zod and use AJV directly
import Ajv from 'ajv';

const ajv = new Ajv({ coerceTypes: true });

const validateContainer = ajv.compile({
  type: 'object',
  properties: {
    name: { type: 'string' },
    image: { type: 'string' }
  },
  required: ['name', 'image']
});

// Much faster validation
const isValid = validateContainer(data);
if (!isValid) {
  console.error(validateContainer.errors);
}
```

**Impact:** AJV is 1842% faster than Zod for validation in some benchmarks.

**Sources:**
- [Zod Performance Enhancement Opportunities](https://github.com/colinhacks/zod/issues/5310)
- [Why is Zod so slow?](https://blog.logrocket.com/why-zod-slow/)
- [Optimizing Zod Validation Performance](https://app.studyraid.com/en/read/11289/352206/optimizing-validation-performance)

---

### 2.6 API Response Compression

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐ (Low)

#### Enable Fastify Compression

```ts
// server.ts
import compress from '@fastify/compress';

await fastify.register(compress, {
  global: true,

  // Support Brotli (best compression) and gzip (widely supported)
  encodings: ['br', 'gzip', 'deflate'],

  // Brotli options (best for static assets)
  brotliOptions: {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4 // 0-11, 4 is good balance
    }
  },

  // Gzip options (good for dynamic content)
  zlibOptions: {
    level: 6 // 0-9, 6 is default
  },

  // Only compress responses > 1KB
  threshold: 1024,

  // Customize per content type
  customTypes: /^text\/|application\/json|application\/javascript/
});
```

#### Per-Route Configuration

```ts
// Disable compression for already-compressed data
fastify.get('/image.png', {
  compress: false // Don't compress images
}, async () => {
  return fs.readFile('image.png');
});

// Custom compression for specific route
fastify.get('/large-json', {
  compress: {
    threshold: 512, // Lower threshold
    level: 9 // Maximum compression
  }
}, async () => {
  return hugeDatabaseResult;
});
```

#### Performance Comparison

**Brotli vs. Gzip on 100KB JSON response:**
- Uncompressed: 100KB
- Gzip (level 6): 38KB (62% reduction, ~120ms)
- Brotli (quality 4): 36KB (64% reduction, ~95ms) ✅ Winner

**Recommendation:**
- Use Brotli for static assets (pre-compress at build time)
- Use Gzip for dynamic responses (faster compression)
- Skip compression for < 1KB responses (overhead not worth it)

**Sources:**
- [Fastify Compress Plugin](https://github.com/fastify/fastify-compress)
- [HTTP Compression in Node.js](https://www.ayrshare.com/http-compression-in-node-js-a-dive-into-gzip-deflate-and-brotli/)
- [Implementing Data Compression in REST APIs](https://zuplo.com/learning-center/implementing-data-compression-in-rest-apis-with-gzip-and-brotli)

---

## 3. Network & Data Transfer

### 3.1 HTTP/2 and HTTP/3

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐⭐ (Medium)

#### Enable HTTP/2 in Fastify

```ts
// server.ts
import fs from 'fs';
import fastify from 'fastify';

const app = fastify({
  http2: true,
  https: {
    key: fs.readFileSync('./certs/key.pem'),
    cert: fs.readFileSync('./certs/cert.pem')
  }
});
```

#### Benefits
- **Multiplexing:** Multiple requests over single connection
- **Header compression:** HPACK reduces overhead
- **Server push:** Send resources before requested (use sparingly)
- **Binary protocol:** Faster parsing than HTTP/1.1 text

#### HTTP/3 (QUIC) Considerations

HTTP/3 uses UDP instead of TCP, eliminating head-of-line blocking.

**Performance gains:**
- Reduced latency on packet loss
- Faster connection establishment (0-RTT)
- Better mobile performance

**When to use:**
- High-latency networks
- Mobile applications
- Real-time features

**Note:** HTTP/3 requires server and CDN support. Check compatibility before implementing.

#### Socket.IO Transport Notes

```ts
// Prefer standard HTTP/1.1 Upgrade path for Socket.IO/WebSocket
// even when TLS termination supports HTTP/2 or HTTP/3.
const io = new Server(httpServer, {
  transports: ['websocket'],
});
```

**Sources:**
- [HTTP/3 vs. HTTP/2 Performance](https://blog.cloudflare.com/http-3-vs-http-2/)
- [WebSockets vs. HTTP/2](https://dev-aditya.medium.com/websockets-vs-http-2-choosing-the-right-protocol-for-real-time-and-high-performance-applications-72ffc0107073)
- [Future of WebSockets: HTTP/3 and WebTransport](https://websocket.org/guides/future-of-websockets/)

---

### 3.2 API Response Pagination

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐⭐ (Low-Medium)

#### Cursor-Based Pagination (Preferred)

```ts
// ❌ BAD: Offset pagination (slow for large datasets)
fastify.get('/containers', async (req) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  // Slow for high offsets (OFFSET 10000 scans 10000 rows)
  return db.query('SELECT * FROM containers LIMIT ? OFFSET ?', [limit, offset]);
});

// ✅ GOOD: Cursor-based pagination
fastify.get('/containers', {
  schema: {
    querystring: {
      cursor: { type: 'string' },
      limit: { type: 'number', default: 20, maximum: 100 }
    }
  }
}, async (req) => {
  const { cursor, limit } = req.query;

  // Use indexed column for cursor
  const containers = await db.query(
    'SELECT * FROM containers WHERE id > ? ORDER BY id LIMIT ?',
    [cursor || '', limit + 1] // Fetch one extra to check if more exists
  );

  const hasMore = containers.length > limit;
  const items = hasMore ? containers.slice(0, -1) : containers;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    items,
    nextCursor,
    hasMore
  };
});
```

#### Client-Side Implementation

```tsx
// hooks/use-paginated-containers.ts
import { useInfiniteQuery } from '@tanstack/react-query';

export function usePaginatedContainers() {
  return useInfiniteQuery({
    queryKey: ['containers', 'paginated'],
    queryFn: ({ pageParam }) =>
      api.get(`/containers?cursor=${pageParam || ''}&limit=20`),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined,
  });
}

// components/container-list.tsx
function ContainerList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = usePaginatedContainers();

  return (
    <>
      {data?.pages.map(page =>
        page.items.map(container => (
          <ContainerCard key={container.id} container={container} />
        ))
      )}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading...' : 'Load More'}
        </button>
      )}
    </>
  );
}
```

---

### 3.3 Service Worker Caching

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐⭐⭐ (Medium-High)

#### Implementation with Workbox

```bash
npm install -D vite-plugin-pwa
```

```ts
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      workbox: {
        // Cache static assets
        runtimeCaching: [
          // API responses - Network First
          {
            urlPattern: /^https:\/\/api\.example\.com\/containers/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },

          // Images - Cache First
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              }
            }
          },

          // Static JS/CSS - Stale While Revalidate
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              }
            }
          }
        ]
      }
    })
  ]
});
```

#### Caching Strategies

**1. Cache First (Static Assets)**
```ts
// Serve from cache, fallback to network
// Best for: Images, fonts, versioned assets
```

**2. Network First (Dynamic Data)**
```ts
// Try network, fallback to cache
// Best for: API responses, user data
```

**3. Stale While Revalidate (Balance)**
```ts
// Serve from cache immediately, update in background
// Best for: Non-critical API calls, news feeds
```

#### Benefits
- Instant page loads on repeat visits
- Offline functionality
- Reduced bandwidth usage
- Lower server load

**Sources:**
- [Offline-First PWAs](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)
- [PWA Caching Strategies Checklist](https://www.zeepalm.com/blog/pwa-offline-functionality-caching-strategies-checklist)
- [Service Workers MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)

---

## 4. Build & Development Speed

### 4.1 TypeScript Incremental Builds

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### Enable Incremental Compilation

```json
// tsconfig.json
{
  "compilerOptions": {
    // Enable incremental builds
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo",

    // Project references for monorepo
    "composite": true,

    // Speed up compilation
    "skipLibCheck": true, // Don't type-check node_modules
    "skipDefaultLibCheck": true,

    // Faster module resolution
    "moduleResolution": "bundler", // New in TS 5.0+
  },
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts"
  ]
}
```

#### Project References for Monorepo

```json
// backend/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}

// frontend/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}

// Root tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./backend" },
    { "path": "./frontend" }
  ]
}
```

#### Build with Project References

```bash
# Build all projects (only changed ones recompile)
tsc --build

# Clean and rebuild
tsc --build --clean
tsc --build
```

**Performance Impact:**
- First build: Same speed
- Incremental builds: 1.16x to 7.73x faster
- Larger projects see bigger gains

**Sources:**
- [TypeScript Incremental Compilation](https://www.typescriptlang.org/tsconfig/incremental.html)
- [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript Performance Optimizations](https://levelup.gitconnected.com/how-to-improve-typescript-compilation-and-build-times-with-tsconfig-json-optimizations-f2fa0694089b)

---

### 4.2 Docker Build Optimization

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐⭐ (Medium)

#### Multi-Stage Builds

```dockerfile
# Dockerfile

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy only package files (leverage layer caching)
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy only necessary files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

#### Layer Caching Best Practices

```dockerfile
# ❌ BAD: Invalidates cache on any file change
COPY . .
RUN npm install

# ✅ GOOD: Cache dependencies separately
COPY package*.json ./
RUN npm ci
COPY . .
```

#### BuildKit for Parallel Builds

```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1

# Build with cache from registry
docker build \
  --cache-from myapp:latest \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  -t myapp:latest .

# Push with cache
docker push myapp:latest
```

#### .dockerignore Optimization

```
# .dockerignore
node_modules
npm-debug.log
dist
.git
.env
*.md
.vscode
.idea
coverage
*.test.ts
*.spec.ts
```

**Performance Impact:**
- 10-minute build → 30-second incremental build (20x faster)
- Smaller final image (300MB → 100MB)

**Sources:**
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Build Cache](https://docs.docker.com/build/cache/)
- [Faster CI Builds with Docker Layer Caching](https://testdriven.io/blog/faster-ci-builds-with-docker-cache/)

---

### 4.3 Vite HMR Optimization

**Impact:** ⭐⭐⭐⭐ (Medium-High) | **Effort:** ⭐ (Low)

#### Configuration

```ts
// vite.config.ts
export default defineConfig({
  server: {
    hmr: {
      // Use overlay for errors
      overlay: true,

      // Custom HMR port (if needed)
      // port: 24678
    },

    // Faster file watching
    watch: {
      // Ignore heavy directories
      ignored: ['**/node_modules/**', '**/dist/**']
    }
  },

  // Pre-bundle dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@tanstack/react-query',
      'zustand'
    ],

    // Exclude large deps from pre-bundling if causing issues
    exclude: []
  }
});
```

#### Component-Level HMR

```tsx
// Vite automatically handles HMR for React components
// Ensure you're using default exports for best HMR support

// ✅ GOOD: Default export (HMR preserves state)
export default function Dashboard() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}

// ⚠️ OK but less optimal: Named export
export function Dashboard() {
  // State may reset on HMR
}
```

---

## 5. Monitoring & Profiling

### 5.1 Core Web Vitals

**Impact:** ⭐⭐⭐⭐⭐ (High) | **Effort:** ⭐⭐ (Low-Medium)

#### Key Metrics (2026 Standards)

**LCP (Largest Contentful Paint):** Loading performance
- Target: < 2.5 seconds
- Measures: When largest element becomes visible

**INP (Interaction to Next Paint):** Replaces FID in 2024
- Target: < 200 milliseconds
- Measures: Responsiveness to user interactions

**CLS (Cumulative Layout Shift):** Visual stability
- Target: < 0.1
- Measures: Unexpected layout shifts

**TTFB (Time to First Byte):** Server responsiveness
- Target: < 800 milliseconds
- Measures: Time from request to first byte received

#### Implementation

```tsx
// lib/web-vitals.ts
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  // Send to your analytics endpoint
  fetch('/api/analytics', {
    method: 'POST',
    body: JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating, // 'good', 'needs-improvement', 'poor'
      delta: metric.delta,
      id: metric.id
    }),
    keepalive: true
  });
}

// Measure all Core Web Vitals
onCLS(sendToAnalytics);
onINP(sendToAnalytics);
onLCP(sendToAnalytics);
onTTFB(sendToAnalytics);
```

```tsx
// App.tsx
import { useEffect } from 'react';
import { onCLS, onINP, onLCP } from 'web-vitals';

function App() {
  useEffect(() => {
    onLCP(console.log);
    onINP(console.log);
    onCLS(console.log);
  }, []);

  return <Router />;
}
```

#### Optimization Strategies

**Improve LCP:**
- Use CDN for static assets
- Implement image optimization (WebP, lazy loading)
- Reduce server response time (TTFB)
- Eliminate render-blocking resources
- Preload critical resources

**Improve INP:**
- Minimize JavaScript execution time
- Break up long tasks (use `setTimeout` to yield to main thread)
- Use web workers for heavy computations
- Optimize event handlers

**Improve CLS:**
- Always include size attributes on images/videos
- Reserve space for ads and embeds
- Use CSS `aspect-ratio` for responsive images
- Avoid inserting content above existing content

```tsx
// Prevent CLS with aspect-ratio
<img
  src="/container-icon.png"
  width={64}
  height={64}
  style={{ aspectRatio: '1 / 1' }}
  alt="Container"
/>
```

**Sources:**
- [GitHub web-vitals](https://github.com/GoogleChrome/web-vitals)
- [Core Web Vitals in 2026](https://nitropack.io/blog/most-important-core-web-vitals-metrics/)
- [Track Web Vitals in React](https://oneuptime.com/blog/post/2026-01-15-track-web-vitals-lcp-fid-cls-react/view)

---

### 5.2 Performance Profiling Tools

#### React DevTools Profiler

```tsx
// Wrap components to profile
import { Profiler } from 'react';

function App() {
  function onRenderCallback(
    id: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) {
    console.log(`${id} (${phase}) took ${actualDuration}ms`);
  }

  return (
    <Profiler id="Dashboard" onRender={onRenderCallback}>
      <Dashboard />
    </Profiler>
  );
}
```

#### Chrome DevTools Performance Panel

1. Open DevTools → Performance tab
2. Click Record
3. Perform actions
4. Stop recording
5. Analyze:
   - Yellow = Scripting (JavaScript execution)
   - Purple = Rendering (layout, paint)
   - Green = Painting
   - Gray = Other (idle time)

Look for long tasks (> 50ms) blocking main thread.

#### Lighthouse CI

```bash
npm install -g @lhci/cli

# Run audit
lhci autorun --collect.url=http://localhost:5273
```

#### Bundle Analysis

```bash
# Add to package.json
"scripts": {
  "analyze": "vite-bundle-visualizer"
}

npm run analyze
```

---

## 6. Implementation Priority Matrix

### Immediate (Do Today)

| Optimization | Impact | Effort | Time |
|-------------|--------|--------|------|
| Enable React 19 compiler | ⭐⭐⭐⭐⭐ | ⭐ | 15min |
| Audit SQLite WAL pragmas/checkpointing | ⭐⭐⭐⭐ | ⭐ | 15min |
| Enable Fastify compression | ⭐⭐⭐⭐⭐ | ⭐ | 10min |
| Configure Vite build optimization | ⭐⭐⭐⭐⭐ | ⭐⭐ | 30min |
| Enable TypeScript incremental builds | ⭐⭐⭐⭐⭐ | ⭐ | 10min |

### This Week

| Optimization | Impact | Effort | Time |
|-------------|--------|--------|------|
| Implement TanStack Query configuration | ⭐⭐⭐⭐ | ⭐⭐ | 1hr |
| Add route-based code splitting | ⭐⭐⭐⭐⭐ | ⭐⭐ | 2hr |
| Optimize Socket.IO (compression, batching) | ⭐⭐⭐⭐ | ⭐⭐ | 2hr |
| Add Redis caching patterns | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 3hr |
| Implement prepared statements | ⭐⭐⭐⭐⭐ | ⭐⭐ | 1hr |

### This Month

| Optimization | Impact | Effort | Time |
|-------------|--------|--------|------|
| Add list virtualization | ⭐⭐⭐⭐⭐ | ⭐⭐ | 2hr |
| Optimize Recharts for large datasets | ⭐⭐⭐⭐ | ⭐⭐⭐ | 3hr |
| Implement cursor-based pagination | ⭐⭐⭐⭐ | ⭐⭐ | 2hr |
| Optimize CSS animations (GPU, will-change) | ⭐⭐⭐⭐ | ⭐⭐⭐ | 3hr |
| Add Web Vitals monitoring | ⭐⭐⭐⭐⭐ | ⭐⭐ | 2hr |
| Optimize Docker builds | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 3hr |

### Nice to Have (When Scaling)

| Optimization | Impact | Effort | Time |
|-------------|--------|--------|------|
| Implement Service Worker | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 1 day |
| Enable HTTP/2 | ⭐⭐⭐⭐ | ⭐⭐⭐ | 4hr |
| Multi-layer caching | ⭐⭐⭐⭐ | ⭐⭐⭐ | 4hr |
| Framer Motion LazyMotion | ⭐⭐⭐⭐ | ⭐⭐ | 1hr |

---

## Summary of Expected Improvements

**After implementing high-priority optimizations (based on measured baseline in your environment):**

- **Frontend load time:** often improves after code splitting + caching, but percentage varies by route and device
- **Bundle size:** usually improves with chunking and dependency hygiene
- **API response time:** often improves with indexing/query tuning and caching
- **Database write behavior:** WAL and prepared statements improve contention/latency under concurrent load
- **Network bandwidth:** compression usually reduces payload size significantly for text-based responses
- **Build time:** incremental TypeScript builds can provide major speedups in large projects
- **Lighthouse score:** can increase materially, but score targets should be set per route/profile and tracked over time

**Total effort:** ~2-3 days for high-impact changes.

---

## Tools & Resources

**Performance Monitoring:**
- [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview)
- [WebPageTest](https://www.webpagetest.org/)
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)

**Bundle Analysis:**
- [Vite Bundle Visualizer](https://github.com/btd/rollup-plugin-visualizer)
- [Webpack Bundle Analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer)

**Performance APIs:**
- [web-vitals](https://github.com/GoogleChrome/web-vitals)
- [PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)

---

## Complete Sources Index

This research synthesized findings from official docs plus community articles:

**React & Frontend:**
- [React Compiler](https://react.dev/learn/react-compiler)
- [startTransition](https://react.dev/reference/react/startTransition)
- [React Performance Optimization](https://dev.to/alex_bobes/react-performance-optimization-15-best-practices-for-2025-17l9)
- [React memo documentation](https://react.dev/reference/react/memo)
- [Vite Build Options](https://vite.dev/config/build-options)
- [TanStack Query Prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [List Virtualization](https://medium.com/@atulbanwar/list-virtualization-in-react-3db491346af4)

**Backend & Database:**
- [Fastify Validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [SQLite Performance Tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [Socket.IO Performance](https://socket.io/docs/v4/performance-tuning/)
- [Redis Caching Patterns](https://redis.io/learn/develop/node/nodecrashcourse/caching)

**Network & Optimization:**
- [HTTP/3 vs HTTP/2](https://blog.cloudflare.com/http-3-vs-http-2/)
- [Service Worker Caching](https://www.magicbell.com/blog/offline-first-pwas-service-worker-caching-strategies)
- [Core Web Vitals](https://web.dev/explore/learn-core-web-vitals)

**Build & Tooling:**
- [TypeScript Incremental Builds](https://www.typescriptlang.org/tsconfig/incremental.html)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

---

**Research compiled:** February 6, 2026
**Valid for:** React 19, Fastify 5, Vite 6, TypeScript 5.x
**Target application:** AI-Powered Container Monitoring Dashboard
