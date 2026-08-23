import { useCallback, useEffect, useRef, useState } from 'react';
import { toAppError } from '../lib/api';
import type { AppError } from '@shared/types/common';

/**
 * Data loading.
 *
 * Deliberately hand-rolled rather than pulling in a query library: every call
 * goes over IPC to a local SQLite database on the same machine, so there is no
 * network to retry, no cache invalidation across clients, and no stale-while-
 * revalidate story to get right. What is actually needed is: run it, keep the
 * previous data visible while refreshing, and never apply a result from a call
 * that has already been superseded.
 */

export interface AsyncState<T> {
  data: T | null;
  error: AppError | null;
  loading: boolean;
  /** True on the very first load, false for subsequent refreshes. */
  initial: boolean;
  reload: () => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
): AsyncState<T> {
  const { enabled = true, keepPrevious = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [initial, setInitial] = useState(true);

  const requestId = useRef(0);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    if (!keepPrevious) setData(null);

    loaderRef
      .current()
      .then((result) => {
        // A newer request has already started; this answer is out of date.
        if (!mounted.current || id !== requestId.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mounted.current || id !== requestId.current) return;
        setError(toAppError(err));
      })
      .finally(() => {
        if (!mounted.current || id !== requestId.current) return;
        setLoading(false);
        setInitial(false);
      });
  }, [enabled, keepPrevious]);

  useEffect(() => {
    run();
    // `run` is stable; the caller's deps decide when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { data, error, loading, initial, reload: run };
}

/**
 * For actions rather than reads: tracks in-flight state and surfaces failures
 * without the caller writing the same try/catch every time.
 */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | null>;
  pending: boolean;
  error: AppError | null;
  clearError: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const mounted = useRef(true);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<TResult | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await actionRef.current(...args);
      return result;
    } catch (err) {
      if (mounted.current) setError(toAppError(err));
      return null;
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}

/** Debounces a rapidly changing value — used by the live search field. */
export function useDebounced<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
