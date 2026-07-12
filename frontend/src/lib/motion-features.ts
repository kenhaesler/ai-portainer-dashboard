/**
 * Framer Motion feature bundle, loaded asynchronously by <LazyMotion> in
 * App.tsx (#1507). Lives in its own module so the animation machinery splits
 * into a lazily-fetched chunk instead of sitting on the startup critical path.
 *
 * domMax (not domAnimation) is required: the sidebar uses layout animations
 * (`layoutId="sidebar-active-pill"`, `layout` props), which the smaller
 * domAnimation bundle does not include.
 */
import { domMax } from 'framer-motion';

export default domMax;
