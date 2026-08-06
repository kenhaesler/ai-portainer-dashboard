import type { UseQueryResult } from '@tanstack/react-query';

/**
 * Partial-mocks TanStack Query's `UseQueryResult`, a ~25-member observer union
 * a page test cannot meaningfully populate — only the fields the page reads are
 * supplied.
 *
 * The cast lives here, in ONE place, so the widening is auditable: every
 * caller still typechecks its fixture's `data` against the query's real
 * payload type, which is the axis drift actually shows up on. `mockQuery<Foo>({
 * data: ... })` fails to compile the moment `Foo` gains a field the fixture
 * omits — which is exactly how #1617 found `CorrelatedAnomaly.patternMatch`
 * missing from two fixtures.
 */
export function mockQuery<TData>(
  partial: Partial<UseQueryResult<TData, Error>>,
): UseQueryResult<TData, Error> {
  return partial as unknown as UseQueryResult<TData, Error>;
}
